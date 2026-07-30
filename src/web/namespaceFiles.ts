import * as vscode from 'vscode';
import ApiClient from './apiClient';

// Local metadata folders that should never be pushed to a namespace.
const IGNORED_NAMES = new Set(['.git', '.vscode', 'node_modules', '.DS_Store', '.idea']);

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

// Kestra answers 401 for a bad/expired token, a missing tenant membership, and a lacking namespace
// permission alike, so the only reliable split is whether we hold a credential at all: none means
// "never signed in", one present means authenticated-but-denied.
function reachabilityError(namespace: string, result: {status?: number; detail?: string}, signedIn: boolean): string {
    switch (result.status) {
        case 401:
            return signedIn
                ? `Cannot use namespace "${namespace}": access denied. Your account may not have permission for this namespace, or your token may have expired.`
                : `Cannot use namespace "${namespace}": not signed in. Run "Kestra: Sign in" and try again.`;
        case 403:
            return `Cannot use namespace "${namespace}": you do not have permission to access its files.`;
        case 404:
            return `Namespace "${namespace}" was not found. Check the instance URL and tenant.`;
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

async function collectFiles(root: vscode.Uri): Promise<Array<{uri: vscode.Uri; relative: string}>> {
    const files: Array<{uri: vscode.Uri; relative: string}> = [];
    async function walk(dir: vscode.Uri, prefix: string): Promise<void> {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        for (const [entryName, type] of entries) {
            if (IGNORED_NAMES.has(entryName)) {
                continue;
            }
            const child = vscode.Uri.joinPath(dir, entryName);
            const relative = prefix ? `${prefix}/${entryName}` : entryName;
            // FileType is a bitmask (a symlink adds SymbolicLink), so mask it. Symlinked files are
            // uploaded, symlinked directories are skipped to avoid following cycles into an infinite walk.
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

export async function syncFolderToNamespace(apiClient: ApiClient, resource?: vscode.Uri): Promise<void> {
    let folder = resource;
    if (!folder) {
        const picked = await vscode.window.showOpenDialog({canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Sync folder"});
        folder = picked?.[0];
    }
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

    // Additive sync: local files are uploaded and overwrite matching remote files, remote-only files are left in place.
    const confirm = await vscode.window.showWarningMessage(
        `Upload ${files.length} file(s) from "${basename(folder.path)}" to namespace "${namespace}"? Existing files at the same path are overwritten.`,
        {modal: true},
        "Upload"
    );
    if (confirm !== "Upload") {
        return;
    }

    await vscode.window.withProgress({location: vscode.ProgressLocation.Notification, title: `Syncing to ${namespace}`, cancellable: true}, async (progress, token) => {
        const failures: string[] = [];
        let uploaded = 0;
        let processed = 0;
        let accessDenied = false;
        for (const file of files) {
            if (token.isCancellationRequested) {
                break;
            }
            progress.report({message: `${processed}/${files.length} ${file.relative}`, increment: 100 / files.length});
            try {
                const content = await vscode.workspace.fs.readFile(file.uri);
                const response = await apiClient.uploadNamespaceFile(namespace, namespacePath(basePath, file.relative), content);
                if (response.ok) {
                    uploaded++;
                } else {
                    failures.push(file.relative);
                    // Auth failures will not recover for the remaining files, and each one prompts
                    // for credentials, so stop after the first rather than repeating the prompt.
                    if (response.status === 401 || response.status === 403) {
                        accessDenied = true;
                        break;
                    }
                }
            } catch {
                failures.push(file.relative);
            }
            processed++;
        }

        if (accessDenied) {
            vscode.window.showErrorMessage(`Sync stopped: access denied for namespace "${namespace}". Uploaded ${uploaded} file(s) before stopping.`);
        } else if (failures.length > 0) {
            vscode.window.showWarningMessage(`Synced ${uploaded}/${files.length} to ${namespace}. Failed: ${failures.slice(0, 5).join(', ')}${failures.length > 5 ? '…' : ''}`);
        } else if (token.isCancellationRequested) {
            vscode.window.showInformationMessage(`Sync cancelled after ${uploaded} file(s).`);
        } else {
            vscode.window.showInformationMessage(`Synced ${uploaded} file(s) to ${namespace}.`);
        }
    });
}
