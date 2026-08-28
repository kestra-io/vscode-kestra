import * as vscode from 'vscode';

// A single "Kestra" log channel (View -> Output -> Kestra) for events that would otherwise fail
// silently, a partial namespace page, a truncated list, an individual file that did not upload.
let channel: vscode.LogOutputChannel | undefined;

export function initLog(context: vscode.ExtensionContext): void {
    if (!channel) {
        channel = vscode.window.createOutputChannel("Kestra", {log: true});
        context.subscriptions.push(channel);
    }
}

export function logInfo(message: string): void {
    channel?.info(message);
}

export function logWarn(message: string): void {
    channel?.warn(message);
}

export function logError(message: string): void {
    channel?.error(message);
}
