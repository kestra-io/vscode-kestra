// Pure helpers for the namespace file commands, free of the vscode API so they can be unit-tested.

export type SyncOutcome = {uploaded: number; failed: string[]; stoppedByAuth: boolean; cancelled: boolean};
export type Reachability = {status?: number; detail?: string};
export type Notice = {kind: 'info' | 'warning' | 'error'; text: string};

// Local metadata and secret files that should never be pushed to a namespace.
const IGNORED_NAMES = new Set(['.git', '.vscode', '.idea', 'node_modules', '.DS_Store', 'credentials.json', '.npmrc', '.netrc']);
const SECRET_SUFFIXES = ['.pem', '.key', '.pfx', '.p12', '.crt'];

export function basename(path: string): string {
    return path.split('/').filter(Boolean).pop() ?? path;
}

// Keeps a single leading slash between the base and the relative path, with no doubles.
export function namespacePath(base: string, relative: string): string {
    const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
    return `${trimmed}/${relative}`;
}

export function isIgnoredName(name: string): boolean {
    if (IGNORED_NAMES.has(name)) {
        return true;
    }
    if (name === '.env' || name.startsWith('.env.')) {
        return true;
    }
    if (name.startsWith('id_rsa') || name.startsWith('id_ed25519')) {
        return true;
    }
    const lower = name.toLowerCase();
    return SECRET_SUFFIXES.some(suffix => lower.endsWith(suffix));
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
