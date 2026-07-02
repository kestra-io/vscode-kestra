import {stateBucket, logLevelRank, LOG_LEVELS} from '../shared/executionState';
import {HostMessage, WebviewMessage} from './messages';
import {FlowInput, LogEntry} from '../shared/flow';

interface VsCodeApi {
    postMessage(message: WebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface TagSelectElement extends HTMLDivElement {
    getSelected(): string[];
}

type SectionRefs = {
    section: HTMLDivElement;
    body: HTMLDivElement;
    badge: HTMLElement;
    duration: HTMLElement;
};

const vscode = acquireVsCodeApi();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

function titleCase(state: string): string {
    return state.charAt(0) + state.slice(1).toLowerCase();
}

const flow = el('span', 'flow');
const badge = el('span', 'ks-badge', 'pending');
const copy = el('button', 'ks-button secondary', 'Copy logs');
const open = el('a', 'ks-button', 'Open in Kestra');
const phase = el('div', 'phase');
const form = el('div', 'ks-form');
const levelFilter = el('select', 'ks-select');
const errors = el('div', 'errors');
const tasks = el('div', 'tasks');

const sections: Record<string, SectionRefs> = {};

function buildLayout() {
    open.href = '#';
    open.target = '_blank';
    open.rel = 'noopener';
    open.hidden = true;
    form.hidden = true;

    levelFilter.id = 'levelFilter';
    [...LOG_LEVELS].reverse().forEach(level => {
        const option = el('option', '', titleCase(level));
        option.value = level;
        option.selected = level === 'INFO';
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

function setBadge(state: string) {
    const bucket = stateBucket(state);
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

// Chip multi-select, mirrors Kestra's KsSelect multiple.
function buildTagSelect(values: string[], fallback: unknown): TagSelectElement {
    const wrap = document.createElement('div') as TagSelectElement;
    wrap.className = 'ks-tags';
    wrap.dataset.multi = '1';
    const box = document.createElement('div');
    box.className = 'ks-tags-box';
    const search = document.createElement('input');
    search.className = 'ks-tags-input';
    search.placeholder = 'Select...';
    box.appendChild(search);
    const menu = document.createElement('div');
    menu.className = 'ks-tags-menu';
    menu.hidden = true;
    wrap.appendChild(box);
    wrap.appendChild(menu);

    const initial = Array.isArray(fallback) ? fallback : (fallback !== null && fallback !== undefined && fallback !== '' ? [fallback] : []);
    const selected = new Set<string>(initial.map(String));

    function renderChips() {
        box.querySelectorAll('.ks-tag').forEach(c => c.remove());
        selected.forEach(v => {
            const chip = document.createElement('span');
            chip.className = 'ks-tag';
            chip.textContent = v;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.textContent = '×';
            remove.addEventListener('click', event => {
                event.stopPropagation();
                selected.delete(v);
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
        values.filter(v => !selected.has(String(v)) && String(v).toLowerCase().includes(filter)).forEach(v => {
            const option = document.createElement('div');
            option.className = 'ks-tags-opt';
            option.textContent = v;
            option.addEventListener('mousedown', event => {
                event.preventDefault();
                selected.add(String(v));
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
    const wrap = document.createElement('div');
    wrap.className = 'ks-field-file';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ks-button secondary';
    btn.textContent = 'Choose file';
    btn.addEventListener('click', () => vscode.postMessage({command: 'pickFile', inputId: input.id}));
    const name = document.createElement('span');
    name.className = 'ks-filename';
    name.dataset.fileFor = input.id;
    name.textContent = 'No file selected';
    wrap.append(btn, name);
    return wrap;
}

function createControl(type: string, input: FlowInput, fallback: unknown): HTMLElement {
    if (type === 'BOOLEAN' || type === 'BOOL') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = fallback === true || fallback === 'true';
        return checkbox;
    }
    if ((type === 'SELECT' || type === 'ENUM') && Array.isArray(input.values)) {
        const select = document.createElement('select');
        select.className = 'ks-select';
        input.values.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            opt.selected = String(fallback) === String(v);
            select.appendChild(opt);
        });
        return select;
    }
    if (type === 'MULTISELECT' && Array.isArray(input.values)) {
        return buildTagSelect(input.values, fallback);
    }
    if (type === 'JSON' || type === 'YAML' || type === 'ARRAY') {
        const textarea = document.createElement('textarea');
        textarea.className = 'ks-input';
        textarea.value = typeof fallback === 'string' ? fallback : JSON.stringify(fallback);
        return textarea;
    }
    const text = document.createElement('input');
    text.className = 'ks-input';
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
    const actions = document.createElement('div');
    actions.className = 'ks-form-actions';
    const run = document.createElement('button');
    run.className = 'ks-button';
    run.textContent = 'Run';
    run.addEventListener('click', submitForm);
    const cancel = document.createElement('button');
    cancel.className = 'ks-button secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
        form.hidden = true;
        vscode.postMessage({command: 'cancelInputs'});
    });
    actions.append(run, cancel);
    return actions;
}

function renderForm(inputs: FlowInput[]) {
    form.textContent = '';
    const title = document.createElement('div');
    title.className = 'ks-form-title';
    title.textContent = 'Inputs';
    form.appendChild(title);

    inputs.forEach(input => {
        const type = (input.type || 'STRING').toUpperCase();
        const inline = type === 'BOOLEAN' || type === 'BOOL';
        const field = document.createElement('div');
        field.className = 'ks-field' + (inline ? ' inline' : '');

        const label = document.createElement('label');
        label.className = 'ks-label';
        label.innerHTML = input.id + (input.required ? '<span class="req">*</span>' : '') +
            '<span class="type">' + type + '</span>';

        if (type === 'FILE') {
            field.append(label, createFileField(input));
        } else {
            const control = createControl(type, input, input.prefill ?? input.defaults ?? '');
            control.dataset.id = input.id;
            control.dataset.type = type;
            control.dataset.required = input.required ? '1' : '';
            field.append(...(inline ? [control, label] : [label, control]));
        }
        form.appendChild(field);
    });

    form.appendChild(createFormActions());
    form.hidden = false;
}

// Values pass through as-is; the server parses each type. Checkbox -> "true"/"false", multi -> JSON array.
// DATETIME/TIME are the exceptions: native pickers emit local shapes the server rejects, so normalize.
function controlValue(control: HTMLElement): string {
    if ((control as HTMLInputElement).type === 'checkbox') {
        return (control as HTMLInputElement).checked ? 'true' : 'false';
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
        const required = Boolean(control.dataset.required) && (control as HTMLInputElement).type !== 'checkbox';
        const empty = !value.trim();
        control.classList.toggle('invalid', required && empty);
        missing ||= required && empty;
        if (value !== '' && control.dataset.id) {
            values[control.dataset.id] = value;
        }
    });
    if (missing) {
        return;
    }
    form.hidden = true;
    vscode.postMessage({command: 'submitInputs', values});
}

function getSection(task: string): SectionRefs {
    const key = task || '__flow__';
    const existing = sections[key];
    if (existing) {
        return existing;
    }
    const section = el('div', 'task-section collapsed');
    const head = el('div', 'task-head');
    const badge = el('span', 'ks-badge task-status');
    badge.hidden = true;
    const duration = el('span', 'duration');
    head.append(el('span', 'chevron'), el('span', 'task-name', task || 'flow'), badge, duration);
    head.addEventListener('click', () => section.classList.toggle('collapsed'));
    const body = el('div', 'task-body');
    section.append(head, body);
    tasks.appendChild(section);
    sections[key] = {section, body, badge, duration};
    return sections[key];
}

copy.addEventListener('click', () => {
    const text = Array.from(document.querySelectorAll<HTMLElement>('.row')).map(r => r.dataset.copy).join('\n');
    vscode.postMessage({command: 'copy', text});
});

function resetView(flowId: string) {
    flow.textContent = flowId;
    tasks.textContent = '';
    errors.textContent = '';
    phase.textContent = '';
    form.hidden = true;
    form.textContent = '';
    open.hidden = true;
    for (const k in sections) {
        delete sections[k];
    }
    setBadge('RUNNING');
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
        section.duration.textContent = `${duration.toFixed(2)}s`;
    }
}

function appendLogRow(log: LogEntry) {
    const level = (log.level || 'INFO').toUpperCase();
    const task = log.taskId || '';
    const time = ((log.timestamp || '').split('T')[1] || '').replace('Z', '');

    const row = el('div', `row ${level.toLowerCase()}`);
    row.classList.toggle('hidden', logLevelRank(level) < logLevelRank(levelFilter.value));
    row.dataset.level = level;
    row.dataset.copy = `${log.timestamp || ''} ${level} ${task ? `[${task}] ` : ''}${log.message || ''}`;
    row.append(
        el('span', 'ts', time),
        el('span', `lvl ${level.toLowerCase()}`, level),
        el('span', 'msg', log.message || '')
    );

    const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
    getSection(task).body.appendChild(row);
    if (atBottom) {
        window.scrollTo(0, document.body.scrollHeight);
    }
}

window.addEventListener('message', event => {
    const m = event.data as HostMessage;
    switch (m.type) {
        case 'reset':
            resetView(m.flow);
            break;
        case 'phase':
            phase.textContent = m.text;
            break;
        case 'inputs':
            renderForm(m.inputs || []);
            break;
        case 'fileChosen': {
            const span = form.querySelector('[data-file-for="' + m.inputId + '"]');
            if (span) {
                span.textContent = m.name;
            }
            break;
        }
        case 'execution':
            open.href = m.url;
            open.hidden = false;
            phase.textContent = 'Execution ' + m.id;
            break;
        case 'error': {
            const d = document.createElement('div');
            d.textContent = m.text;
            errors.appendChild(d);
            break;
        }
        case 'status':
            setBadge(m.state);
            break;
        case 'task':
            updateTaskRow(m.taskId, m.state, m.duration);
            break;
        case 'log':
            appendLogRow(m);
            break;
    }
});

buildLayout();
vscode.postMessage({type: 'ready'});
