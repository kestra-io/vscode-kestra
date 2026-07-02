import * as vscode from 'vscode';
import {FlowInput, LogEntry, RunOutput} from './runOutput';
import {sanitizeFileName} from './libs/runHelpers';
import {makeNonce} from './webviewHelpers';
import {HostMessage, WebviewMessage} from '../webview/messages';

export default class RunPanel implements RunOutput {
    public static current: RunPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _ready = false;
    private _queue: HostMessage[] = [];
    private _inputsResolver?: (values: FormData | undefined) => void;
    private _pendingFiles: Record<string, {name: string; data: Uint8Array}> = {};

    public static createOrShow(extensionUri: vscode.Uri): RunPanel {
        const column = vscode.ViewColumn.Beside;

        if (RunPanel.current) {
            RunPanel.current._panel.reveal(column, true);
            return RunPanel.current;
        }

        const panel = vscode.window.createWebviewPanel(
            'kestra.execution',
            'Kestra Execution',
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
        RunPanel.current = new RunPanel(panel, extensionUri);
        return RunPanel.current;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this.getHtml();
        this._panel.webview.onDidReceiveMessage(message => this.handleMessage(message), undefined, this._disposables);
    }

    private async handleMessage(message: WebviewMessage) {
        if ('type' in message && message.type === 'ready') {
            this._ready = true;
            this._queue.forEach(m => this._panel.webview.postMessage(m));
            this._queue = [];
            return;
        }
        if (!('command' in message)) {
            return;
        }
        switch (message.command) {
            case 'openExternal':
                vscode.env.openExternal(vscode.Uri.parse(message.url));
                break;
            case 'copy':
                vscode.env.clipboard.writeText(message.text);
                vscode.window.showInformationMessage("Execution logs copied to clipboard.");
                break;
            case 'submitInputs':
                this.resolveInputs(this.buildForm(message.values));
                break;
            case 'cancelInputs':
                this.resolveInputs(undefined);
                break;
            case 'pickFile':
                await this.pickFile(message.inputId);
                break;
        }
    }

    private buildForm(values: Record<string, string>): FormData {
        const form = new FormData();
        for (const key of Object.keys(values)) {
            form.append(key, values[key]);
        }
        for (const key of Object.keys(this._pendingFiles)) {
            const file = this._pendingFiles[key];
            form.append(key, new Blob([file.data]), file.name);
        }
        return form;
    }

    private resolveInputs(form: FormData | undefined) {
        this._inputsResolver?.(form);
        this._inputsResolver = undefined;
    }

    private async pickFile(inputId: string) {
        const picked = await vscode.window.showOpenDialog({canSelectMany: false, openLabel: 'Select'});
        if (!picked || !picked[0]) {
            return;
        }
        const data = await vscode.workspace.fs.readFile(picked[0]);
        const name = sanitizeFileName(picked[0].path.split('/').pop() ?? 'file');
        this._pendingFiles[inputId] = {name, data};
        this.post({type: 'fileChosen', inputId, name});
    }

    // Buffers messages until the webview signals it is ready, so the first log lines are never dropped.
    private post(message: HostMessage) {
        if (this._ready) {
            this._panel.webview.postMessage(message);
        } else {
            this._queue.push(message);
        }
    }

    public reset(flow: string) {
        this.post({type: 'reset', flow});
    }

    public setPhase(text: string) {
        this.post({type: 'phase', text});
    }

    public setExecution(id: string, url: string) {
        this.post({type: 'execution', id, url});
    }

    public appendLog(log: LogEntry) {
        this.post({type: 'log', ...log});
    }

    public updateTask(taskId: string, state: string, durationSeconds?: number) {
        this.post({type: 'task', taskId, state, duration: durationSeconds});
    }

    public requestInputs(inputs: FlowInput[]): Promise<FormData | undefined> {
        return new Promise(resolve => {
            this._inputsResolver = resolve;
            this._pendingFiles = {};
            this.post({type: 'inputs', inputs});
        });
    }

    public error(text: string) {
        this.post({type: 'error', text});
    }

    public setStatus(state: string) {
        this.post({type: 'status', state});
    }

    public dispose() {
        RunPanel.current = undefined;
        this.resolveInputs(undefined);
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    private getHtml(): string {
        const nonce = makeNonce();
        const webview = this._panel.webview;
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'runPanel.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'runPanel.css'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kestra Execution</title>
    <link href="${styleUri}" rel="stylesheet">
</head>
<body>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
