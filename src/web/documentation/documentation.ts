import * as vscode from 'vscode';
import ApiClient from '../apiClient';
import YamlUtils from '../libs/yamlUtils';
import {webviewHtml} from '../webviewHelpers';
import {renderDocMarkdown} from './docsMarkdown';
import {renderPluginDoc} from './pluginDoc';
import {docByPath, resolveDocLink, searchDocs} from './docsApi';
import {DocsHostMessage, DocsWebviewMessage} from '../../webview/messages';
// The landing content the core UI bundles for its editor docs tab (ui/src/assets/docs/basic.md).
const basic = require('./basic.md') as string;

// Docs content is versioned; this recent one still resolves when the instance version is unreachable.
const FALLBACK_DOCS_VERSION = '1.3.0';

type HistoryEntry = {kind: 'home'} | {kind: 'doc'; path: string} | {kind: 'plugin'; type: string};

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
            case 'search':
                this.post({type: 'results', items: await searchDocs(await this.version(), message.q)});
                break;
            case 'copy':
                await vscode.env.clipboard.writeText(message.text);
                break;
            case 'back': {
                this._history.pop();
                const previous = this._history[this._history.length - 1];
                if (previous) {
                    await this.show(previous, false);
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
        const view = await this.render(entry).catch(() => null);
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
        this.post({type: 'doc', html: view.html, title: view.title, canBack: this._history.length > 1});
        return true;
    }

    private async render(entry: HistoryEntry): Promise<{html: string; title: string} | null> {
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
        const definition = await this._apiClient.pluginDefinition(entry.type);
        if (!definition) {
            return null;
        }
        this._page = {path: ''};
        // The schema drives the view, as in the core UI; older payloads may only carry markdown.
        if (definition.schema?.properties) {
            return {html: renderPluginDoc(entry.type, definition.schema, await this.icon(entry.type)), title: ''};
        }
        return definition.markdown ? {html: renderDocMarkdown(definition.markdown), title: entry.type.split('.').pop() ?? entry.type} : null;
    }

    private async icon(type: string): Promise<string | undefined> {
        this._icons ??= this._apiClient.pluginIcons();
        const base64 = (await this._icons)?.[type]?.icon;
        return base64 ? `data:image/svg+xml;base64,${base64}` : undefined;
    }

    private version(): Promise<string> {
        this._version ??= this._apiClient.instanceVersion().then(version => version ?? FALLBACK_DOCS_VERSION);
        return this._version;
    }

    private async followCursor(event: vscode.TextEditorSelectionChangeEvent) {
        const document = event.textEditor.document;
        const position = event.selections[0]?.active;
        if (!this._panel.visible || !position || document.languageId !== 'yaml') {
            return;
        }
        // getTaskType expects 1-based lines; editor positions are 0-based.
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
        DocumentationPanel._current = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}
