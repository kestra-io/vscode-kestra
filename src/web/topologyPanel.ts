import * as vscode from 'vscode';
import ApiClient from './apiClient';
import YamlUtils from './libs/yamlUtils';
import {isFlowDocument} from './flowValidation';
import {makeNonce} from './webviewHelpers';
import {FlowGraph, TopologyHostMessage, TopologyWebviewMessage} from '../webview/messages';

export default class TopologyPanel {
    public static current: TopologyPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _apiClient: ApiClient;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _ready = false;
    private _lastDocument: vscode.TextDocument | undefined;
    private _icons: Record<string, {icon?: string}> | null = null;
    private _iconsLoaded = false;

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
        this._extensionUri = extensionUri;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this.getHtml();
        this._panel.webview.onDidReceiveMessage(message => this.handleMessage(message), undefined, this._disposables);
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
        if (!document || !isFlowDocument(document)) {
            this.post({type: 'message', text: 'Open a flow to preview its topology.'});
            return;
        }
        const response = await this._apiClient.flowGraph(document.getText());
        if (!response) {
            this.post({type: 'message', text: 'Could not generate the graph (check the connection and that the flow is valid).'});
            return;
        }
        const graph = (await response.json().catch(() => undefined)) as FlowGraph | undefined;
        this.post({type: 'graph', graph, icons: await this.iconsFor(graph)});
    }

    // Overlays a task's live execution state onto its node (called while a run streams).
    public setTaskState(taskId: string, state: string) {
        this.post({type: 'taskState', taskId, state});
    }

    public resetStates() {
        this.post({type: 'resetStates'});
    }

    // Loads the icon map once, then returns just the data-URI icons for the task types in this graph.
    private async iconsFor(graph: FlowGraph | undefined): Promise<Record<string, string>> {
        if (!this._iconsLoaded) {
            this._iconsLoaded = true;
            this._icons = await this._apiClient.pluginIcons();
        }
        const icons: Record<string, string> = {};
        for (const node of graph?.nodes ?? []) {
            const type = node.task?.type ?? node.trigger?.type;
            const base64 = type ? this._icons?.[type]?.icon : undefined;
            if (type && base64) {
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

    private getHtml(): string {
        const nonce = makeNonce();
        const webview = this._panel.webview;
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'topology.js'));
        const tokensUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'tokens.css'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'topology.css'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kestra Topology</title>
    <link href="${tokensUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
</head>
<body>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
