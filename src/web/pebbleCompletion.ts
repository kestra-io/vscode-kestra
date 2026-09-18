import * as vscode from 'vscode';
import ApiClient from './apiClient';
import YamlUtils from './libs/yamlUtils';
import {PebbleFunctionDef} from './constants';
import {ExpressionContext, membersOf, rootVariables, structureKey, supportsExpressionsEndpoint} from './libs/expressionContext';

// Used on 1.x, and on 2.0+ until the flow first parses (a task with no type yet answers 422).
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

const CONTEXT_TTL_MS = 30_000;
// Holds off re-probing an unreachable instance on every completion.
const VERSION_RETRY_MS = 30_000;

let cachedFilters: string[] | null = null;
let cachedFunctions: Array<string | PebbleFunctionDef> | null = null;
const cachedOutputs = new Map<string, string[]>();
let expressionsSupported: boolean | null = null;
let versionProbedAt = 0;
let versionProbe: Promise<boolean> | null = null;
let cachedContext: {uri: string, structure: string, at: number, context: ExpressionContext} | null = null;

export function resetPebbleCache() {
    cachedFilters = null;
    cachedFunctions = null;
    cachedOutputs.clear();
    expressionsSupported = null;
    versionProbedAt = 0;
    versionProbe = null;
    cachedContext = null;
}

// Probed once, concurrent completions awaiting the in-flight probe instead of falling back.
async function supportsExpressions(apiClient: ApiClient): Promise<boolean> {
    if (expressionsSupported !== null) {
        return expressionsSupported;
    }
    if (versionProbe) {
        return versionProbe;
    }
    if (Date.now() - versionProbedAt < VERSION_RETRY_MS) {
        return false;
    }
    versionProbedAt = Date.now();
    versionProbe = probeVersion(apiClient);
    try {
        return await versionProbe;
    } finally {
        versionProbe = null;
    }
}

async function probeVersion(apiClient: ApiClient): Promise<boolean> {
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

function structureOf(source: string): string {
    return structureKey({
        namespace: YamlUtils.toObject(source)?.namespace,
        taskIds: YamlUtils.taskIds(source),
        taskTypes: YamlUtils.extractAllTypes(source).map(entry => entry.type),
        inputIds: YamlUtils.inputIds(source),
        variables: YamlUtils.sectionKeys(source, 'variables'),
        labels: YamlUtils.sectionKeys(source, 'labels')
    });
}

function isFresh(entry: {structure: string, at: number}, structure: string): boolean {
    return entry.structure === structure && Date.now() - entry.at < CONTEXT_TTL_MS;
}

// Null on 1.x, or before the flow first parses, so the caller falls back to the lists above.
async function contextFor(document: vscode.TextDocument, apiClient: ApiClient, token: vscode.CancellationToken): Promise<ExpressionContext | null> {
    if (!await supportsExpressions(apiClient)) {
        return null;
    }
    const uri = document.uri.toString();
    const source = document.getText();
    const structure = structureOf(source);
    if (cachedContext?.uri === uri && isFresh(cachedContext, structure)) {
        return cachedContext.context;
    }

    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
        const result = await apiClient.flowExpressions(source, controller.signal);
        if (result.status === 'unsupported') {
            // A proxy can 404 a route the instance has, so re-probe later instead of latching.
            expressionsSupported = null;
            versionProbedAt = Date.now();
            return null;
        }
        if (result.status === 'ok') {
            cachedContext = {uri, structure, at: Date.now(), context: result.expressions};
            return result.expressions;
        }
        // Keep the last good context rather than blanking completion mid-edit.
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

                // The /pebble endpoints keep working while the source does not parse.
                if (/\|\s*[\w]*$/.test(expression)) {
                    return (await filtersFor(apiClient)).map(filterItem);
                }

                const context = await contextFor(document, apiClient, token);

                const member = expression.match(/([\w.]+)\.([\w]*)$/);
                if (member) {
                    const fields = await membersForBase(member[1], context, document, apiClient);
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
                    ...rootVariables(context, VARIABLES).map(variableItem),
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

// The endpoint first, then the 1.x resolution for whatever it does not report.
async function membersForBase(base: string, context: ExpressionContext | null, document: vscode.TextDocument, apiClient: ApiClient): Promise<string[] | undefined> {
    const reported = context ? membersOf(context, base, YamlUtils.taskIds(document.getText())) : [];
    return reported.length ? reported : membersForPath(base, document, apiClient);
}

// Fallback: resolve from the document plus the plugin schema, one level deep.
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
