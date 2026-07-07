import * as vscode from 'vscode';
import ApiClient from './apiClient';
import YamlUtils from './libs/yamlUtils';

export type ValidateResult = {
    constraints?: string | null;
    warnings?: string[];
    infos?: string[];
    deprecationPaths?: string[];
};

export function splitConstraints(constraints: string | null | undefined): string[] {
    return constraints ? String(constraints).split("\n").map(message => message.trim()).filter(Boolean) : [];
}

const DEBOUNCE_MS = 500;

export function registerFlowValidation(context: vscode.ExtensionContext, apiClient: ApiClient) {
    const diagnostics = vscode.languages.createDiagnosticCollection("kestra");
    context.subscriptions.push(diagnostics);

    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const requests = new Map<string, AbortController>();

    const asyncValidate = async (document: vscode.TextDocument) => {
        if (document.languageId !== "yaml") {
            return;
        }
        const key = document.uri.toString();
        const text = document.getText();
        if (!YamlUtils.isFlow(text)) {
            diagnostics.delete(document.uri);
            return;
        }

        requests.get(key)?.abort();
        const controller = new AbortController();
        requests.set(key, controller);

        const response = await apiClient.validateFlowSilent(text, controller.signal);
        if (requests.get(key) !== controller) {
            return;
        }
        requests.delete(key);
        if (!response) {
            return;
        }
        const results = (await response.json().catch(() => [])) as ValidateResult[];
        diagnostics.set(document.uri, buildDiagnostics(results, document));
    };

    const schedule = (document: vscode.TextDocument) => {
        const key = document.uri.toString();
        const pending = timers.get(key);
        if (pending) {
            clearTimeout(pending);
        }
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            asyncValidate(document);
        }, DEBOUNCE_MS));
    };

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => schedule(event.document)),
        vscode.workspace.onDidOpenTextDocument(document => asyncValidate(document)),
        vscode.workspace.onDidCloseTextDocument(document => {
            diagnostics.delete(document.uri);
            const key = document.uri.toString();
            timers.delete(key);
            requests.get(key)?.abort();
            requests.delete(key);
        })
    );

    if (vscode.window.activeTextEditor) {
        asyncValidate(vscode.window.activeTextEditor.document);
    }
}

export function isFlowDocument(document: vscode.TextDocument): boolean {
    return document.languageId === "yaml" && YamlUtils.isFlow(document.getText());
}

function buildDiagnostics(results: ValidateResult[], document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];

    for (const result of results ?? []) {
        for (const message of splitConstraints(result.constraints)) {
            diagnostics.push(diagnostic(rangeForMessage(message, document), message, vscode.DiagnosticSeverity.Error));
        }
        for (const path of result.deprecationPaths ?? []) {
            const range = rangeForPath(document, parsePath(path)) ?? firstLineRange(document);
            diagnostics.push(diagnostic(range, `Deprecated: ${path}`, vscode.DiagnosticSeverity.Warning));
        }
        for (const warning of result.warnings ?? []) {
            diagnostics.push(diagnostic(rangeForMessage(warning, document), warning, vscode.DiagnosticSeverity.Warning));
        }
    }
    return diagnostics;
}

function diagnostic(range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
    const result = new vscode.Diagnostic(range, message, severity);
    result.source = "Kestra";
    return result;
}

function rangeForMessage(message: string, document: vscode.TextDocument): vscode.Range {
    const pathMatch = message.match(/^([A-Za-z_][\w]*(?:\[\d+\])?(?:\.[A-Za-z_][\w]*(?:\[\d+\])?)*):\s/);
    if (pathMatch) {
        const range = rangeForPath(document, parsePath(pathMatch[1]));
        if (range) {
            return range;
        }
    }

    const typeMatch = message.match(/Invalid type:\s*([\w.$]+)/);
    if (typeMatch) {
        const index = document.getText().indexOf(typeMatch[1]);
        if (index >= 0) {
            return new vscode.Range(document.positionAt(index), document.positionAt(index + typeMatch[1].length));
        }
    }

    return firstLineRange(document);
}

function parsePath(path: string): Array<string | number> {
    return path
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean)
        .map(segment => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function rangeForPath(document: vscode.TextDocument, segments: Array<string | number>): vscode.Range | undefined {
    const range = YamlUtils.nodeRange(document.getText(), segments);
    return range ? new vscode.Range(document.positionAt(range[0]), document.positionAt(range[1])) : undefined;
}

function firstLineRange(document: vscode.TextDocument): vscode.Range {
    const length = document.lineCount > 0 ? document.lineAt(0).text.length : 0;
    return new vscode.Range(0, 0, 0, Math.max(1, length));
}
