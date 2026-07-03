import {acquireApi, el} from './dom';
import {DocCrumb, DocsHostMessage, DocsWebviewMessage} from './messages';

const vscode = acquireApi<DocsWebviewMessage>();

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 3;

const back = el('button', 'back', '‹');
back.title = 'Back';
back.disabled = true;
const search = el('input', 'search');
search.type = 'search';
search.placeholder = 'Search the docs';
const toolbar = el('div', 'toolbar');
toolbar.append(back, search);
const results = el('div', 'results');
results.hidden = true;
const crumbBar = el('nav', 'crumbs');
crumbBar.hidden = true;
const heading = el('h1', 'doc-title');
const content = el('article', 'content');
document.body.append(toolbar, results, crumbBar, heading, content);

let searchTimer: ReturnType<typeof setTimeout> | undefined;
search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = search.value.trim();
    if (q.length < MIN_QUERY_LENGTH) {
        results.hidden = true;
        return;
    }
    searchTimer = setTimeout(() => vscode.postMessage({type: 'search', q}), SEARCH_DEBOUNCE_MS);
});
search.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        results.hidden = true;
    }
});

back.addEventListener('click', () => vscode.postMessage({type: 'back'}));

// Doc-relative links go to the host for resolution. Full URLs are left alone:
// VS Code's webview host already opens those externally, handling them here opens two tabs.
content.addEventListener('click', event => {
    const row = (event.target as HTMLElement).closest('[data-nav]');
    if (row instanceof HTMLElement && row.dataset.nav) {
        vscode.postMessage({type: 'nav', target: row.dataset.nav});
        return;
    }
    const href = (event.target as HTMLElement).closest('a')?.getAttribute('href');
    if (!href || href.startsWith('#') || /^https?:\/\//.test(href)) {
        return;
    }
    event.preventDefault();
    vscode.postMessage({type: 'open', href});
});

function showCrumbs(crumbs: DocCrumb[]) {
    crumbBar.replaceChildren();
    crumbBar.hidden = crumbs.length === 0;
    crumbs.forEach((crumb, index) => {
        if (index > 0) {
            crumbBar.append(el('span', 'crumb-sep', '›'));
        }
        if (crumb.nav) {
            const link = el('button', 'crumb', crumb.label);
            const target = crumb.nav;
            link.addEventListener('click', () => vscode.postMessage({type: 'nav', target}));
            crumbBar.append(link);
        } else {
            crumbBar.append(el('span', 'crumb current', crumb.label));
        }
    });
}

// Tables become a grid of expandable cards, the first cell is the header.
function transformTables() {
    const skipLabels = new Set(['description', 'details']);
    for (const table of Array.from(content.querySelectorAll('table'))) {
        const headers = Array.from(table.tHead?.rows[0]?.cells ?? []).map(cell => cell.textContent?.trim() ?? '');
        const grid = el('div', 'card-grid');
        for (const row of Array.from(table.tBodies[0]?.rows ?? [])) {
            const [first, ...rest] = Array.from(row.cells);
            if (!first) {
                continue;
            }
            const card = el('details', 'doc-card');
            const summary = el('summary');
            summary.append(...Array.from(first.childNodes));
            card.append(summary);
            const body = el('div', 'doc-card-body');
            rest.forEach((cell, index) => {
                const label = headers[index + 1];
                if (label && !skipLabels.has(label.toLowerCase())) {
                    body.append(el('span', 'doc-card-label', label));
                }
                body.append(...Array.from(cell.childNodes));
            });
            card.append(body);
            grid.append(card);
        }
        if (grid.childElementCount > 0) {
            table.replaceWith(grid);
        }
    }
}

const COPY_RESET_MS = 1500;
const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const COPIED_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';

function addCopyButtons() {
    for (const pre of Array.from(content.querySelectorAll('pre'))) {
        const button = el('button', 'copy');
        button.title = 'Copy';
        button.innerHTML = COPY_ICON;
        button.addEventListener('click', () => {
            vscode.postMessage({type: 'copy', text: pre.querySelector('code')?.textContent ?? ''});
            button.innerHTML = COPIED_ICON;
            setTimeout(() => (button.innerHTML = COPY_ICON), COPY_RESET_MS);
        });
        pre.append(button);
    }
}

function showResults(items: Array<{title: string; path: string}>) {
    results.replaceChildren();
    for (const item of items) {
        const row = el('button', 'result', item.title);
        row.addEventListener('click', () => {
            results.hidden = true;
            search.value = '';
            vscode.postMessage({type: 'openPath', path: item.path});
        });
        results.append(row);
    }
    if (items.length === 0) {
        results.append(el('div', 'no-results', 'No results.'));
    }
    results.hidden = false;
}

window.addEventListener('message', event => {
    const m = event.data as DocsHostMessage;
    switch (m.type) {
        case 'doc':
            heading.textContent = m.title;
            // Rendered by the host from the docs markdown, the CSP blocks any script in it.
            content.innerHTML = m.html;
            transformTables();
            addCopyButtons();
            showCrumbs(m.crumbs);
            back.disabled = !m.canBack;
            results.hidden = true;
            window.scrollTo(0, 0);
            break;
        case 'results':
            // A late response must not reopen the dropdown after the query was cleared.
            if (search.value.trim().length >= MIN_QUERY_LENGTH) {
                showResults(m.items);
            }
            break;
        case 'notice':
            heading.textContent = '';
            crumbBar.hidden = true;
            content.textContent = m.text;
            break;
    }
});

vscode.postMessage({type: 'ready'});
