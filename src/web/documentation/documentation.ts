import * as vscode from 'vscode';
import ApiClient from '../apiClient';
import YamlUtils from '../libs/yamlUtils';
import {webviewHtml} from '../webviewHelpers';
import {renderDocMarkdown} from './docsMarkdown';
import {IconResolver, PluginDefinition, PluginEntry, pluginElements, renderGroupPage, renderPluginDoc, renderPluginList, renderSubPage} from './pluginDoc';
import {docByPath, resolveDocLink, searchDocs} from './docsApi';
import {DocCrumb, DocsHostMessage, DocsWebviewMessage} from '../../webview/messages';
// Copy of core's editor docs landing page (ui/src/assets/docs/basic.md).
const basic = require('./basic.md') as string;

// Docs content is versioned, this recent one still resolves when the instance version is unreachable.
const FALLBACK_DOCS_VERSION = '1.3.0';
const CURSOR_DEBOUNCE_MS = 200;

type HistoryEntry =
    | {kind: 'home'}
    | {kind: 'doc'; path: string}
    | {kind: 'plugin'; type: string}
    | {kind: 'plugins'}
    | {kind: 'pluginGroup'; name: string}
    | {kind: 'pluginSub'; sub: string};

type View = {html: string; title: string; crumbs?: DocCrumb[]};

export default class DocumentationPanel {
    private static _current: DocumentationPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _apiClient: ApiClient;
    private _disposables: vscode.Disposable[] = [];
    private _ready = false;
    private _queue: DocsHostMessage[] = [];
    private _version: Promise<string> | undefined;
    private _page: {path: string; isIndex?: boolean} | undefined;
    private _history: HistoryEntry[] = [];
    private _pluginType: string | null = null;
    private _icons: Promise<Record<string, {icon?: string}> | null> | undefined;
    private _groupIcons: Promise<Record<string, {icon?: string}> | null> | undefined;
    private _plugins: Promise<PluginEntry[] | null> | undefined;
    private _definitions = new Map<string, Promise<PluginDefinition | null>>();
    private _showSeq = 0;
    private _searchSeq = 0;
    private _cursorTimer: ReturnType<typeof setTimeout> | undefined;

