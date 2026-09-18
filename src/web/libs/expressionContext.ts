// POST /flows/expressions response (Kestra 2.0+). Values carry no {{ }} delimiters.
export interface ExpressionContext {
    taskOutputs?: string[];
    executionContext?: string[];
    inputs?: string[];
    variables?: string[];
    secrets?: string[];
    kvPairs?: string[];
    namespaceFiles?: string[];
    filters?: string[];
    functions?: string[];
}

// "unsupported": the instance predates the endpoint. "invalid": source rejected, or unreachable.
export type FlowExpressionsResult =
    | {status: "ok"; expressions: ExpressionContext}
    | {status: "invalid"}
    | {status: "unsupported"};

// The dotted-path categories. The rest are call forms or filter names, completed differently.
const PATH_CATEGORIES: Array<keyof ExpressionContext> = ["taskOutputs", "executionContext", "inputs", "variables"];

function paths(context: ExpressionContext): string[] {
    return PATH_CATEGORIES.flatMap(category => context[category] ?? []);
}

// Leading segment of a path, stopping at a dot or a bracket so outputs['my-task'].uri yields "outputs".
function head(path: string): string {
    return path.split(/[.[]/)[0];
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(value => value.length > 0))];
}

export function rootNames(context: ExpressionContext): string[] {
    return unique(paths(context).map(head));
}

export function childrenOf(context: ExpressionContext, base: string): string[] {
    const prefix = `${base}.`;
    return unique(paths(context)
        .filter(path => path.startsWith(prefix))
        .map(path => head(path.slice(prefix.length))));
}

// Only what the endpoint derives expressions from, so typing inside a string reuses the cached
// context while adding an input or renaming a task refetches immediately.
export function structureKey(parts: {
    namespace?: unknown, taskIds: string[], taskTypes: string[],
    inputIds: string[], variables: string[], labels: string[]
}): string {
    return JSON.stringify([parts.namespace, parts.taskIds, parts.taskTypes,
        parts.inputIds, parts.variables, parts.labels]);
}

// Endpoint roots first, then any fallback variable it does not report, so nothing the 1.x path
// offered disappears on 2.0.
export function rootVariables(context: ExpressionContext, fallback: string[]): string[] {
    return unique([...rootNames(context), ...fallback]);
}

// The endpoint only reports tasks that declare outputs, so task ids are merged back in: a task
// with dynamic outputs still completes after `outputs.`.
export function membersOf(context: ExpressionContext, base: string, taskIds: string[]): string[] {
    const fields = childrenOf(context, base);
    return base === "outputs" ? unique([...fields, ...taskIds]) : fields;
}

// 1.x has no such route, so the POST matches its "replace every flow in {namespace}" route and
// prunes a namespace called "expressions". An unknown version counts as unsupported.
export function supportsExpressionsEndpoint(version: string | null): boolean {
    const major = Number.parseInt(version?.split(".")[0] ?? "", 10);
    return Number.isInteger(major) && major >= 2;
}
