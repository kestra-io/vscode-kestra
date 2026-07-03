import {acquireApi, el} from './dom';
import {DocsHostMessage, DocsWebviewMessage} from './messages';

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
const heading = el('h1', 'doc-title');
const content = el('article', 'content');
document.body.append(toolbar, results, heading, content);

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

// The host resolves every link: relative ones navigate in the panel, the rest open in the browser.
content.addEventListener('click', event => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) {
        return;
    }
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (href && !href.startsWith('#')) {
        vscode.postMessage({type: 'open', href});
    }
});

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
            // Rendered by the host from the docs markdown; the CSP blocks any script in it.
            content.innerHTML = m.html;
            back.disabled = !m.canBack;
            results.hidden = true;
            window.scrollTo(0, 0);
            break;
        case 'results':
            showResults(m.items);
            break;
        case 'notice':
            heading.textContent = '';
            content.textContent = m.text;
            break;
    }
});

vscode.postMessage({type: 'ready'});
