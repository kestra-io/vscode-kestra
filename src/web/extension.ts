import * as vscode from 'vscode';
import {KestraFileSearchProvider, KestraFS} from './kestraFsProvider';
import DocumentationPanel from "./documentation/documentation";
import ApiClient from './apiClient';
import {schemaStateKey, flowSchemaUri} from './constants';
import {registerFlowValidation, isFlowDocument} from './flowValidation';
import {registerPebbleCompletion, resetPebbleCache} from './pebbleCompletion';
import TopologyPanel, {registerTopologyRefresh} from './topologyPanel';
import {registerRequiredFieldsCompletion} from './requiredFieldsCompletion';
import {runFlowFromEditor, saveFlowFromEditor} from './flowRunner';
import {disposeRunLogs} from './runOutput';
import {configureSystemCa} from './systemCa';

async function downloadSchema(globalState: vscode.Memento, apiClient: ApiClient, opts: {silent: boolean, forceInput?: boolean}): Promise<boolean> {
    // The plugin schema endpoint is global, not tenant-scoped.
    const base = await ApiClient.getKestraApiUrl(opts.forceInput ?? false, false);
    if (!base) {
        return false;
    }

    const response = await apiClient.apiCall(`${base}/plugins/schemas/flow`, "Error while downloading Kestra's flow schema:");
    if (!response.ok) {
        return false;
    }

    await globalState.update(schemaStateKey.schema, await response.text());
    await globalState.update(schemaStateKey.source, base);

    if (!opts.silent) {
        vscode.window.showInformationMessage(`Successfully downloaded the Kestra schema from ${base}`);
    }
    return true;
}

function downloadSchemaCommand(globalState: vscode.Memento, apiClient: ApiClient) {
    return vscode.commands.registerCommand('kestra.schema.download', () =>
        downloadSchema(globalState, apiClient, {silent: false, forceInput: true})
    );
}

function runFlowCommand(apiClient: ApiClient, extensionUri: vscode.Uri) {
    return vscode.commands.registerCommand('kestra.flow.run', () => runFlowFromEditor(apiClient, extensionUri));
}

function saveFlowCommand(apiClient: ApiClient) {
    return vscode.commands.registerCommand('kestra.flow.save', () => saveFlowFromEditor(apiClient));
}

function topologyCommand(apiClient: ApiClient, extensionUri: vscode.Uri) {
    return vscode.commands.registerCommand('kestra.flow.topology', () =>
        TopologyPanel.createOrShow(extensionUri, apiClient).update(vscode.window.activeTextEditor?.document)
    );
}

function showDocumentation(context: vscode.ExtensionContext, apiClient: ApiClient) {
    return vscode.commands.registerCommand('kestra.view.documentation', async () => {
        DocumentationPanel.createOrShow(context.extensionUri, apiClient);
    });
}

function signInCommand(apiClient: ApiClient) {
    return vscode.commands.registerCommand('kestra.auth.signIn', () => apiClient.signIn());
}

function signOutCommand(apiClient: ApiClient) {
    return vscode.commands.registerCommand('kestra.auth.signOut', () => apiClient.signOut());
}

export async function activate(context: vscode.ExtensionContext) {
    await configureSystemCa();
    const openedWs = vscode.workspace.workspaceFolders?.[0];
    const apiClient = new ApiClient(context.secrets);
    if (openedWs?.uri?.scheme === "kestra") {
        const namespace = openedWs.name;
        const kestraFs = new KestraFS(namespace, apiClient);

        context.subscriptions.push(vscode.workspace.registerFileSystemProvider('kestra', kestraFs));
        context.subscriptions.push(vscode.workspace.registerFileSearchProvider('kestra', new KestraFileSearchProvider(namespace, kestraFs, apiClient)));

        await kestraFs.start();
    }
    context.subscriptions.push(downloadSchemaCommand(context.globalState, apiClient));
    context.subscriptions.push(showDocumentation(context, apiClient));
    context.subscriptions.push(signInCommand(apiClient));
    context.subscriptions.push(signOutCommand(apiClient));
    context.subscriptions.push(runFlowCommand(apiClient, context.extensionUri));
    context.subscriptions.push(saveFlowCommand(apiClient));
    context.subscriptions.push(topologyCommand(apiClient, context.extensionUri));
    context.subscriptions.push({dispose: disposeRunLogs});
    registerTopologyRefresh(context);

    registerFlowValidation(context, apiClient);
    registerPebbleCompletion(context, apiClient);
    registerRequiredFieldsCompletion(context);

    const configuredUrl = vscode.workspace.getConfiguration("kestra.api").get("url") as string;
    if (vscode.env.uiKind === vscode.UIKind.Web) {
        await downloadSchema(context.globalState, apiClient, {silent: true});
    } else if (configuredUrl) {
        const expectedSource = await ApiClient.getKestraApiUrl(false, false);
        const cachedSource = context.globalState.get(schemaStateKey.source) as string | undefined;
        if (!context.globalState.get(schemaStateKey.schema) || cachedSource !== expectedSource) {
            await downloadSchema(context.globalState, apiClient, {silent: true});
        }
    }

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration("kestra.api.url") || event.affectsConfiguration("kestra.api.tenant")) {
            resetPebbleCache();
            await downloadSchema(context.globalState, apiClient, {silent: true});
        }
    }));

    if (vscode.env.uiKind === vscode.UIKind.Web) {
        context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (editor) {
                vscode.commands.executeCommand("custom.postMessage", {
                    type: "kestra.tabFileChanged",
                    filePath: editor.document.uri
                });
            }
        }));

        context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(async (event) => {
            const tabs = {
                dirty: event.changed.filter(tab => tab.isDirty).map(tab => {
                        // Required because tab.input is of type unknown so we must narrow it before accessing its properties
                        const input = tab.input;
                        if (input instanceof vscode.TabInputText) {
                            return input.uri.path;
                        }
                        return tab.label;
                    }
                ),
                closed: event.closed.concat(event.changed).filter(tab => !tab.isDirty).map(tab => {
                        // Required because tab.input is of type unknown so we must narrow it before accessing its properties
                        const input = tab.input;
                        if (input instanceof vscode.TabInputText) {
                            return input.uri.path;
                        }
                        return tab.label;
                    }
                ),
            };
            vscode.commands.executeCommand("custom.postMessage", {type: "kestra.tabsChanged", tabs: tabs});
        }));

        context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
            if (document.uri.path.includes("/_flows/")) {
                vscode.commands.executeCommand("custom.postMessage", {type: "kestra.flowSaved"});
            }
        }));

    }

    const yamlExtension = await vscode.extensions.getExtension('redhat.vscode-yaml')?.activate();
    yamlExtension.registerContributor("kestra", (resource: string) => {
        let kestraSchemaPathMatch = (vscode.workspace.getConfiguration("kestra.schema").get("match-path") as string);

        if (vscode.env.uiKind === vscode.UIKind.Desktop && kestraSchemaPathMatch && resource.match(kestraSchemaPathMatch)) {
            return flowSchemaUri;
        } else if (resource.includes("/_flows/")) {
            return flowSchemaUri;
        }

        const openDocument = vscode.workspace.textDocuments.find(
            d => d.uri.toString() === resource || d.uri.fsPath === resource || d.uri.path === resource
        );
        if (openDocument && isFlowDocument(openDocument)) {
            return flowSchemaUri;
        }

        return undefined;
    }, () => context.globalState.get(schemaStateKey.schema));
}

export function deactivate() {
}
