export interface FlowInput {
    id: string;
    type?: string;
    required?: boolean;
    defaults?: unknown;
    prefill?: unknown;
    values?: string[];
}

export interface LogEntry {
    timestamp?: string;
    level?: string;
    taskId?: string;
    message?: string;
}
