// A kestra:// folder is virtual, so it carries no .vscode/settings.json. Without the instance
// encoded on the folder URI, a namespace window falls back to User settings and loses a
// kestra.api.url that was set per workspace.

export type KestraInstance = {url: string; tenant: string};

// URI authorities are not guaranteed to keep their case, so the payload is hex, which survives it.
function toHex(text: string): string {
    return Array.from(new TextEncoder().encode(text), byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): string | undefined {
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
        return undefined;
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return new TextDecoder().decode(bytes);
}

// The url is kept exactly as configured, not normalized, so credentials scoped per url still match.
export function encodeInstanceAuthority(instance: KestraInstance): string {
    return toHex(`${instance.url}|${instance.tenant}`);
}

// Undefined for anything this extension did not write, so older kestra:///namespace folders and the
// ones the Kestra UI opens in the browser keep reading the instance from settings.
export function decodeInstanceAuthority(authority: string): KestraInstance | undefined {
    const decoded = authority ? fromHex(authority) : undefined;
    if (decoded === undefined) {
        return undefined;
    }
    const separator = decoded.indexOf("|");
    if (separator === -1) {
        return undefined;
    }
    const url = decoded.slice(0, separator);
    return url ? {url, tenant: decoded.slice(separator + 1)} : undefined;
}
