import * as vscode from 'vscode';
import ApiClient from './apiClient';
import YamlUtils from './libs/yamlUtils';
import {isFlowDocument} from './flowValidation';
import {webviewHtml} from './webviewHelpers';
import {FlowGraph, graphNodePluginType} from '../shared/flow';
import {TopologyHostMessage, TopologyWebviewMessage} from '../webview/messages';

const REFRESH_DEBOUNCE_MS = 600;

// Keeps an open topology panel in sync with the active flow as it is edited.
export function registerTopologyRefresh(context: vscode.ExtensionContext) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (document: vscode.TextDocument | undefined) => {
        if (!TopologyPanel.current) {
            return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => TopologyPanel.current?.update(document), REFRESH_DEBOUNCE_MS);
    };
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document === vscode.window.activeTextEditor?.document) {
                refresh(event.document);
            }
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => refresh(editor?.document))
    );
}

export default class TopologyPanel {
    public static current: TopologyPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _apiClient: ApiClient;
    private _disposables: vscode.Disposable[] = [];
    private _ready = false;
    private _refreshPending = false;
    private _updateSeq = 0;
    private _lastDocument: vscode.TextDocument | undefined;
    private _lastGraphJson: string | undefined;
    private _icons: Promise<Record<string, {icon?: string}> | null> | undefined;
    private _postedIconTypes = new Set<string>();

    public static createOrShow(apiClient: ApiClient, extensionUri: vscode.Uri): TopologyPanel {
        const column = vscode.ViewColumn.Beside;
        if (TopologyPanel.current) {
            TopologyPanel.current._panel.reveal(column, true);
            return TopologyPanel.current;
        }
        const panel = vscode.window.createWebviewPanel(
            'kestra.topology',
            'Kestra Topology',
            {viewColumn: column, preserveFocus: true},
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'media')
                ]
            }
        );
        TopologyPanel.current = new TopologyPanel(panel, apiClient, extensionUri);
        return TopologyPanel.current;
    }

    private constructor(panel: vscode.WebviewPanel, apiClient: ApiClient, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._apiClient = apiClient;
        this._panel.webview.html = webviewHtml(this._panel.webview, extensionUri, {
            title: 'Kestra Topology',
            style: 'topology.css',
            script: 'topology.js',
            allowImages: true
        });
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(message => this.handleMessage(message), undefined, this._disposables);
        this._panel.onDidChangeViewState(() => this.flushPendingRefresh(), undefined, this._disposables);
    }

    private async handleMessage(message: TopologyWebviewMessage) {
        switch (message.type) {
            case 'ready':
                this._ready = true;
                await this.update(this._lastDocument);
                break;
            case 'reveal':
                await this.revealTask(message.taskId);
                break;
        }
    }

    public async update(document: vscode.TextDocument | undefined) {
        this._lastDocument = document;
        if (!this._ready) {
            return;
        }
        // A hidden panel skips fetch and layout; the pending refresh runs when it becomes visible.
        if (!this._panel.visible) {
            this._refreshPending = true;
            return;
        }
        if (!document || !isFlowDocument(document)) {
            this.showMessage('Open a flow to preview its topology.');
            return;
        }

        const seq = ++this._updateSeq;
        const graph = await this._apiClient.flowGraph(document.getText());
        if (seq !== this._updateSeq) {
            return;
        }
        if (!graph) {
            this.showMessage('Could not generate the graph (check the connection and that the flow is valid).');
            return;
        }

        // Most edits do not change the topology; skip the webview rebuild when the graph is identical.
        const json = JSON.stringify(graph);
        if (json === this._lastGraphJson) {
            return;
        }
        const icons = await this.newIconsFor(graph);
        if (seq !== this._updateSeq) {
            return;
        }
        this._lastGraphJson = json;
        this.post({type: 'graph', graph, icons});
    }

    private flushPendingRefresh() {
        if (this._panel.visible && this._refreshPending) {
            this._refreshPending = false;
            this.update(this._lastDocument);
        }
    }

    private showMessage(text: string) {
        this._lastGraphJson = undefined;
        this.post({type: 'message', text});
    }

    // Overlays a task's live execution state onto its node (called while a run streams).
    public setTaskState(taskId: string, state: string) {
        this.post({type: 'taskState', taskId, state});
    }

    public resetStates() {
        this.post({type: 'resetStates'});
    }

    // Fetches the icon map once, then sends only the icons this graph needs and the webview lacks.
    private async newIconsFor(graph: FlowGraph): Promise<Record<string, string>> {
        this._icons ??= this._apiClient.pluginIcons();
        const all = await this._icons;
        const icons: Record<string, string> = {};
        for (const node of graph.nodes) {
            const type = graphNodePluginType(node);
            if (!type || this._postedIconTypes.has(type)) {
                continue;
            }
            const base64 = all?.[type]?.icon;
            if (base64) {
                this._postedIconTypes.add(type);
                icons[type] = `data:image/svg+xml;base64,${base64}`;
            }
        }
        return icons;
    }

    // Reveals and selects the task with the given id in the source document.
    private async revealTask(taskId: string) {
        const document = this._lastDocument;
        if (!document) {
            return;
        }
        const offsets = YamlUtils.taskRangeById(document.getText(), taskId);
        if (!offsets) {
            return;
        }
        const range = new vscode.Range(document.positionAt(offsets[0]), document.positionAt(offsets[1]));
        const editor = await vscode.window.showTextDocument(document, {viewColumn: vscode.ViewColumn.One});
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }

    private post(message: TopologyHostMessage) {
        this._panel.webview.postMessage(message);
    }

    public dispose() {
        TopologyPanel.current = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}
