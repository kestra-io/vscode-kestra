import {stateBucket, logLevelRank, LOG_LEVELS} from '../shared/executionState';
import {HostMessage, WebviewMessage} from './messages';
import {FlowInput, LogEntry, formatDuration, formatLogTimestamp, formatLogLine, inputFallback, isInputRequired} from '../shared/flow';
import {acquireApi, el} from './dom';

interface TagSelectElement extends HTMLDivElement {
    getSelected(): string[];
}

type SectionRefs = {
    section: HTMLDivElement;
    body: HTMLDivElement;
    badge: HTMLElement;
    duration: HTMLElement;
};

const vscode = acquireApi<WebviewMessage>();

function titleCase(state: string): string {
    return state.charAt(0) + state.slice(1).toLowerCase();
}

// Only http(s) may land in the link's href, anything else (javascript:, data:) is dropped.
function safeHttpUrl(value: string): string | undefined {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
    } catch {
        return undefined;
    }
}

const flow = el('span', 'flow');
const badge = el('span', 'ks-badge');
const copy = el('button', 'ks-button secondary', 'Copy logs');
copy.insertAdjacentHTML('afterbegin', '<span class="codicon codicon-copy"></span>');
const open = el('a', 'ks-button', 'Open in Kestra');
open.insertAdjacentHTML('afterbegin', '<span class="codicon codicon-link-external"></span>');
const phase = el('div', 'phase');
const form = el('div', 'ks-form');
const levelFilter = el('select', 'ks-select');
const errors = el('div', 'errors');
const tasks = el('div', 'tasks');

let sections: Record<string, SectionRefs> = {};

function buildLayout() {
    open.href = '#';
    open.target = '_blank';
    open.rel = 'noopener';
    open.hidden = true;
    copy.hidden = true;
    badge.hidden = true;
    form.hidden = true;

    levelFilter.id = 'levelFilter';
    [...LOG_LEVELS].reverse().forEach(level => {
        const option = el('option', '', titleCase(level));
        option.value = level;
        levelFilter.appendChild(option);
    });

    const header = el('div', 'header');
    header.append(flow, badge, el('span', 'spacer'), copy, open);
    const filters = el('div', 'filters');
    const label = el('label', 'filter-label', 'Log level');
    label.htmlFor = levelFilter.id;
    filters.append(label, levelFilter);
    const toolbar = el('div', 'toolbar');
    toolbar.append(phase, filters);
    document.body.append(header, toolbar, form, errors, tasks);
}

// The badge stays hidden until the server reports a state.
function setBadge(state: string) {
    const bucket = stateBucket(state);
    badge.hidden = !state;
    badge.textContent = state ? titleCase(state) : '';
    badge.className = bucket ? `ks-badge ks-badge--${bucket}` : 'ks-badge';
}

function applyFilter() {
    const min = logLevelRank(levelFilter.value);
    document.querySelectorAll<HTMLElement>('.row').forEach(row => {
        row.classList.toggle('hidden', logLevelRank(row.dataset.level) < min);
    });
}
levelFilter.addEventListener('change', applyFilter);