    public static createOrShow(extensionUri: vscode.Uri, apiClient: ApiClient) {
        const column = vscode.ViewColumn.Beside;
        if (DocumentationPanel._current) {
            DocumentationPanel._current._panel.reveal(column, true);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'kestra.documentation',
            'Kestra Documentation',
            {viewColumn: column, preserveFocus: true},
            {
                enableScripts: true,
                // Keeps the page, history, and scroll position when the tab is hidden.
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'media')
                ]
            }
        );
        DocumentationPanel._current = new DocumentationPanel(panel, extensionUri, apiClient);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, apiClient: ApiClient) {
        this._panel = panel;
        this._apiClient = apiClient;
        this._panel.webview.html = webviewHtml(this._panel.webview, extensionUri, {
            title: 'Kestra Documentation',
            style: 'docs.css',
            script: 'docs.js',
            allowImages: true,
            remoteImages: true
        });
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(message => this.handleMessage(message), undefined, this._disposables);
        // Placing the cursor on a task shows that plugin's documentation.
        vscode.window.onDidChangeTextEditorSelection(event => this.followCursor(event), undefined, this._disposables);
    }

    private async handleMessage(message: DocsWebviewMessage) {
        switch (message.type) {
            case 'ready':
                this._ready = true;
                this._queue.forEach(m => this._panel.webview.postMessage(m));
                this._queue = [];
                await this.show({kind: 'home'});
                break;
            case 'open':
                await this.openLink(message.href);
                break;
            case 'openPath':
                await this.show({kind: 'doc', path: message.path});
                break;
            case 'nav':
                await this.navigate(message.target);
                break;
            case 'search': {
                const seq = ++this._searchSeq;
                const items = await searchDocs(await this.version(), message.q);
                // Only the latest query may render, slower earlier responses are dropped.
                if (seq === this._searchSeq) {
                    this.post({type: 'results', items});
                }
                break;
            }
            case 'copy':
                await vscode.env.clipboard.writeText(message.text);
                break;
            case 'back': {
                const previous = this._history[this._history.length - 2];
                if (previous && await this.show(previous, false)) {
                    this._history.pop();
                }
                break;
            }
        }
    }

    private async openLink(href: string) {
        if (!this._page) {
            return;
        }
        const link = resolveDocLink(href, this._page);
        if ('external' in link) {
            vscode.env.openExternal(vscode.Uri.parse(link.external));
            return;
        }
        await this.show({kind: 'doc', path: link.docPath});
    }

    private async show(entry: HistoryEntry, push = true): Promise<boolean> {
        const seq = ++this._showSeq;
        const view = await this.render(entry).catch(() => null);
        // A slower earlier render must not overwrite the page shown by a newer action.
        if (seq !== this._showSeq) {
            return false;
        }
        if (!view) {
            // A task type with no loadable doc keeps the current page instead of replacing it.
            if (entry.kind !== 'plugin') {
                this.post({type: 'notice', text: 'Could not load this documentation page.'});
            }
            return false;
        }
        if (push) {
            this._history.push(entry);
        }
        this.post({type: 'doc', html: view.html, title: view.title, canBack: this._history.length > 1, crumbs: view.crumbs ?? []});
        return true;
    }

    // Breadcrumb and list-row targets posted back by the webview.
    private async navigate(target: string) {
        if (target === 'plugins') {
            await this.show({kind: 'plugins'});
        } else if (target.startsWith('group:')) {
            await this.show({kind: 'pluginGroup', name: target.slice('group:'.length)});
        } else if (target.startsWith('sub:')) {
            await this.show({kind: 'pluginSub', sub: target.slice('sub:'.length)});
        } else if (target.startsWith('type:')) {
            await this.show({kind: 'plugin', type: target.slice('type:'.length)});
        }
    }

    private async render(entry: HistoryEntry): Promise<View | null> {
        if (entry.kind === 'home') {
            this._page = {path: ''};
            return {html: renderDocMarkdown(basic), title: ''};
        }
        if (entry.kind === 'doc') {
            const page = await docByPath(await this.version(), entry.path);
            if (!page) {
                return null;
            }
            this._page = page;
            return {html: renderDocMarkdown(page.markdown), title: page.title};
        }
        if (entry.kind === 'plugin') {
            const definition = await this.definition(entry.type);
            if (!definition) {
                return null;
            }
            this._page = {path: ''};
            const crumbs = await this.pluginCrumbs(entry.type);
            // Older payloads may only carry markdown.
            if (definition.schema?.properties) {
                return {html: renderPluginDoc(entry.type, definition.schema, (await this.typeIconResolver())(entry.type)), title: '', crumbs};
            }
            return definition.markdown ? {html: renderDocMarkdown(definition.markdown), title: entry.type.split('.').pop() ?? entry.type, crumbs} : null;
        }
        return this.renderBrowser(entry);
    }

    private async renderBrowser(entry: {kind: 'plugins'} | {kind: 'pluginGroup'; name: string} | {kind: 'pluginSub'; sub: string}): Promise<View | null> {
        const entries = await this.plugins();
        if (!entries) {
            return null;
        }
        this._page = {path: ''};
        const groupIcon = await this.groupIconResolver();
        if (entry.kind === 'plugins') {
            return {html: renderPluginList(entries, groupIcon), title: '', crumbs: [{label: 'Plugins'}]};
        }
        if (entry.kind === 'pluginGroup') {
            const root = entries.find(candidate => candidate.name === entry.name && !candidate.subGroup);
            if (!root) {
                return null;
            }
            const subs = entries.filter(candidate => candidate.name === entry.name && candidate.subGroup);
            return {
                html: renderGroupPage(root, subs, groupIcon),
                title: '',
                crumbs: [{label: 'Plugins', nav: 'plugins'}, {label: root.title ?? entry.name}]
            };
        }
        const sub = entries.find(candidate => candidate.subGroup === entry.sub);
        if (!sub) {
            return null;
        }
        const typeIcon = await this.typeIconResolver();
        const root = entries.find(candidate => candidate.name === sub.name && !candidate.subGroup);
        return {
            html: renderSubPage(sub, (key: string) => typeIcon(key) ?? groupIcon(sub.subGroup ?? '')),
            title: '',
            crumbs: [
                {label: 'Plugins', nav: 'plugins'},
                {label: root?.title ?? sub.name ?? '', nav: `group:${sub.name}`},
                {label: sub.title ?? ''}
            ]
        };
    }

    // Plugins / <plugin> / <subgroup> / <ClassName>, each level navigable.
    private async pluginCrumbs(type: string): Promise<DocCrumb[]> {
        const name = type.split('.').pop() ?? type;
        const entries = await this.plugins();
        const sub = entries?.find(candidate => candidate.subGroup && pluginElements(candidate).some(element => element.cls === type));
        if (!entries || !sub) {
            return [{label: 'Plugins', nav: 'plugins'}, {label: name}];
        }
        const root = entries.find(candidate => candidate.name === sub.name && !candidate.subGroup);
        return [
            {label: 'Plugins', nav: 'plugins'},
            {label: root?.title ?? sub.name ?? '', nav: `group:${sub.name}`},
            {label: sub.title ?? '', nav: `sub:${sub.subGroup}`},
            {label: name}
        ];
    }

    // Cached per type for the panel's lifetime, failures included, so cursor movement cannot storm the API.
    private definition(type: string): Promise<PluginDefinition | null> {
        let cached = this._definitions.get(type);
        if (!cached) {
            cached = this._apiClient.pluginDefinition(type);
            this._definitions.set(type, cached);
        }
        return cached;
    }

    // A failed fetch is not memoized, the next interaction retries.
    private plugins(): Promise<PluginEntry[] | null> {
        this._plugins ??= this._apiClient.pluginSubgroups().then(entries => {
            if (!entries) {
                this._plugins = undefined;
            }
            return entries;
        });
        return this._plugins;
    }

    private async groupIconResolver(): Promise<IconResolver> {
        this._groupIcons ??= this._apiClient.pluginGroupIcons().then(icons => {
            if (!icons) {
                this._groupIcons = undefined;
            }
            return icons;
        });
        const icons = await this._groupIcons;
        return key => {
            const base64 = icons?.[key]?.icon;
            return base64 ? `data:image/svg+xml;base64,${base64}` : undefined;
        };
    }

    private async typeIconResolver(): Promise<IconResolver> {
        this._icons ??= this._apiClient.pluginIcons().then(icons => {
            if (!icons) {
                this._icons = undefined;
            }
            return icons;
        });
        const icons = await this._icons;
        return key => {
            const base64 = icons?.[key]?.icon;
            return base64 ? `data:image/svg+xml;base64,${base64}` : undefined;
        };
    }

    private version(): Promise<string> {
        this._version ??= this._apiClient.instanceVersion().then(version => {
            if (!version) {
                this._version = undefined;
                return FALLBACK_DOCS_VERSION;
            }
            return version;
        });
        return this._version;
    }

    // Selection events fire at keystroke rate and getTaskType parses the document, so debounce.
    private followCursor(event: vscode.TextEditorSelectionChangeEvent) {
        clearTimeout(this._cursorTimer);
        this._cursorTimer = setTimeout(() => this.showCursorType(event), CURSOR_DEBOUNCE_MS);
    }

    private async showCursorType(event: vscode.TextEditorSelectionChangeEvent) {
        const document = event.textEditor.document;
        const position = event.selections[0]?.active;
        if (!this._panel.visible || !position || document.languageId !== 'yaml') {
            return;
        }
        // getTaskType expects 1-based lines, editor positions are 0-based.
        const type = YamlUtils.getTaskType(document.getText(), {lineNumber: position.line + 1, column: position.character});
        if (!type || type === this._pluginType) {
            return;
        }
        if (await this.show({kind: 'plugin', type})) {
            this._pluginType = type;
        }
    }

    private post(message: DocsHostMessage) {
        if (this._ready) {
            this._panel.webview.postMessage(message);
        } else {
            this._queue.push(message);
        }
    }

    public dispose() {
        clearTimeout(this._cursorTimer);
        DocumentationPanel._current = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}
