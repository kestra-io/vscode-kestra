import * as vscode from 'vscode';
import ApiClient from './apiClient';
import YamlUtils from './libs/yamlUtils';
import {PebbleFunctionDef} from './constants';
import {ExpressionContext, childrenOf, rootNames, supportsExpressionsEndpoint} from './libs/expressionContext';

// Fallback lists. Used on Kestra 1.x, and on 2.0+ whenever the flow has not parsed yet: a task
// added but not yet given a type makes /flows/expressions answer 422, which is a normal state while
// typing. So these outlive 1.x support, they are what a flow being written top-down completes from.
const VARIABLES = ['outputs', 'inputs', 'vars', 'flow', 'execution', 'trigger', 'task', 'taskrun',
    'labels', 'envs', 'globals', 'parent', 'parents', 'error', 'kestra'];

const NESTED_FIELDS: Record<string, string[]> = {
    flow: ['id', 'namespace', 'revision', 'tenantId'],
    execution: ['id', 'startDate', 'state', 'originalId', 'outputs'],
    task: ['id', 'type'],
    taskrun: ['id', 'startDate', 'attemptsCount', 'parentId', 'value', 'iteration'],
    error: ['taskId', 'message', 'stackTrace'],
    kestra: ['environment', 'url']
};

// The expression context is flow-scoped, so it is refetched when the source changes. The minimum
// interval keeps typing inside an expression from posting the whole flow on every trigger character.
const CONTEXT_TTL_MS = 30_000;
const CONTEXT_MIN_INTERVAL_MS = 2_000;
// How long an unanswered version probe holds before being retried, so completion on an unreachable
// instance does not wait out a fresh request timeout every time.
const VERSION_RETRY_MS = 30_000;

let cachedFilters: string[] | null = null;
let cachedFunctions: Array<string | PebbleFunctionDef> | null = null;
const cachedOutputs = new Map<string, string[]>();
let expressionsSupported: boolean | null = null;
let versionProbedAt = 0;
let cachedContext: {uri: string, source: string, at: number, context: ExpressionContext} | null = null;

export function resetPebbleCache() {
    cachedFilters = null;
    cachedFunctions = null;
    cachedOutputs.clear();
    expressionsSupported = null;
    versionProbedAt = 0;
    cachedContext = null;
}

// The endpoint is only ever called once the instance reports a version that has it, so a 1.x
// instance is never posted to. An unreachable instance is retried rather than latched.
async function supportsExpressions(apiClient: ApiClient): Promise<boolean> {
    if (expressionsSupported !== null) {
        return expressionsSupported;
    }
    if (Date.now() - versionProbedAt < VERSION_RETRY_MS) {
        return false;
    }
    versionProbedAt = Date.now();
    const version = await apiClient.instanceVersion();
    if (version === null) {
        return false;
    }
    expressionsSupported = supportsExpressionsEndpoint(version);
    return expressionsSupported;
}

async function filtersFor(apiClient: ApiClient): Promise<string[]> {
    if (cachedFilters === null) {
        cachedFilters = await apiClient.pebbleFilters();
    }
    return cachedFilters ?? [];
}

async function functionsFor(apiClient: ApiClient): Promise<Array<string | PebbleFunctionDef>> {
    if (cachedFunctions === null) {
        cachedFunctions = await apiClient.pebbleFunctions();
    }
    return cachedFunctions ?? [];
}

function isFresh(entry: {source: string, at: number}, source: string): boolean {
    const age = Date.now() - entry.at;
    return age < CONTEXT_MIN_INTERVAL_MS || (entry.source === source && age < CONTEXT_TTL_MS);
}

// What the instance reports as available for this flow. Null on Kestra 1.x, or before the flow has
// ever parsed, so the caller falls back to the manual lists.
async function contextFor(document: vscode.TextDocument, apiClient: ApiClient, token: vscode.CancellationToken): Promise<ExpressionContext | null> {
    if (!await supportsExpressions(apiClient)) {
        return null;
    }
    const uri = document.uri.toString();
    const source = document.getText();
    if (cachedContext?.uri === uri && isFresh(cachedContext, source)) {
        return cachedContext.context;
    }

    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
        const result = await apiClient.flowExpressions(source, controller.signal);
        if (result.status === 'unsupported') {
            expressionsSupported = false;
            return null;
        }
        if (result.status === 'ok') {
            cachedContext = {uri, source, at: Date.now(), context: result.expressions};
            return result.expressions;
        }
        // The flow does not parse yet, or the call failed: keep the last good context for this
        // document rather than blanking completion mid-edit.
        return cachedContext?.uri === uri ? cachedContext.context : null;
    } finally {
        cancellation.dispose();
    }
}

