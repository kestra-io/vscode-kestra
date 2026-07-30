import * as vscode from 'vscode';
import ApiClient from './apiClient';
import {SyncOutcome, basename, namespacePath, isIgnoredName, reachabilityError, uploadNotice} from './namespaceFilesHelpers';

type LocalFile = {uri: vscode.Uri; relative: string};

function showNotice(kind: 'info' | 'warning' | 'error', text: string): void {
    const show = kind === 'error' ? vscode.window.showErrorMessage
        : kind === 'warning' ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;
    show(text);
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

// Resolves the namespace to work with. requireExisting is true for "open" (a typo would otherwise
// open a blank window); false for upload/sync, where a new namespace is offered for creation.
export async function resolveConfiguredNamespace(apiClient: ApiClient, requireExisting: boolean): Promise<string | undefined> {
    if (!(await ApiClient.getKestraApiUrl(false, false))) {
        return undefined;
    }
    const namespace = await pickNamespace(apiClient);
    if (!namespace) {
        return undefined;
    }
    const result = await apiClient.namespaceFilesReachable(namespace);
    if (result.ok) {
        return namespace;
    }
    if (!requireExisting && result.status === 404) {
        const create = await vscode.window.showWarningMessage(`Namespace "${namespace}" does not exist yet. Create it?`, {modal: true}, "Create");
        return create === "Create" ? namespace : undefined;
    }
    showNotice('error', reachabilityError(namespace, result, await apiClient.hasStoredCredentials()));
    return undefined;
}

function validatePath(value: string, requireFileName: boolean): string | undefined {
    const trimmed = value.trim();
    if (!trimmed.startsWith('/')) {
        return "Path must start with /";
    }
    if (requireFileName && trimmed.endsWith('/')) {
        return "Path must include a file name";
    }
    if (trimmed.split('/').includes('..')) {
        return "Path cannot contain ..";
    }
    return undefined;
}

// Prefers an open document's (possibly unsaved) text, so an upload sends what the user sees rather
// than stale disk bytes. Binary files are never open as text documents, so they fall back to disk.
async function readLocalFile(uri: vscode.Uri): Promise<Uint8Array> {
    const open = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
    return open ? new TextEncoder().encode(open.getText()) : vscode.workspace.fs.readFile(uri);
}

async function collectFiles(root: vscode.Uri): Promise<LocalFile[]> {
    const files: LocalFile[] = [];
    async function walk(dir: vscode.Uri, prefix: string): Promise<void> {
        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(dir);
        } catch {
            return; // skip unreadable directories rather than aborting the whole sync
        }
        for (const [entryName, type] of entries) {
            if (isIgnoredName(entryName)) {
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

// Expands a selection of files and folders into a flat, namespace-relative file list.
async function gatherFiles(uris: vscode.Uri[]): Promise<LocalFile[]> {
    const files: LocalFile[] = [];
    for (const uri of uris) {
        let stat: vscode.FileStat;
        try {
            stat = await vscode.workspace.fs.stat(uri);
        } catch {
            continue;
        }
        if ((stat.type & vscode.FileType.Directory) !== 0) {
            const dir = basename(uri.path);
            const nested = await collectFiles(uri);
            files.push(...nested.map(file => ({uri: file.uri, relative: `${dir}/${file.relative}`})));
        } else if ((stat.type & vscode.FileType.File) !== 0) {
            files.push({uri, relative: basename(uri.path)});
        }
    }
    return files;
}

async function pushFiles(apiClient: ApiClient, namespace: string, basePath: string, files: LocalFile[], progress: vscode.Progress<{message?: string; increment?: number}>, token: vscode.CancellationToken): Promise<SyncOutcome> {
    const outcome: SyncOutcome = {uploaded: 0, failed: [], stoppedByAuth: false, cancelled: false};
    const controller = new AbortController();
    const cancelSub = token.onCancellationRequested(() => controller.abort());
    try {
        for (const [done, file] of files.entries()) {
            if (token.isCancellationRequested) {
                outcome.cancelled = true;
                break;
            }
            progress.report({message: `${done + 1}/${files.length} ${file.relative}`, increment: 100 / files.length});
            try {
                const content = await readLocalFile(file.uri);
                const response = await apiClient.uploadNamespaceFile(namespace, namespacePath(basePath, file.relative), content, controller.signal);
                if (response?.ok) {
                    outcome.uploaded++;
                    continue;
                }
                outcome.failed.push(file.relative);
                // Auth will not recover for the remaining files, so stop after the first denial.
                if (response && (response.status === 401 || response.status === 403)) {
                    outcome.stoppedByAuth = true;
                    break;
                }
            } catch {
                if (token.isCancellationRequested) {
                    outcome.cancelled = true;
                    break;
                }
                outcome.failed.push(file.relative);
            }
        }
    } finally {
        cancelSub.dispose();
    }
    return outcome;
}

// Prompts for a base path, confirms, uploads with a cancellable progress bar, and reports the outcome.
async function uploadBatch(apiClient: ApiClient, namespace: string, files: LocalFile[], source: string): Promise<void> {
    const basePath = await vscode.window.showInputBox({
        title: `Upload to ${namespace}`,
        prompt: "Target base path in the namespace",
        value: "/",
        validateInput: value => validatePath(value, false)
    });
    if (basePath === undefined) {
        return;
    }

    // Additive: uploaded files overwrite matches, remote-only files are left in place.
    const confirmed = await vscode.window.showWarningMessage(
        `Upload ${files.length} file(s) from ${source} to namespace "${namespace}"? Existing files at the same path are overwritten.`,
        {modal: true},
        "Upload"
    );
    if (confirmed !== "Upload") {
        return;
    }

    const outcome = await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, title: `Uploading to ${namespace}`, cancellable: true},
        (progress, token) => pushFiles(apiClient, namespace, basePath, files, progress, token)
    );
    const notice = uploadNotice(namespace, files.length, outcome);
    showNotice(notice.kind, notice.text);
}

function resolveUris(resource: vscode.Uri | undefined, selected: vscode.Uri[] | undefined, fallback?: vscode.Uri): vscode.Uri[] {
    if (selected && selected.length > 0) {
        return selected;
    }
    const single = resource ?? fallback;
    return single ? [single] : [];
}

async function uploadSingleFile(apiClient: ApiClient, fileUri: vscode.Uri): Promise<void> {
    const namespace = await resolveConfiguredNamespace(apiClient, false);
    if (!namespace) {
        return;
    }

    const target = await vscode.window.showInputBox({
        title: `Upload to ${namespace}`,
        prompt: "Target path in the namespace",
        value: `/${basename(fileUri.path)}`,
        validateInput: value => validatePath(value, true)
    });
    if (!target) {
        return;
    }
    const targetPath = target.trim();

    let content: Uint8Array;
    try {
        content = await readLocalFile(fileUri);
    } catch {
        showNotice('error', `Cannot read ${fileUri.fsPath}.`);
        return;
    }

    const response = await apiClient.uploadNamespaceFile(namespace, targetPath, content);
    if (!response?.ok) {
        showNotice('error', `Failed to upload to ${namespace}${targetPath}${response ? ` (HTTP ${response.status})` : ''}.`);
        return;
    }
    showNotice('info', `Uploaded to ${namespace}${targetPath}`);
}

export async function uploadFileToNamespace(apiClient: ApiClient, resource?: vscode.Uri, selected?: vscode.Uri[]): Promise<void> {
    const uris = resolveUris(resource, selected, vscode.window.activeTextEditor?.document.uri);
    if (uris.length === 0) {
        showNotice('error', "Open or select a file to upload.");
        return;
    }
    if (uris.some(uri => uri.scheme === 'kestra')) {
        showNotice('error', "That file already lives on a Kestra namespace.");
        return;
    }

    // A single file keeps the choose-the-exact-path flow; a multi-selection uploads under a base path.
    if (uris.length === 1) {
        await uploadSingleFile(apiClient, uris[0]);
        return;
    }

    const namespace = await resolveConfiguredNamespace(apiClient, false);
    if (!namespace) {
        return;
    }
    const files = await gatherFiles(uris);
    if (files.length === 0) {
        showNotice('info', "No files to upload.");
        return;
    }
    await uploadBatch(apiClient, namespace, files, `${uris.length} selected item(s)`);
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

export async function syncFolderToNamespace(apiClient: ApiClient, resource?: vscode.Uri, selected?: vscode.Uri[]): Promise<void> {
    const uris = resolveUris(resource, selected, await pickLocalFolder());
    if (uris.length === 0) {
        return;
    }
    if (uris.some(uri => uri.scheme === 'kestra')) {
        showNotice('error', "That folder already lives on a Kestra namespace.");
        return;
    }

    const namespace = await resolveConfiguredNamespace(apiClient, false);
    if (!namespace) {
        return;
    }
    const files = await gatherFiles(uris);
    if (files.length === 0) {
        showNotice('info', "No files to sync.");
        return;
    }
    const source = uris.length === 1 ? `"${basename(uris[0].path)}"` : `${uris.length} folders`;
    await uploadBatch(apiClient, namespace, files, source);
}
