export interface FlowInput {
    id: string;
    type?: string;
    required?: boolean;
    description?: string;
    defaults?: unknown;
    prefill?: unknown;
    values?: string[];
    inputs?: FlowInput[];
}

// FORM groups expand to their children keyed by dotted id, the shape the executions API expects.
export function flattenInputs(inputs: FlowInput[] | undefined): FlowInput[] {
    if (!inputs) {
        return [];
    }
    return inputs.flatMap(input =>
        input.type?.toUpperCase() === 'FORM'
            ? (input.inputs ?? []).map(child => ({...child, id: `${input.id}.${child.id}`}))
            : [input]
    );
}

export interface LogEntry {
    timestamp?: string;
    level?: string;
    taskId?: string;
    message?: string;
    taskRunId?: string;
    attemptNumber?: number;
    index?: number;
}

// The follow stream can re-emit a line where its backlog and live tail overlap. Mirrors the core UI's dedup key.
export function logKey(log: LogEntry): string {
    return log.index !== undefined
        ? `${log.taskRunId}-${log.attemptNumber}-${log.index}`
        : `${log.taskRunId}-${log.attemptNumber}-${log.timestamp}-${log.message}`;
}

export function inputFallback(input: FlowInput): unknown {
    return input.prefill ?? input.defaults ?? '';
}

// Kestra inputs are required unless explicitly marked optional.
export function isInputRequired(input: FlowInput): boolean {
    return input.required !== false;
}

export function formatDuration(seconds: number): string {
    if (seconds < 60) {
        return `${seconds.toFixed(2)}s`;
    }
    const units = [{label: 'h', size: 3600}, {label: 'm', size: 60}, {label: 's', size: 1}];
    const parts: string[] = [];
    let rest = Math.round(seconds);
    for (const {label, size} of units) {
        const value = Math.floor(rest / size);
        rest -= value * size;
        if (value > 0) {
            parts.push(`${value}${label}`);
        }
        if (parts.length === 2) {
            break;
        }
    }
    return parts.join(' ');
}

export function formatLogTime(timestamp: string | undefined): string {
    return ((timestamp ?? '').split('T')[1] ?? '').replace('Z', '');
}

// Full date and time for the log panel, matching the core UI's timestamp.
export function formatLogTimestamp(timestamp: string | undefined): string {
    return (timestamp ?? '').replace('T', ' ').replace('Z', '');
}

export function formatLogLine(log: LogEntry): string {
    const time = formatLogTime(log.timestamp).slice(0, 12).padEnd(12);
    const level = `[${(log.level ?? 'INFO').toUpperCase()}]`.padEnd(8);
    const task = log.taskId ? `[${log.taskId}] ` : '';
    return `${time}  ${level}${task}${log.message ?? ''}`;
}

export interface GraphNode {
    uid: string;
    task?: {id?: string; type?: string};
    triggerDeclaration?: {id?: string; type?: string};
}

// The response is unvalidated JSON, so the collections are optional and read defensively.
export interface FlowGraph {
    nodes: GraphNode[];
    edges?: Array<{source: string; target: string}>;
    clusters?: Array<{cluster: {uid: string; taskNode?: GraphNode}; nodes?: string[]}>;
}

export function graphNodeId(node: GraphNode): string {
    return node.task?.id ?? node.triggerDeclaration?.id ?? '';
}

export function graphNodePluginType(node: GraphNode): string | undefined {
    return node.task?.type ?? node.triggerDeclaration?.type;
}
