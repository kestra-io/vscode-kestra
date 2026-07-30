import * as vscode from 'vscode';
import ApiClient from './apiClient';

// Local metadata folders that should never be pushed to a namespace.
const IGNORED_NAMES = new Set(['.git', '.vscode', 'node_modules', '.DS_Store', '.idea']);

type LocalFile = {uri: vscode.Uri; relative: string};
type SyncOutcome = {uploaded: number; failed: string[]; stoppedByAuth: boolean; cancelled: boolean};

function basename(path: string): string {
    return path.split('/').filter(Boolean).pop() ?? path;
}

// Namespaces are free-form strings, so the picker lists known ones but always allows typing a new one.
async function pickNamespace(apiClient: ApiClient): Promise<string | undefined> {
    const manual = "$(edit) Enter namespace manually…";
    const namespaces = await apiClient.listNamespaces();
    if (namespaces.length > 0) {
        const choice = await vscode.window.showQuickPick([manual, ...namespaces], {
            title: "Kestra namespace",
            placeHolder: "Select a namespace"
        });
        if (choice === undefined) {
            return undefined;
        }
        if (choice !== manual) {
            return choice;
        }
    }
    const typed = await vscode.window.showInputBox({
        title: "Kestra namespace",
        prompt: "Namespace",
        placeHolder: "company.team",
        validateInput: value => value.trim() ? undefined : "Namespace cannot be empty"
    });
    return typed?.trim() || undefined;
}

// A 401 does not say whether the credential is invalid or the account simply lacks access, so the
// message splits on whether a credential is stored at all. (Permission denials come back as 403.)
function reachabilityError(namespace: string, result: {status?: number; detail?: string}, signedIn: boolean): string {
    switch (result.status) {
        case 401:
            return signedIn
                ? `Cannot use namespace "${namespace}": access denied. Your account may not have permission for this namespace, or your token may have expired.`
                : `Cannot use namespace "${namespace}": not signed in. Run "Kestra: Sign in" and try again.`;
        case 403:
            return `Cannot use namespace "${namespace}": you do not have permission to access its files.`;
        case 404:
            return `Namespace "${namespace}" was not found, or you cannot access it. Check the name, instance URL, and tenant.`;
        default:
            return `Cannot use namespace "${namespace}": ${result.detail ?? (result.status ? `HTTP ${result.status}` : "the instance is not reachable")}.`;
    }
}

// Returns true when the namespace files API answers, otherwise reports the specific reason and returns false.
async function ensureNamespaceReachable(apiClient: ApiClient, namespace: string): Promise<boolean> {
    const result = await apiClient.namespaceFilesReachable(namespace);
    if (result.ok) {
        return true;
    }
    vscode.window.showErrorMessage(reachabilityError(namespace, result, await apiClient.hasStoredCredentials()));
    return false;
}

