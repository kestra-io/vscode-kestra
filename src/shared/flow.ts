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
