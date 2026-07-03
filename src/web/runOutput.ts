import * as vscode from 'vscode';
import {sanitizeFileName} from './libs/runHelpers';
import {stateSymbol} from '../shared/executionState';
import {FlowInput, LogEntry, formatLogLine, inputFallback, isInputRequired} from '../shared/flow';
import RunPanel from './runPanel';
import TopologyPanel from './topologyPanel';

export interface RunOutput {
    reset(flow: string, logLevel: string): void;
    setPhase(text: string): void;
    setExecution(id: string, url: string): void;
    appendLogs(entries: LogEntry[]): void;
    error(text: string): void;
    setStatus(state: string): void;
    setTaskState(taskId: string, state: string, durationSeconds?: number): void;
    // Returns undefined when the user cancels.
    requestInputs(inputs: FlowInput[]): Promise<FormData | undefined>;
}

// The configured output plus the level to fetch: the panel filters client-side so it fetches
// everything, while the log channel shows all it fetches so it fetches at the configured level.
export function createRunOutput(extensionUri: vscode.Uri, flowUid: string): {output: RunOutput; fetchLevel: string; logLevel: string} {
    const config = vscode.workspace.getConfiguration("kestra.run");
    const logLevel = config.get("logLevel", "INFO");
    if (config.get("output") === "logs") {
        return {output: new TopologyOverlay(RunLog.get(flowUid)), fetchLevel: logLevel, logLevel};
    }
    return {output: new TopologyOverlay(RunPanel.createOrShow(extensionUri, flowUid)), fetchLevel: "TRACE", logLevel};
}

// Forwards run events to an open topology preview so the graph colors live during a run.
class TopologyOverlay implements RunOutput {
    public constructor(private readonly inner: RunOutput) {}

    public reset(flow: string, logLevel: string) {
        this.inner.reset(flow, logLevel);
        TopologyPanel.current?.resetStates();
    }

    public setTaskState(taskId: string, state: string, durationSeconds?: number) {
        this.inner.setTaskState(taskId, state, durationSeconds);
        TopologyPanel.current?.setTaskState(taskId, state);
    }

    public setPhase(text: string) {
        this.inner.setPhase(text);
    }

    public setExecution(id: string, url: string) {
        this.inner.setExecution(id, url);
    }

    public appendLogs(entries: LogEntry[]) {
        this.inner.appendLogs(entries);
    }

    public error(text: string) {
        this.inner.error(text);
    }

    public setStatus(state: string) {
        this.inner.setStatus(state);
    }

    public requestInputs(inputs: FlowInput[]): Promise<FormData | undefined> {
        return this.inner.requestInputs(inputs);
    }
}

// Disposes every run log channel; registered in the extension's subscriptions.
export function disposeRunLogs() {
    RunLog.disposeAll();
}

export async function pickInputFile(inputId: string): Promise<{name: string; data: Uint8Array} | undefined> {
    const picked = await vscode.window.showOpenDialog({canSelectMany: false, openLabel: `Select file for "${inputId}"`});
    if (!picked || picked.length === 0) {
        return undefined;
    }
    const data = await vscode.workspace.fs.readFile(picked[0]);
    return {name: sanitizeFileName(picked[0].path.split("/").pop() ?? inputId), data};
}

// A plain channel; a {log:true} channel cannot be cleared between runs.
// The "log" language id makes VS Code colorize timestamps and severity words.
// One channel per flow, so concurrent runs of different flows never interleave.
class RunLog implements RunOutput {
    private static _channels = new Map<string, RunLog>();
    private readonly _channel: vscode.OutputChannel;

    public static get(flowUid: string): RunLog {
        let instance = RunLog._channels.get(flowUid);
        if (!instance) {
            instance = new RunLog(flowUid);
            RunLog._channels.set(flowUid, instance);
        }
        return instance;
    }

    public static disposeAll() {
        RunLog._channels.forEach(log => log._channel.dispose());
        RunLog._channels.clear();
    }

    private constructor(flowUid: string) {
        this._channel = vscode.window.createOutputChannel(`Kestra: ${flowUid}`, "log");
    }

    public reset(flow: string) {
        this._channel.clear();
        this._channel.show(true);
        this._channel.appendLine(`▶ Running ${flow}`);
    }

    public setPhase(text: string) {
        this._channel.appendLine(text);
    }

    public setExecution(id: string, url: string) {
        this._channel.appendLine(`  Execution ${id}`);
        this._channel.appendLine(`  Open in Kestra: ${url}`);
    }

    public appendLogs(entries: LogEntry[]) {
        entries.forEach(entry => this._channel.appendLine(formatLogLine(entry)));
    }

    public error(text: string) {
        this._channel.appendLine(`✗ ${text}`);
    }

    public setStatus(state: string) {
        this._channel.appendLine(`${stateSymbol(state)} Execution finished: ${state}`);
    }

    public setTaskState() {
        // Task transitions are already visible as log lines in the channel.
    }

    // The log channel has no form, so collect inputs with sequential prompts (and a file dialog for FILE).
    public async requestInputs(inputs: FlowInput[]): Promise<FormData | undefined> {
        const form = new FormData();
        for (const input of inputs) {
            const type = (input.type ?? "STRING").toUpperCase();
            const required = isInputRequired(input);
            if (type === "FILE") {
                const file = await pickInputFile(input.id);
                if (!file) {
                    if (required) {
                        return undefined;
                    }
                    continue;
                }
                form.append(input.id, new Blob([file.data]), file.name);
                continue;
            }
            const fallback = inputFallback(input);
            // Empty is only acceptable when the input is optional or the server has a default to apply.
            const blocksEmpty = required && fallback === '';
            const value = await vscode.window.showInputBox({
                prompt: `Input "${input.id}"${input.type ? ` (${input.type})` : ""}${required ? " [required]" : ""}`,
                value: String(fallback),
                ignoreFocusOut: true,
                password: type === "SECRET",
                validateInput: text => blocksEmpty && !text.trim() ? "This input is required." : undefined
            });
            if (value === undefined) {
                return undefined;
            }
            if (value !== "") {
                form.append(input.id, value);
            }
        }
        return form;
    }
}
