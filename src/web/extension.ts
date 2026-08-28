import * as vscode from 'vscode';
import {KestraFileSearchProvider, KestraFS} from './kestraFsProvider';
import DocumentationPanel from "./documentation/documentation";
import ApiClient from './apiClient';
import {schemaStateKey, flowSchemaUri, kestraScheme, knownInstancesKey} from './constants';
import {registerFlowValidation, isFlowDocument} from './flowValidation';
import {registerPebbleCompletion, resetPebbleCache} from './pebbleCompletion';
import TopologyPanel, {registerTopologyRefresh} from './topologyPanel';
import {registerRequiredFieldsCompletion} from './requiredFieldsCompletion';
import {runFlowFromEditor, saveFlowFromEditor} from './flowRunner';
import {disposeRunLogs} from './runOutput';
import {resolveConfiguredNamespace, uploadFileToNamespace, syncFolderToNamespace} from './namespaceFiles';
import {initLog, logInfo} from './log';
import {decodeInstanceAuthority, encodeInstanceAuthority} from './instanceUri';

// user:password@ in a url.
const urlUserinfo = /\/\/[^/@]*@/;

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url.replace(urlUserinfo, "//");
    }
}

async function rememberInstance(globalState: vscode.Memento, url: string): Promise<void> {
    const known = globalState.get<string[]>(knownInstancesKey) ?? [];
    if (!known.includes(url)) {
        await globalState.update(knownInstancesKey, [...known, url]);
    }
}

// A folder URI can come from anywhere, and decides which host gets our requests and credentials.
async function confirmInstance(globalState: vscode.Memento, url: string): Promise<boolean> {
    if ((globalState.get<string[]>(knownInstancesKey) ?? []).includes(url)) {
        return true;
    }
    const connect = await vscode.window.showWarningMessage(
        `This folder points at ${hostOf(url)}, which you have not opened a namespace on before.`,
        {modal: true, detail: "Connect only if you trust this Kestra instance. It receives the files you open and any credentials you enter."},
        "Connect"
    );
    return connect === "Connect";
}

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

function openNamespaceCommand(globalState: vscode.Memento, apiClient: ApiClient) {
    return vscode.commands.registerCommand('kestra.namespace.open', async () => {
        const namespace = await resolveConfiguredNamespace(apiClient, true);
        if (!namespace) {
            return;
        }
        const instance = ApiClient.currentInstance();
        // Opening from settings is what makes an instance known.
        await rememberInstance(globalState, instance.url);
        const folder = vscode.Uri.from({
            scheme: kestraScheme,
            authority: encodeInstanceAuthority(instance),
            path: `/${namespace}`
        });
        await vscode.commands.executeCommand('vscode.openFolder', folder, {forceNewWindow: true});
    });
}

function uploadFileCommand(apiClient: ApiClient) {
    return vscode.commands.registerCommand('kestra.namespace.uploadFile', (resource?: vscode.Uri, selected?: vscode.Uri[]) => uploadFileToNamespace(apiClient, resource, selected));
}

function syncFolderCommand(apiClient: ApiClient) {
    return vscode.commands.registerCommand('kestra.namespace.syncFolder', (resource?: vscode.Uri, selected?: vscode.Uri[]) => syncFolderToNamespace(apiClient, resource, selected));
}

function signOutCommand(apiClient: ApiClient) {
    return vscode.commands.registerCommand('kestra.auth.signOut', () => apiClient.signOut());
}

export async function activate(context: vscode.ExtensionContext) {
    initLog(context);
    const openedWs = vscode.workspace.workspaceFolders?.[0];
    const apiClient = new ApiClient(context.secrets);
    if (openedWs?.uri?.scheme === kestraScheme) {
        const root = openedWs.uri;
        const instance = decodeInstanceAuthority(root.authority);
        if (instance && await confirmInstance(context.globalState, instance.url)) {
            ApiClient.pinInstance(instance);
            // Output channels end up pasted into bug reports.
            logInfo(`Namespace window pinned to ${instance.url.replace(urlUserinfo, "//")}${instance.tenant ? ` (tenant ${instance.tenant})` : ""}`);
        } else if (root.authority) {
            // A legacy kestra:///namespace folder has no authority and never reaches this.
            vscode.window.showWarningMessage(`This namespace is not connected to the instance it was opened from, so it uses kestra.api.url instead. Reopen it with "Kestra: Open namespace" to be sure of the instance.`);
        }
        const namespace = root.path.split("/").filter(Boolean).join("/") || openedWs.name;
        const kestraFs = new KestraFS(namespace, apiClient, root.authority);

        context.subscriptions.push(vscode.workspace.registerFileSystemProvider(kestraScheme, kestraFs));
        context.subscriptions.push(vscode.workspace.registerFileSearchProvider(kestraScheme, new KestraFileSearchProvider(kestraFs)));

        await kestraFs.start().catch(() => undefined);
    }
    context.subscriptions.push(downloadSchemaCommand(context.globalState, apiClient));
    context.subscriptions.push(showDocumentation(context, apiClient));
    context.subscriptions.push(signInCommand(apiClient));
    context.subscriptions.push(signOutCommand(apiClient));
    context.subscriptions.push(openNamespaceCommand(context.globalState, apiClient));
    context.subscriptions.push(uploadFileCommand(apiClient));
    context.subscriptions.push(syncFolderCommand(apiClient));
    context.subscriptions.push(runFlowCommand(apiClient, context.extensionUri));
    context.subscriptions.push(saveFlowCommand(apiClient));
    context.subscriptions.push(topologyCommand(apiClient, context.extensionUri));
    context.subscriptions.push({dispose: disposeRunLogs});
    registerTopologyRefresh(context);

    registerFlowValidation(context, apiClient);
    registerPebbleCompletion(context, apiClient);
    registerRequiredFieldsCompletion(context);

    const configuredUrl = ApiClient.currentInstance().url;
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
        if (ApiClient.isPinned()) {
            return;
        }
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
