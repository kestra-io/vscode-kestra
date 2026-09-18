// Categorized Pebble expressions from POST /flows/expressions (Kestra 2.0+). Keys mirror core's
// ExpressionCategory, values carry no {{ }} delimiters.
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

// "unsupported" means the endpoint is absent (Kestra 1.x), "invalid" that the source was rejected
// or the instance could not be reached.
export type FlowExpressionsResult =
    | {status: "ok"; expressions: ExpressionContext}
    | {status: "invalid"}
    | {status: "unsupported"};

// Categories holding dotted variable paths. The others are ready-to-insert call forms
// (secret('KEY')) or bare filter names, which complete differently.
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

// Root variable names, e.g. outputs, execution, inputs, vars.
export function rootNames(context: ExpressionContext): string[] {
    return unique(paths(context).map(head));
}

// Next segment under `base`, so "outputs.myTask" resolves to that task's output property names.
export function childrenOf(context: ExpressionContext, base: string): string[] {
    const prefix = `${base}.`;
    return unique(paths(context)
        .filter(path => path.startsWith(prefix))
        .map(path => head(path.slice(prefix.length))));
}

// Kestra 1.x has no /flows/expressions: a POST there matches its "update every flow in namespace
// {namespace}" route instead, which would rewrite and prune a namespace called "expressions".
// An unreported or unparseable version is treated as unsupported.
export function supportsExpressionsEndpoint(version: string | null): boolean {
    const major = Number.parseInt(version?.split(".")[0] ?? "", 10);
    return Number.isInteger(major) && major >= 2;
}