function functionToSnippet(fn: PebbleFunctionDef): string {
    const args = fn.arguments.filter(arg => arg.defaultValue !== null);
    if (args.length === 0) {
        return `${fn.name}()`;
    }
    const params = args.map((arg, index) => `${arg.name}=\${${index + 1}:${arg.defaultValue}}`).join(", ");
    return `${fn.name}(${params})`;
}

export function registerPebbleCompletion(context: vscode.ExtensionContext, apiClient: ApiClient) {
    const provider = vscode.languages.registerCompletionItemProvider(
        {language: 'yaml'},
        {
            async provideCompletionItems(document, position, token) {
                const before = document.lineAt(position).text.substring(0, position.character);
                const open = before.lastIndexOf('{{');
                if (open === -1 || open < before.lastIndexOf('}}')) {
                    return undefined;
                }
                const expression = before.substring(open + 2);

                // Filters and functions come from the always-available /pebble endpoints, so they
                // keep working while the flow source is mid-edit and does not parse.
                if (/\|\s*[\w]*$/.test(expression)) {
                    return (await filtersFor(apiClient)).map(filterItem);
                }

                const context = await contextFor(document, apiClient, token);

                const member = expression.match(/([\w.]+)\.([\w]*)$/);
                if (member) {
                    const fields = context
                        ? childrenOf(context, member[1])
                        : await membersForPath(member[1], document, apiClient);
                    if (!fields?.length) {
                        return undefined;
                    }
                    // Replace only the text after the dot so VS Code filters against it, not "base.xyz".
                    const suffix = member[2];
                    const replace = new vscode.Range(position.translate(0, -suffix.length), position);
                    return fields.map(name => {
                        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field);
                        item.range = replace;
                        return item;
                    });
                }

                const functions = (await functionsFor(apiClient)).map(functionItem);
                if (!context) {
                    return [...VARIABLES.map(variableItem), ...functions];
                }
                return [
                    ...rootNames(context).map(variableItem),
                    ...(context.secrets ?? []).map(call => callItem(call, 'Kestra secret')),
                    ...(context.kvPairs ?? []).map(call => callItem(call, 'KV pair')),
                    ...(context.namespaceFiles ?? []).map(call => callItem(call, 'Namespace file')),
                    ...functions
                ];
            }
        },
        '{', '.', '|'
    );
    context.subscriptions.push(provider);
}

function variableItem(name: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
    item.detail = 'Kestra variable';
    return item;
}

function functionItem(fn: string | PebbleFunctionDef): vscode.CompletionItem {
    const name = typeof fn === 'string' ? fn : fn.name;
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
    item.insertText = new vscode.SnippetString(typeof fn === 'string' ? `${name}(\${1})` : functionToSnippet(fn));
    item.detail = 'Kestra function';
    return item;
}

// Secrets, KV pairs and namespace files arrive as complete calls, e.g. secret('MY_KEY').
function callItem(expression: string, detail: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(expression, vscode.CompletionItemKind.Value);
    item.detail = detail;
    return item;
}

function filterItem(name: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
    item.detail = 'Pebble filter';
    return item;
}

// Kestra 1.x fallback: resolve a path from the document plus the plugin schema, one level deep.
async function membersForPath(path: string, document: vscode.TextDocument, apiClient: ApiClient): Promise<string[] | undefined> {
    const segments = path.split('.');
    // outputs.<taskId>. resolves to that task's output properties, from its type (as the Kestra UI does).
    if (segments.length === 2 && segments[0] === 'outputs') {
        return outputsFor(segments[1], document, apiClient);
    }
    if (segments.length === 1) {
        return membersFor(segments[0], document);
    }
    return undefined;
}

function membersFor(base: string, document: vscode.TextDocument): string[] | undefined {
    const source = document.getText();
    switch (base) {
        case 'inputs': return YamlUtils.inputIds(source);
        case 'outputs': return YamlUtils.taskIds(source);
        case 'labels': return YamlUtils.sectionKeys(source, 'labels');
        case 'vars': return YamlUtils.sectionKeys(source, 'variables');
        default: return NESTED_FIELDS[base];
    }
}

async function outputsFor(taskId: string, document: vscode.TextDocument, apiClient: ApiClient): Promise<string[] | undefined> {
    const type = YamlUtils.taskType(document.getText(), taskId);
    if (!type) {
        return undefined;
    }
    const cached = cachedOutputs.get(type);
    if (cached) {
        return cached;
    }
    // null means the fetch failed or the type is unknown, so don't cache it (allow a later retry).
    const outputs = await apiClient.taskOutputProperties(type);
    if (outputs === null) {
        return undefined;
    }
    cachedOutputs.set(type, outputs);
    return outputs;
}
