// Pure helpers for the namespace file commands, free of the vscode API so they can be unit-tested.

export type SyncOutcome = {uploaded: number; failed: string[]; stoppedByAuth: boolean; cancelled: boolean};
export type Reachability = {status?: number; detail?: string};
export type Notice = {kind: 'info' | 'warning' | 'error'; text: string};

// Matches a file or folder name against one exclude pattern. A leading and/or trailing "*" is a
// wildcard (`*.pem`, `.env.*`, `id_rsa*`); anything else is an exact name. Patterns are kept simple
// on purpose, the list is user-configurable, so there is nothing to grow in code.
export function matchesPattern(name: string, pattern: string): boolean {
    const n = name.toLowerCase();
    const p = pattern.toLowerCase();
    if (!p.includes('*')) {
        return n === p;
    }
    if (p.startsWith('*') && p.endsWith('*')) {
        return n.includes(p.slice(1, -1));
    }
    if (p.startsWith('*')) {
        return n.endsWith(p.slice(1));
    }
    if (p.endsWith('*')) {
        return n.startsWith(p.slice(0, -1));
    }
    const [prefix, suffix] = p.split('*');
    return n.startsWith(prefix) && n.endsWith(suffix) && n.length >= prefix.length + suffix.length;
}

export function isIgnored(name: string, patterns: string[]): boolean {
    return patterns.some(pattern => matchesPattern(name, pattern));
}

export function basename(path: string): string {
    return path.split('/').filter(Boolean).pop() ?? path;
}

// Keeps a single leading slash between the base and the relative path, with no doubles.
export function namespacePath(base: string, relative: string): string {
    const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${trimmed}/${relative}`;
}

// A 401 does not say whether the credential is invalid or the account simply lacks access, so the
// message splits on whether a credential is stored at all. (Permission denials come back as 403.)
export function reachabilityError(namespace: string, result: Reachability, signedIn: boolean): string {
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

export function uploadNotice(namespace: string, total: number, outcome: SyncOutcome): Notice {
    if (outcome.stoppedByAuth) {
        return {kind: 'error', text: `Upload stopped: access denied for namespace "${namespace}". Uploaded ${outcome.uploaded} file(s) before stopping.`};
    }
    if (outcome.cancelled) {
        const failedNote = outcome.failed.length > 0 ? `, ${outcome.failed.length} failed` : '';
        return {kind: 'info', text: `Upload cancelled after ${outcome.uploaded} uploaded${failedNote}.`};
    }
    if (outcome.failed.length > 0) {
        const sample = outcome.failed.slice(0, 5).join(', ') + (outcome.failed.length > 5 ? '…' : '');
        return {kind: 'warning', text: `Uploaded ${outcome.uploaded}/${total} to ${namespace}. Failed: ${sample}`};
    }
    return {kind: 'info', text: `Uploaded ${outcome.uploaded} file(s) to ${namespace}.`};
}

// Path inside the namespace folder, "" for the folder itself, undefined when the uri is not under
// it at all. Never guess: the result reaches the file API, where an empty path means the root.
export function namespaceRelativePath(namespace: string, path: string): string | undefined {
    const prefix = `/${namespace}`;
    if (path === prefix) {
        return "";
    }
    return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : undefined;
}

// Matches whole segments. `includes` also matched .gitignore, and any name containing ".git".
export function hasExcludedSegment(path: string, excluded: string[]): boolean {
    return path.split("/").some(segment => excluded.includes(segment));
}