// Joins a namespace base path with a relative path, keeping a single leading slash and no doubles.
function namespacePath(base: string, relative: string): string {
    const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${trimmed}/${relative}`;
}

export async function resolveConfiguredNamespace(apiClient: ApiClient): Promise<string | undefined> {
    if (!(await ApiClient.getKestraApiUrl(false, false))) {
        return undefined;
    }
    const namespace = await pickNamespace(apiClient);
    if (!namespace) {
        return undefined;
    }
    return (await ensureNamespaceReachable(apiClient, namespace)) ? namespace : undefined;
}

export async function uploadFileToNamespace(apiClient: ApiClient, resource?: vscode.Uri): Promise<void> {
    const fileUri = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (!fileUri) {
        vscode.window.showErrorMessage("Open or select a file to upload.");
        return;
    }
    if (fileUri.scheme === 'kestra') {
        vscode.window.showErrorMessage("That file already lives on a Kestra namespace.");
        return;
    }

    let content: Uint8Array;
    try {
        content = await vscode.workspace.fs.readFile(fileUri);
    } catch {
        vscode.window.showErrorMessage(`Cannot read ${fileUri.fsPath}.`);
        return;
    }

    const namespace = await resolveConfiguredNamespace(apiClient);
    if (!namespace) {
        return;
    }

    const name = basename(fileUri.path);
    const target = await vscode.window.showInputBox({
        title: `Upload to ${namespace}`,
        prompt: "Target path in the namespace",
        value: `/${name}`,
        validateInput: value => {
            const trimmed = value.trim();
            if (!trimmed.startsWith('/')) {
                return "Path must start with /";
            }
            if (trimmed.endsWith('/')) {
                return "Path must include a file name";
            }
            return undefined;
        }
    });
    if (!target) {
        return;
    }

    const response = await apiClient.uploadNamespaceFile(namespace, target.trim(), content);
    if (response.ok) {
        vscode.window.showInformationMessage(`Uploaded ${name} to ${namespace}${target.trim()}`);
    }
}

async function collectFiles(root: vscode.Uri): Promise<LocalFile[]> {
    const files: LocalFile[] = [];
    async function walk(dir: vscode.Uri, prefix: string): Promise<void> {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        for (const [entryName, type] of entries) {
            if (IGNORED_NAMES.has(entryName)) {
                continue;
            }
            const child = vscode.Uri.joinPath(dir, entryName);
            const relative = prefix ? `${prefix}/${entryName}` : entryName;
            // FileType is a bitmask, so mask the File bit to include symlinked files. Symlinked
            // directories stay excluded (strict ===) to avoid walking into a cycle.
            if (type === vscode.FileType.Directory) {
                await walk(child, relative);
            } else if ((type & vscode.FileType.File) !== 0) {
                files.push({uri: child, relative});
            }
        }
    }
    await walk(root, "");
    return files;
}

async function pickLocalFolder(): Promise<vscode.Uri | undefined> {
    const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Sync folder"
    });
    return picked?.[0];
}

async function pushFiles(apiClient: ApiClient, namespace: string, basePath: string, files: LocalFile[], progress: vscode.Progress<{message?: string; increment?: number}>, token: vscode.CancellationToken): Promise<SyncOutcome> {
    const outcome: SyncOutcome = {uploaded: 0, failed: [], stoppedByAuth: false, cancelled: false};
    for (const [done, file] of files.entries()) {
        if (token.isCancellationRequested) {
            outcome.cancelled = true;
            break;
        }
        progress.report({message: `${done}/${files.length} ${file.relative}`, increment: 100 / files.length});
        try {
            const content = await vscode.workspace.fs.readFile(file.uri);
            const response = await apiClient.uploadNamespaceFile(namespace, namespacePath(basePath, file.relative), content);
            if (response.ok) {
                outcome.uploaded++;
                continue;
            }
            outcome.failed.push(file.relative);
            // Auth will not recover and each file re-prompts for credentials, so stop after the first.
            if (response.status === 401 || response.status === 403) {
                outcome.stoppedByAuth = true;
                break;
            }
        } catch {
            outcome.failed.push(file.relative);
        }
    }
    return outcome;
}

function reportSyncOutcome(namespace: string, total: number, outcome: SyncOutcome): void {
    if (outcome.stoppedByAuth) {
        vscode.window.showErrorMessage(`Sync stopped: access denied for namespace "${namespace}". Uploaded ${outcome.uploaded} file(s) before stopping.`);
    } else if (outcome.failed.length > 0) {
        const sample = outcome.failed.slice(0, 5).join(', ') + (outcome.failed.length > 5 ? '…' : '');
        vscode.window.showWarningMessage(`Synced ${outcome.uploaded}/${total} to ${namespace}. Failed: ${sample}`);
    } else if (outcome.cancelled) {
        vscode.window.showInformationMessage(`Sync cancelled after ${outcome.uploaded} file(s).`);
    } else {
        vscode.window.showInformationMessage(`Synced ${outcome.uploaded} file(s) to ${namespace}.`);
    }
}

export async function syncFolderToNamespace(apiClient: ApiClient, resource?: vscode.Uri): Promise<void> {
    const folder = resource ?? await pickLocalFolder();
    if (!folder) {
        return;
    }
    if (folder.scheme === 'kestra') {
        vscode.window.showErrorMessage("That folder already lives on a Kestra namespace.");
        return;
    }

    const namespace = await resolveConfiguredNamespace(apiClient);
    if (!namespace) {
        return;
    }

    const basePath = await vscode.window.showInputBox({
        title: `Sync to ${namespace}`,
        prompt: "Target base path in the namespace",
        value: "/",
        validateInput: value => value.startsWith('/') ? undefined : "Path must start with /"
    });
    if (basePath === undefined) {
        return;
    }

    const files = await collectFiles(folder);
    if (files.length === 0) {
        vscode.window.showInformationMessage("No files to sync.");
        return;
    }

    // Additive: uploaded files overwrite matches, remote-only files are left in place.
    const confirmed = await vscode.window.showWarningMessage(
        `Upload ${files.length} file(s) from "${basename(folder.path)}" to namespace "${namespace}"? Existing files at the same path are overwritten.`,
        {modal: true},
        "Upload"
    );
    if (confirmed !== "Upload") {
        return;
    }

    const outcome = await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, title: `Syncing to ${namespace}`, cancellable: true},
        (progress, token) => pushFiles(apiClient, namespace, basePath, files, progress, token)
    );
    reportSyncOutcome(namespace, files.length, outcome);
}
