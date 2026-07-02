export interface FlowInput {
    id: string;
    type?: string;
    required?: boolean;
    defaults?: unknown;
    prefill?: unknown;
    values?: string[];
    inputs?: FlowInput[];
}

// Expands each FORM group into its children, keyed by dotted id (`environment.region`), the shape
// the executions API expects. FORMs never nest, so expansion is single-level.
export function flattenInputs(inputs: FlowInput[] | undefined): FlowInput[] {
    if (!inputs) {
        return [];
    }
    return inputs.flatMap(input =>
        input.type?.toUpperCase() === "FORM"
            ? (input.inputs ?? []).map(child => ({...child, id: `${input.id}.${child.id}`}))
            : [input]
    );
}

export interface LogEntry {
    timestamp?: string;
    level?: string;
    taskId?: string;
    message?: string;
}

// The value that pre-populates an input's field.
export function inputFallback(input: FlowInput): unknown {
    return input.prefill ?? input.defaults ?? '';
}

export function formatLogTime(timestamp: string | undefined): string {
    return ((timestamp ?? '').split('T')[1] ?? '').replace('Z', '');
}

// One canonical text rendering of a log line, used by the log channel and the panel's copy output.
export function formatLogLine(log: LogEntry): string {
    const time = formatLogTime(log.timestamp).slice(0, 12).padEnd(12);
    const level = `[${(log.level ?? 'INFO').toUpperCase()}]`.padEnd(8);
    const task = log.taskId ? `[${log.taskId}] ` : '';
    return `${time}  ${level}${task}${log.message ?? ''}`;
}