function buildTagSelect(values: string[], fallback: unknown): TagSelectElement {
    const wrap = el('div', 'ks-tags') as TagSelectElement;
    wrap.dataset.multi = '1';
    const box = el('div', 'ks-tags-box');
    const search = el('input', 'ks-tags-input');
    search.placeholder = 'Select...';
    box.appendChild(search);
    const menu = el('div', 'ks-tags-menu');
    menu.hidden = true;
    wrap.append(box, menu);

    const initial = Array.isArray(fallback) ? fallback : (fallback !== null && fallback !== undefined && fallback !== '' ? [fallback] : []);
    const selected = new Set<string>(initial.map(String));

    function renderChips() {
        box.querySelectorAll('.ks-tag').forEach(chip => chip.remove());
        selected.forEach(value => {
            const chip = el('span', 'ks-tag', value);
            const remove = el('button', '', '×');
            remove.type = 'button';
            remove.addEventListener('click', event => {
                event.stopPropagation();
                selected.delete(value);
                renderChips();
                renderMenu();
            });
            chip.appendChild(remove);
            box.insertBefore(chip, search);
        });
    }
    function renderMenu() {
        menu.textContent = '';
        const filter = search.value.toLowerCase();
        values.filter(value => !selected.has(String(value)) && String(value).toLowerCase().includes(filter)).forEach(value => {
            const option = el('div', 'ks-tags-opt', value);
            option.addEventListener('mousedown', event => {
                event.preventDefault();
                selected.add(String(value));
                search.value = '';
                renderChips();
                renderMenu();
            });
            menu.appendChild(option);
        });
        menu.hidden = menu.childElementCount === 0;
    }

    box.addEventListener('click', () => search.focus());
    search.addEventListener('focus', renderMenu);
    search.addEventListener('input', renderMenu);
    search.addEventListener('blur', () => setTimeout(() => { menu.hidden = true; }, 150));

    wrap.getSelected = () => Array.from(selected);
    renderChips();
    return wrap;
}

function createFileField(input: FlowInput): HTMLDivElement {
    const wrap = el('div', 'ks-field-file');
    wrap.dataset.required = isInputRequired(input) ? '1' : '';
    const pick = el('button', 'ks-button secondary', 'Choose file');
    pick.type = 'button';
    pick.addEventListener('click', () => vscode.postMessage({type: 'pickFile', inputId: input.id}));
    const name = el('span', 'ks-filename', 'No file selected');
    name.dataset.fileFor = input.id;
    wrap.append(pick, name);
    return wrap;
}

function createControl(type: string, input: FlowInput, fallback: unknown): HTMLElement {
    // BOOLEAN is tri-state: unset submits nothing so the flow's own default applies.
    if (type === 'BOOLEAN') {
        const select = el('select', 'ks-select');
        [['', 'undefined'], ['true', 'true'], ['false', 'false']].forEach(([value, label]) => {
            const option = el('option', '', label);
            option.value = value;
            option.selected = String(fallback ?? '') === value;
            select.appendChild(option);
        });
        return select;
    }
    if (type === 'BOOL') {
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = fallback === true || fallback === 'true';
        return checkbox;
    }
    if ((type === 'SELECT' || type === 'ENUM') && Array.isArray(input.values)) {
        const select = el('select', 'ks-select');
        input.values.forEach(value => {
            const option = el('option', '', value);
            option.value = value;
            option.selected = String(fallback) === String(value);
            select.appendChild(option);
        });
        return select;
    }
    if (type === 'MULTISELECT' && Array.isArray(input.values)) {
        return buildTagSelect(input.values, fallback);
    }
    if (type === 'JSON' || type === 'YAML' || type === 'ARRAY') {
        const textarea = el('textarea', 'ks-input');
        textarea.value = typeof fallback === 'string' ? fallback : JSON.stringify(fallback);
        return textarea;
    }
    const text = el('input', 'ks-input');
    text.type = type === 'SECRET' ? 'password'
        : type === 'EMAIL' ? 'email'
        : type === 'URI' ? 'url'
        : type === 'DATE' ? 'date'
        : type === 'DATETIME' ? 'datetime-local'
        : type === 'TIME' ? 'time'
        : (type === 'INT' || type === 'FLOAT' || type === 'NUMBER') ? 'number'
        : 'text';
    if (type === 'TIME') {
        text.step = '1';
    }
    // Native datetime-local/time inputs reject zoned ISO values, so trim defaults to their local shape.
    text.value = type === 'DATETIME' ? String(fallback).slice(0, 16)
        : type === 'TIME' ? String(fallback).slice(0, 8)
        : String(fallback);
    return text;
}

