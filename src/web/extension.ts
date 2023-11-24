/* eslint-disable @typescript-eslint/naming-convention */
import fetch, { Response } from 'node-fetch';
import * as vscode from 'vscode';
import { KestraFS } from './kestraFsProvider';
import DocumentationPanel from "./documentation";
import ApiClient from './apiClient';

const kestraBaseUrl = "https://api.kestra.io/v1";

function writeYamlSchemaToKestra(globalState: vscode.Memento, yamlSchema: string) {
	globalState.update("kestra.yaml.schema", yamlSchema);
}

async function getKestraUrl() {
	let kestraConfigUrl = (vscode.workspace.getConfiguration("kestra.api").get("url") as string);
	let kestraUrl = kestraConfigUrl;

	if (vscode.env.uiKind !== vscode.UIKind.Web && !kestraConfigUrl) {
		const kestraInputUrl = await vscode.window.showInputBox({ prompt: "Kestra Webserver URL", value: kestraBaseUrl });

		if (kestraInputUrl === undefined) {
			vscode.window.showErrorMessage("Cannot get informations without proper Kestra URL.");
			return;
		} else {
			kestraUrl = kestraInputUrl;
			// Store user URl
			vscode.workspace.getConfiguration('kestra.api').update('url', kestraUrl, vscode.ConfigurationTarget.Global);
		}
	}
	return kestraUrl.replace("/api/v1", "");
}

function downloadSchemaCommand(globalState: vscode.Memento) {
	return vscode.commands.registerCommand('kestra.schema.download', async () => {
		const kestraUrl = (await getKestraUrl() as string);
		const url = kestraUrl.replace(/\/$/, "") + (kestraUrl === kestraBaseUrl ? "" : "/api/v1") + "/plugins/schemas/flow";
		
		let flowSchema = await ApiClient.fetch(url, null, "Error while downloading Kestra's flow schema:");
		if (flowSchema.status !== 200) {
			return;
		}
		writeYamlSchemaToKestra(globalState, await flowSchema.text());

		vscode.window.showInformationMessage("Flow schema successfully downloaded. You can start using autocompletion.");
	});
}

function showDocumentation(context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('kestra.view.documentation', async () => {
		DocumentationPanel.createOrShow(context.extensionUri,(await getKestraUrl() as string));
	});
}

export async function activate(context: vscode.ExtensionContext) {
	const openedWs = vscode.workspace.workspaceFolders?.[0];
	if(openedWs?.uri?.scheme === "kestra") {
		const kestraFs = new KestraFS(openedWs.name);

		context.subscriptions.push(vscode.workspace.registerFileSystemProvider('kestra', kestraFs));

		await kestraFs.start();
	}
	context.subscriptions.push(downloadSchemaCommand(context.globalState));
	context.subscriptions.push(showDocumentation(context));

	// Auto download schema
	if (vscode.env.uiKind === vscode.UIKind.Web) {
		const schemaUrl = (vscode.workspace.getConfiguration("kestra.api").get("url") as string) + "/plugins/schemas/flow";
		const flowSchemaResponse = await fetch(schemaUrl);
		if (flowSchemaResponse.ok) {
			writeYamlSchemaToKestra(context.globalState, await flowSchemaResponse.text());
			vscode.window.showInformationMessage("!Auto-downloaded flow schema successfully. You can start using autocompletion for your flows.");
		}

		vscode.window.onDidChangeActiveTextEditor(async (editor) => {
			if (editor) {
				vscode.commands.executeCommand("custom.postMessage", {type: "kestra.tabFileChanged", filePath: editor.document.uri});
			}
 		});

		vscode.window.tabGroups.onDidChangeTabs(async (event) => {
			const tabs = {
				dirty: event.changed.filter(tab => tab.isDirty).map(tab =>
					{
						// Required because tab.input is of type unknown so we must narrow it before accessing its properties
						const input = tab.input;
						if (input instanceof vscode.TabInputText) {
							return input.uri.path;
						}
						return tab.label;
					}
				),
				closed: event.closed.concat(event.changed).filter(tab => !tab.isDirty).map(tab =>
					{
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
		});

	}

	const yamlExtension = await vscode.extensions.getExtension('redhat.vscode-yaml')?.activate();
	yamlExtension.registerContributor("kestra", (resource: string) => {
		if(vscode.env.uiKind === vscode.UIKind.Desktop || resource.includes("/_flows/")) {
			return "kestra:/flow-schema.json";
		}

		return undefined;
	}, () => context.globalState.get("kestra.yaml.schema"));
}

export function deactivate() {
}
