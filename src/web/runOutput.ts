import * as vscode from 'vscode';
import {sanitizeFileName} from './libs/runHelpers';
import {stateSymbol} from '../shared/executionState';
import {FlowInput, LogEntry} from '../shared/flow';

export {FlowInput, LogEntry};

export interface RunOutput {
    reset(flow: string): void;
    setPhase(text: string): void;
    setExecution(id: string, url: string): void;
    appendLog(log: LogEntry): void;
    error(text: string): void;
    setStatus(state: string): void;
    updateTask?(taskId: string, state: string, durationSeconds?: number): void;
    // Returns undefined when the user cancels.
    requestInputs(inputs: FlowInput[]): Promise<FormData | undefined>;
}

// A plain channel; a {log:true} channel cannot be cleared between runs.
export class RunLog implements RunOutput {
    private static _channel: vscode.OutputChannel | undefined;
    private readonly channel: vscode.OutputChannel;

    public static get(): RunLog {
        if (!RunLog._channel) {
            RunLog._channel = vscode.window.createOutputChannel("Kestra Execution");
        }
        return new RunLog(RunLog._channel);
    }

    private constructor(channel: vscode.OutputChannel) {
        this.channel = channel;
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

    public appendLog(log: LogEntry) {
        const time = ((log.timestamp ?? "").split("T")[1] ?? "").replace("Z", "").slice(0, 12).padEnd(12);
        const level = `[${(log.level ?? "INFO").toUpperCase()}]`.padEnd(8);
        const task = log.taskId ? `[${log.taskId}] ` : "";
        this.channel.appendLine(`${time}  ${level}${task}${log.message ?? ""}`);
    }

    public error(text: string) {
        this.channel.appendLine(`✗ ${text}`);
    }

    public setStatus(state: string) {
        this.channel.appendLine(`${stateSymbol(state)} Execution finished: ${state}`);
    }

    // The log channel has no form, so collect inputs with sequential prompts (and a file dialog for FILE).
    public async requestInputs(inputs: FlowInput[]): Promise<FormData | undefined> {
        const form = new FormData();
        for (const input of inputs) {
            const type = (input.type ?? "STRING").toUpperCase();
            if (type === "FILE") {
                const picked = await vscode.window.showOpenDialog({canSelectMany: false, openLabel: `Select file for "${input.id}"`});
                if (!picked || picked.length === 0) {
                    if (input.required) {
                        return undefined;
                    }
                    continue;
                }
                const data = await vscode.workspace.fs.readFile(picked[0]);
                form.append(input.id, new Blob([data]), sanitizeFileName(picked[0].path.split("/").pop() ?? input.id));
                continue;
            }
            const fallback = input.prefill ?? input.defaults;
            const value = await vscode.window.showInputBox({
                prompt: `Input "${input.id}"${input.type ? ` (${input.type})` : ""}${input.required ? " [required]" : ""}`,
                value: fallback === undefined || fallback === null ? "" : String(fallback),
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
