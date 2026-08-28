// A kestra:// folder carries no settings of its own, so the instance rides on the folder URI.

export type KestraInstance = {url: string; tenant: string};

// Must be a character hex never produces and a URI authority allows.
const fieldSeparator = "-";
const hexPattern = /^[0-9a-f]*$/i;

// Hex because URI authorities are not guaranteed to keep their case.
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
        // Strict, so foreign hex is rejected instead of decoding to replacement characters.
        return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    } catch {
        return undefined;
    }
}

// Separate hex runs, so neither field has to avoid the separator.
export function encodeInstanceAuthority(instance: KestraInstance): string {
    // An empty url would encode to an authority that decodes back as corrupt.
    return instance.url ? `${toHex(instance.url)}${fieldSeparator}${toHex(instance.tenant)}` : "";
}

// Undefined for anything this extension did not write, so legacy folders fall back to settings.
export function decodeInstanceAuthority(authority: string): KestraInstance | undefined {
    const parts = authority.split(fieldSeparator);
    if (parts.length !== 2) {
        return undefined;
    }
    const url = fromHex(parts[0]);
    const tenant = fromHex(parts[1]);
    return url && tenant !== undefined ? {url, tenant} : undefined;
}
