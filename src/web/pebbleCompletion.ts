import * as vscode from 'vscode';
import ApiClient from './apiClient';
import YamlUtils from './libs/yamlUtils';
import {PebbleFunctionDef} from './constants';

// Manual Pebble completion for Kestra 1.x. From 2.0, prefer the version-accurate POST /flows/expressions
// endpoint and fall back to these lists. Follow-up: https://github.com/kestra-io/vscode-kestra/issues/33
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

let cachedFilters: string[] | null = null;
let cachedFunctions: Array<string | PebbleFunctionDef> | null = null;
const cachedOutputs = new Map<string, string[]>();

export function resetPebbleCache() {
    cachedFilters = null;
    cachedFunctions = null;
    cachedOutputs.clear();
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
            async provideCompletionItems(document, position) {
                const before = document.lineAt(position).text.substring(0, position.character);
                const open = before.lastIndexOf('{{');
                if (open === -1 || open < before.lastIndexOf('}}')) {
                    return undefined;
                }
                const expression = before.substring(open + 2);

                if (/\|\s*[\w]*$/.test(expression)) {
                    return (await filtersFor(apiClient)).map(filterItem);
                }

                const member = expression.match(/([\w.]+)\.([\w]*)$/);
                if (member) {
                    const fields = await membersForPath(member[1], document, apiClient);
                    if (!fields) {
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
                return [...VARIABLES.map(variableItem), ...functions];
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

function filterItem(name: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
    item.detail = 'Pebble filter';
    return item;
}

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
