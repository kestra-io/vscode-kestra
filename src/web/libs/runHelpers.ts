export function durationOf(state?: {histories?: Array<{date?: string}>}): number | undefined {
    const histories = state?.histories;
    if (!histories || histories.length === 0) {
        return undefined;
    }
    const start = Date.parse(histories[0].date ?? "");
    const end = Date.parse(histories[histories.length - 1].date ?? "");
    if (isNaN(start) || isNaN(end)) {
        return undefined;
    }
    return Math.max(0, (end - start) / 1000);
}

const UNSAFE_FILE_NAME_CHARS = /[^a-zA-Z0-9._-]/g;

export function sanitizeFileName(name: string): string {
    return name.replace(UNSAFE_FILE_NAME_CHARS, "_");
}