function createFormActions(): HTMLDivElement {
    const actions = el('div', 'ks-form-actions');
    const run = el('button', 'ks-button', 'Execute');
    run.insertAdjacentHTML('afterbegin', '<span class="codicon codicon-play"></span>');
    run.addEventListener('click', submitForm);
    const cancel = el('button', 'ks-button secondary', 'Cancel');
    cancel.addEventListener('click', () => {
        form.hidden = true;
        vscode.postMessage({type: 'cancelInputs'});
    });
    actions.append(run, cancel);
    return actions;
}

function renderForm(inputs: FlowInput[]) {
    form.textContent = '';
    form.appendChild(el('div', 'ks-form-title', 'Inputs'));

    inputs.forEach(input => {
        const type = (input.type || 'STRING').toUpperCase();
        const inline = type === 'BOOL';
        const field = el('div', 'ks-field' + (inline ? ' inline' : ''));

        const label = el('label', 'ks-label', input.id);
        if (isInputRequired(input)) {
            label.appendChild(el('span', 'req', '*'));
        }
        label.appendChild(el('span', 'type', type));

        const desc = input.description ? el('div', 'ks-desc', input.description) : undefined;
        if (type === 'FILE') {
            field.append(label, ...(desc ? [desc] : []), createFileField(input));
        } else {
            const control = createControl(type, input, inputFallback(input));
            control.dataset.id = input.id;
            control.dataset.type = type;
            control.dataset.required = isInputRequired(input) ? '1' : '';
            field.append(...(inline ? [control, label] : [label, ...(desc ? [desc] : []), control]));
        }
        form.appendChild(field);
    });

    form.appendChild(createFormActions());
    form.hidden = false;
}

// The server parses each type, only DATETIME/TIME need normalizing back from the pickers' local shapes.
function controlValue(control: HTMLElement): string {
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
        return control.checked ? 'true' : 'false';
    }
    if (control.dataset.multi) {
        return JSON.stringify((control as TagSelectElement).getSelected());
    }
    const value = (control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
    if (!value) {
        return value;
    }
    if (control.dataset.type === 'DATETIME') {
        return new Date(value).toISOString();
    }
    if (control.dataset.type === 'TIME') {
        return value.length === 5 ? `${value}:00` : value;
    }
    return value;
}

function submitForm() {
    const values: Record<string, string> = {};
    let missing = false;
    form.querySelectorAll<HTMLElement>('[data-id]').forEach(control => {
        const value = controlValue(control);
        const isCheckbox = control instanceof HTMLInputElement && control.type === 'checkbox';
        const required = Boolean(control.dataset.required) && !isCheckbox;
        const empty = !value.trim() || value === '[]';
        control.classList.toggle('invalid', required && empty);
        missing ||= required && empty;
        if (value !== '' && control.dataset.id) {
            values[control.dataset.id] = value;
        }
    });
    form.querySelectorAll<HTMLElement>('.ks-field-file').forEach(wrap => {
        const chosen = Boolean(wrap.querySelector<HTMLElement>('[data-file-for]')?.dataset.chosen);
        const bad = Boolean(wrap.dataset.required) && !chosen;
        wrap.classList.toggle('invalid', bad);
        missing ||= bad;
    });
    if (missing) {
        return;
    }
    form.hidden = true;
    vscode.postMessage({type: 'submitInputs', values});
}

function getSection(task: string): SectionRefs {
    const key = task || '__flow__';
    const existing = sections[key];
    if (existing) {
        return existing;
    }
    const section = el('div', 'task-section collapsed');
    const head = el('div', 'task-head');
    const taskBadge = el('span', 'ks-badge task-status');
    taskBadge.hidden = true;
    const duration = el('span', 'duration');
    head.append(el('span', 'chevron'), el('span', 'task-name', task || 'flow'), taskBadge, duration);
    head.addEventListener('click', () => section.classList.toggle('collapsed'));
    const body = el('div', 'task-body');
    section.append(head, body);
    tasks.appendChild(section);
    sections[key] = {section, body, badge: taskBadge, duration};
    return sections[key];
}

