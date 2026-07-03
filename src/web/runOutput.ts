import * as vscode from 'vscode';
import {sanitizeFileName} from './libs/runHelpers';
import {FlowInput, LogEntry, formatLogLine, inputFallback, isInputRequired} from '../shared/flow';
import RunPanel from './runPanel';

export interface RunOutput {
    reset(flow: string, logLevel: string): void;
    setPhase(text: string): void;
    setExecution(id: string, url: string): void;
    appendLogs(entries: LogEntry[]): void;
    error(text: string): void;
    setStatus(state: string): void;
    setTaskState(taskId: string, state: string, durationSeconds?: number): void;
    requestInputs(inputs: FlowInput[]): Promise<FormData | undefined>;
}

// The panel filters levels client-side so it fetches everything, the log channel fetches at the configured level.
export function createRunOutput(extensionUri: vscode.Uri, flowUid: string): {output: RunOutput; fetchLevel: string; logLevel: string} {
    const config = vscode.workspace.getConfiguration("kestra.run");
    const logLevel = config.get("logLevel", "INFO");
    if (config.get("output") === "logs") {
        return {output: RunLog.get(flowUid), fetchLevel: logLevel, logLevel};
    }
    return {output: RunPanel.createOrShow(extensionUri, flowUid), fetchLevel: "TRACE", logLevel};
}

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

// One plain channel per flow, with the "log" language id: {log: true} channels cannot be cleared between runs.
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
        this._channel.appendLine(`Execution ${state}`);
    }

    public setTaskState() {
        // Task transitions are already visible as log lines in the channel.
    }

    // No form in a channel, so inputs are collected with sequential prompts.
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
