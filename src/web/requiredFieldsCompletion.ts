import * as vscode from 'vscode';
import {schemaStateKey} from './constants';

type TaskDefinition = {required?: string[]};

let cachedSource: string | undefined;
let cachedDefinitions: Record<string, TaskDefinition> | undefined;

function definitionsFor(globalState: vscode.Memento): Record<string, TaskDefinition> | undefined {
    const raw = globalState.get(schemaStateKey.schema) as string | undefined;
    if (!raw) {
        return undefined;
    }
    if (raw !== cachedSource) {
        try {
            cachedDefinitions = (JSON.parse(raw) as {definitions?: Record<string, TaskDefinition>}).definitions;
        } catch {
            cachedDefinitions = undefined;
        }
        cachedSource = raw;
    }
    return cachedDefinitions;
}

function indentOf(text: string): number {
    return text.match(/^\s*/)?.[0].length ?? 0;
}

function unquote(value: string): string {
    return value.trim().replace(/^["']|["']$/g, "").trim();
}

// Resolves the task around the cursor (its `type` and existing keys) by indentation, not the YAML AST, since
// the document is mid-edit and may not parse.
function taskContext(document: vscode.TextDocument, position: vscode.Position): {type: string; keys: Set<string>; indent: number} | undefined {
    const prefix = document.lineAt(position.line).text.substring(0, position.character);
    if (!/^\s*$/.test(prefix)) {
        return undefined;
    }
    const indent = prefix.length;
    if (indent === 0) {
        return undefined;
    }

    const keys = new Set<string>();
    let type: string | undefined;

    const collect = (key: string, rawValue: string) => {
        keys.add(key);
        if (key === "type" && unquote(rawValue)) {
            type = unquote(rawValue);
        }
    };

    for (let line = position.line - 1; line >= 0; line--) {
        const text = document.lineAt(line).text;
        if (/^\s*$/.test(text)) {
            continue;
        }
        const dash = text.match(/^(\s*)-(\s+)([\w-]+):(.*)$/);
        if (dash && dash[1].length + 1 + dash[2].length === indent) {
            collect(dash[3], dash[4]);
            break;
        }
        const lineIndent = indentOf(text);
        if (lineIndent < indent) {
            break;
        }
        if (lineIndent === indent) {
            const property = text.match(/^\s*([\w-]+):(.*)$/);
            if (property) {
                collect(property[1], property[2]);
            }
        }
    }

    for (let line = position.line + 1; line < document.lineCount; line++) {
        const text = document.lineAt(line).text;
        if (/^\s*$/.test(text)) {
            continue;
        }
        const lineIndent = indentOf(text);
        if (lineIndent < indent) {
            break;
        }
        if (lineIndent === indent) {
            const property = text.match(/^\s*([\w-]+):(.*)$/);
            if (property) {
                collect(property[1], property[2]);
            }
        }
    }

    return type ? {type, keys, indent} : undefined;
}

export function registerRequiredFieldsCompletion(context: vscode.ExtensionContext) {
    const provider: vscode.InlineCompletionItemProvider = {
        provideInlineCompletionItems(document, position) {
            if (document.languageId !== "yaml") {
                return;
            }
            const definitions = definitionsFor(context.globalState);
            if (!definitions) {
                return;
            }

            const task = taskContext(document, position);
            if (!task) {
                return;
            }
            const required = definitions[task.type]?.required;
            if (!required?.length) {
                return;
            }

            const missing = required.filter(key => !task.keys.has(key));
            if (!missing.length) {
                return;
            }

            const indent = " ".repeat(task.indent);
            const text = missing.map((key, index) => `${index === 0 ? "" : indent}${key}: `).join("\n");
            return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
        }
    };

    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({language: "yaml"}, provider));
}
