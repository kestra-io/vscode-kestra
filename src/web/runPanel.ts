import * as vscode from 'vscode';
import {RunOutput, pickInputFile} from './runOutput';
import {FlowInput, LogEntry} from '../shared/flow';
import {webviewHtml} from './webviewHelpers';
import {HostMessage, WebviewMessage} from '../webview/messages';

const LOG_BATCH_MS = 80;

export default class RunPanel implements RunOutput {
    private static panels = new Map<string, RunPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _flowUid: string;
    private _disposables: vscode.Disposable[] = [];
    private _ready = false;
    private _queue: HostMessage[] = [];
    private _inputsResolver?: (values: FormData | undefined) => void;
    private _pendingFiles: Record<string, {name: string; data: Uint8Array}> = {};
    private _pendingLogs: LogEntry[] = [];
    private _logFlushTimer: ReturnType<typeof setTimeout> | undefined;
    private _disposed = false;

    public static createOrShow(extensionUri: vscode.Uri, flowUid: string): RunPanel {
        const column = vscode.ViewColumn.Beside;

        const existing = RunPanel.panels.get(flowUid);
        if (existing) {
            existing._panel.reveal(column, true);
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            'kestra.execution',
            `Kestra: ${flowUid}`,
            {viewColumn: column, preserveFocus: true},
            {
                enableScripts: true,
                // The host never re-sends log history, so a rebuilt webview would come back blank.
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'media')
                ]
            }
        );
        const created = new RunPanel(panel, extensionUri, flowUid);
        RunPanel.panels.set(flowUid, created);
        return created;
    }

    private static html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        return webviewHtml(webview, extensionUri, {title: 'Kestra Execution', style: 'runPanel.css', script: 'runPanel.js', codicons: true});
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, flowUid: string) {
        this._panel = panel;
        this._flowUid = flowUid;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = RunPanel.html(this._panel.webview, extensionUri);
        this._panel.webview.onDidReceiveMessage(message => this.handleMessage(message), undefined, this._disposables);
    }

    private async handleMessage(message: WebviewMessage) {
        switch (message.type) {
            case 'ready':
                this._ready = true;
                this._queue.forEach(m => this._panel.webview.postMessage(m));
                this._queue = [];
                break;
            case 'copy':
                vscode.env.clipboard.writeText(message.text);
                vscode.window.showInformationMessage('Execution logs copied to clipboard.');
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
        const file = await pickInputFile(inputId);
        if (!file) {
            return;
        }
        this._pendingFiles[inputId] = file;
        this.post({type: 'fileChosen', inputId, name: file.name});
    }

    private post(message: HostMessage) {
        if (this._disposed) {
            return;
        }
        if (this._ready) {
            this._panel.webview.postMessage(message);
        } else {
            this._queue.push(message);
        }
    }

    public reset(flow: string, logLevel: string) {
        this.post({type: 'reset', flow, level: logLevel});
    }

    public setPhase(text: string) {
        this.post({type: 'phase', text});
    }

    public setExecution(id: string, url: string) {
        this.post({type: 'execution', id, url});
    }

    // The stream delivers roughly one frame per line, so batch them into one webview message per tick.
    public appendLogs(entries: LogEntry[]) {
        this._pendingLogs.push(...entries);
        this._logFlushTimer ??= setTimeout(() => this.flushLogs(), LOG_BATCH_MS);
    }

    private flushLogs() {
        this._logFlushTimer = undefined;
        if (this._pendingLogs.length > 0) {
            this.post({type: 'logs', entries: this._pendingLogs});
            this._pendingLogs = [];
        }
    }

    public setTaskState(taskId: string, state: string, durationSeconds?: number) {
        this.post({type: 'taskState', taskId, state, duration: durationSeconds});
    }

    public requestInputs(inputs: FlowInput[]): Promise<FormData | undefined> {
        if (this._disposed) {
            return Promise.resolve(undefined);
        }
        // A run restarted while the form is open cancels the previous prompt.
        this.resolveInputs(undefined);
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
        this._disposed = true;
        clearTimeout(this._logFlushTimer);
        RunPanel.panels.delete(this._flowUid);
        this.resolveInputs(undefined);
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

}