copy.addEventListener('click', () => {
    const text = Array.from(document.querySelectorAll<HTMLElement>('.row')).map(row => row.dataset.copy).join('\n');
    vscode.postMessage({type: 'copy', text});
});

function resetView(flowId: string, level: string) {
    flow.textContent = flowId;
    tasks.textContent = '';
    errors.textContent = '';
    phase.textContent = '';
    form.hidden = true;
    form.textContent = '';
    open.hidden = true;
    copy.hidden = true;
    sections = {};
    logRows = [];
    truncationNotice?.remove();
    truncationNotice = undefined;
    levelFilter.value = level;
    setBadge('');
}

function updateTaskRow(taskId: string, state: string, duration?: number) {
    const section = getSection(taskId);
    if (state) {
        const bucket = stateBucket(state);
        section.badge.textContent = titleCase(state);
        section.badge.className = `ks-badge task-status${bucket ? ` ks-badge--${bucket}` : ''}`;
        section.badge.hidden = false;
    }
    if (typeof duration === 'number') {
        section.duration.textContent = formatDuration(duration);
    }
}

function logRow(log: LogEntry): HTMLDivElement {
    const level = (log.level || 'INFO').toUpperCase();
    const row = el('div', `row ${level.toLowerCase()}`);
    row.classList.toggle('hidden', logLevelRank(level) < logLevelRank(levelFilter.value));
    row.dataset.level = level;
    row.dataset.copy = formatLogLine(log);
    const entry = el('div', 'entry');
    entry.append(
        el('span', 'ts', formatLogTimestamp(log.timestamp)),
        el('div', 'msg', log.message || '')
    );
    row.append(el('span', `lvl ${level.toLowerCase()}`, level), entry);
    return row;
}

// Oldest rows drop past this cap so the DOM stays bounded.
const MAX_LOG_ROWS = 5000;
let logRows: HTMLElement[] = [];
let truncationNotice: HTMLElement | undefined;

// One scroll check and one scroll per batch, not per line.
function appendLogRows(entries: LogEntry[]) {
    const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
    entries.forEach(entry => {
        const row = logRow(entry);
        getSection(entry.taskId || '').body.appendChild(row);
        logRows.push(row);
    });
    copy.hidden = logRows.length === 0;
    if (logRows.length > MAX_LOG_ROWS) {
        logRows.splice(0, logRows.length - MAX_LOG_ROWS).forEach(row => row.remove());
        if (!truncationNotice) {
            truncationNotice = el('div', 'phase', 'Older log lines were dropped to keep the view responsive.');
            tasks.before(truncationNotice);
        }
    }
    if (atBottom) {
        window.scrollTo(0, document.body.scrollHeight);
    }
}

window.addEventListener('message', event => {
    const m = event.data as HostMessage;
    switch (m.type) {
        case 'reset':
            resetView(m.flow, m.level);
            break;
        case 'phase':
            phase.textContent = m.text;
            break;
        case 'inputs':
            renderForm(m.inputs);
            break;
        case 'fileChosen': {
            const span = form.querySelector<HTMLElement>(`[data-file-for="${m.inputId}"]`);
            if (span) {
                span.textContent = m.name;
                span.dataset.chosen = '1';
            }
            break;
        }
        case 'execution': {
            const url = safeHttpUrl(m.url);
            if (url) {
                open.href = url;
                open.hidden = false;
            }
            phase.textContent = `Execution ${m.id}`;
            break;
        }
        case 'error':
            errors.appendChild(el('div', '', m.text));
            break;
        case 'status':
            setBadge(m.state);
            break;
        case 'taskState':
            updateTaskRow(m.taskId, m.state, m.duration);
            break;
        case 'logs':
            appendLogRows(m.entries);
            break;
    }
});

buildLayout();
vscode.postMessage({type: 'ready'});
