// A kestra:// folder is virtual, so it carries no .vscode/settings.json. Without the instance
// encoded on the folder URI, a namespace window falls back to User settings and loses a
// kestra.api.url that was set per workspace.

export type KestraInstance = {url: string; tenant: string};

// Splits the two hex runs, so it must be a character hex never produces and a URI authority allows.
const fieldSeparator = "-";
const hexPattern = /^[0-9a-f]*$/i;

// URI authorities are not guaranteed to keep their case, so the payload is hex, which survives it.
function toHex(text: string): string {
    return Array.from(new TextEncoder().encode(text), byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): string | undefined {
    if (hex.length % 2 !== 0 || !hexPattern.test(hex)) {
        return undefined;
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    try {
        // Decoding strictly rejects hex that is not something this extension wrote, rather than
        // turning it into replacement characters and pinning the window to a garbage instance.
        return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch {
        return undefined;
    }
}

// The url and the tenant are separate hex runs, so neither has to avoid a separator character. The
// url is kept exactly as configured, not normalized, so credentials scoped per url still match.
export function encodeInstanceAuthority(instance: KestraInstance): string {
    return `${toHex(instance.url)}${fieldSeparator}${toHex(instance.tenant)}`;
}

// Undefined for anything this extension did not write, so older kestra:///namespace folders and the
// ones the Kestra UI opens in the browser keep reading the instance from settings.
export function decodeInstanceAuthority(authority: string): KestraInstance | undefined {
    const parts = authority.split(fieldSeparator);
    if (parts.length !== 2) {
        return undefined;
    }
    const url = fromHex(parts[0]);
    const tenant = fromHex(parts[1]);
    return url && tenant !== undefined ? {url, tenant} : undefined;
}
