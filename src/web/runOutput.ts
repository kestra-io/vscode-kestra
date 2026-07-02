import * as vscode from 'vscode';
import {sanitizeFileName} from './libs/runHelpers';
import {stateSymbol} from '../shared/executionState';
import {FlowInput, LogEntry, formatLogLine, inputFallback} from '../shared/flow';
import RunPanel from './runPanel';

export interface RunOutput {
    reset(flow: string, logLevel: string): void;
    setPhase(text: string): void;
    setExecution(id: string, url: string): void;
    appendLogs(entries: LogEntry[]): void;
    error(text: string): void;
    setStatus(state: string): void;
    updateTask(taskId: string, state: string, durationSeconds?: number): void;
    // Returns undefined when the user cancels.
    requestInputs(inputs: FlowInput[]): Promise<FormData | undefined>;
}

// The configured output plus the level to fetch: the panel filters client-side so it fetches
// everything, while the log channel shows all it fetches so it fetches at the configured level.
export function createRunOutput(extensionUri: vscode.Uri, flowUid: string): {output: RunOutput; fetchLevel: string; logLevel: string} {
    const config = vscode.workspace.getConfiguration("kestra.run");
    const logLevel = (config.get("logLevel") as string) || "INFO";
    if (config.get("output") === "logs") {
        return {output: RunLog.get(flowUid), fetchLevel: logLevel, logLevel};
    }
    return {output: RunPanel.createOrShow(extensionUri, flowUid), fetchLevel: "TRACE", logLevel};
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
export class RunLog implements RunOutput {
    private static channels = new Map<string, RunLog>();
    private readonly channel: vscode.OutputChannel;

    public static get(flowUid: string): RunLog {
        let instance = RunLog.channels.get(flowUid);
        if (!instance) {
            instance = new RunLog(flowUid);
            RunLog.channels.set(flowUid, instance);
        }
        return instance;
    }

    private constructor(flowUid: string) {
        this.channel = vscode.window.createOutputChannel(`Kestra: ${flowUid}`, "log");
    }

    public reset(flow: string) {
        this.channel.clear();
        this.channel.show(true);
        this.channel.appendLine(`▶ Running ${flow}`);
    }

    public setPhase(text: string) {
        this.channel.appendLine(text);
    }

    public setExecution(id: string, url: string) {
        this.channel.appendLine(`  Execution ${id}`);
        this.channel.appendLine(`  Open in Kestra: ${url}`);
    }

    public appendLogs(entries: LogEntry[]) {
        entries.forEach(entry => this.channel.appendLine(formatLogLine(entry)));
    }

    public error(text: string) {
        this.channel.appendLine(`✗ ${text}`);
    }

    public setStatus(state: string) {
        this.channel.appendLine(`${stateSymbol(state)} Execution finished: ${state}`);
    }

    public updateTask() {
        // Task transitions are already visible as log lines in the channel.
    }

    // The log channel has no form, so collect inputs with sequential prompts (and a file dialog for FILE).
    public async requestInputs(inputs: FlowInput[]): Promise<FormData | undefined> {
        const form = new FormData();
        for (const input of inputs) {
            const type = (input.type ?? "STRING").toUpperCase();
            if (type === "FILE") {
                const file = await pickInputFile(input.id);
                if (!file) {
                    if (input.required) {
                        return undefined;
                    }
                    continue;
                }
                form.append(input.id, new Blob([file.data]), file.name);
                continue;
            }
            const fallback = inputFallback(input);
            const value = await vscode.window.showInputBox({
                prompt: `Input "${input.id}"${input.type ? ` (${input.type})` : ""}${input.required ? " [required]" : ""}`,
                value: String(fallback),
                ignoreFocusOut: true,
                password: type === "SECRET"
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
