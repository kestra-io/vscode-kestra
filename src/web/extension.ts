/* eslint-disable @typescript-eslint/naming-convention */
import fetch from 'node-fetch';
import * as vscode from 'vscode';
import { KestraFS } from './kestraFsProvider';

function basicAuthHeader(username: string | undefined, password: string | undefined) {
	return username && password ? {
		Authorization: `Basic ${btoa(username + ':' + password)}`
	} : undefined;
}

function writeYamlSchemaToKestra(globalState: vscode.Memento, yamlSchema: string) {
	globalState.update("kestra.yaml.schema", yamlSchema);
}

async function askCredentialsAndFetch(url: string) {
	const username = await vscode.window.showInputBox({ prompt: "Basic auth username (ESC for none)" });
	let password;
	let flowSchema;
	if (username !== undefined && username !== "") {
		password = await vscode.window.showInputBox({ prompt: "Basic auth password", password: true });
		if (password === undefined || password === "") {
			throw new Error("You should provide a basic auth password if username is provided.");
		}
		flowSchema = await fetch(url, {
			headers: basicAuthHeader(username, password)
		});
	}

	// Still need JWT token
	if (flowSchema === undefined || flowSchema.status === 401) {
		const jwtToken = await vscode.window.showInputBox({ prompt: "JWT Token (copy it when logged in, under logout button)" });
		if (jwtToken === undefined) {
			throw new Error("You should provide a JWT Token or your basic auth credentials were incorrect.");
		}
		flowSchema = await fetch(url, {
			headers: {
				...(basicAuthHeader(username, password) ?? {}),
				cookie: `JWT=${jwtToken}`
			}
		});

		if (flowSchema.status === 401) {
			throw new Error("Wrong credentials, please retry with proper ones.");
		}
	}

	return flowSchema;
}

function downloadSchemaCommand(globalState: vscode.Memento) {
	return vscode.commands.registerCommand('kestra.schema.download', async () => {
		let kestraApi = "https://api.kestra.io";
		if (vscode.env.uiKind === vscode.UIKind.Web) {
			kestraApi = (vscode.workspace.getConfiguration("kestra.api").get("url") as string);
		}
		const kestraUrl = await vscode.window.showInputBox({ prompt: "Kestra Webserver URL", value: kestraApi });
		if (kestraUrl === undefined) {
			vscode.window.showErrorMessage("Cannot download schema without proper Kestra URL.");
			return;
		}

		const url = kestraUrl.replace(/\/$/, "") + (kestraUrl === kestraApi ? "" : "/api/v1") + "/plugins/schemas/flow";
		let flowSchema = await fetch(url);
		if (flowSchema.status === 401) {
			vscode.window.showInformationMessage("This Kestra instance is secured. Please provide credentials.");
			try {
				flowSchema = await askCredentialsAndFetch(url);
			} catch (e) {
				if (e instanceof Error) {
					vscode.window.showErrorMessage(e.message);
				}
			}
		}

		if (flowSchema.status !== 200) {
			vscode.window.showErrorMessage(`Error while loading Kestra's schema: ${flowSchema.statusText}`);
			return;
		}
		writeYamlSchemaToKestra(globalState, await flowSchema.text());

		vscode.window.showInformationMessage("Flow schema successfully downloaded. You can start using autocompletion.");
	});
}

export async function activate(context: vscode.ExtensionContext) {
	const openedWs = vscode.workspace.workspaceFolders?.[0];
	if(openedWs?.uri?.scheme === "kestra") {
		const kestraFs = new KestraFS(openedWs.name);
		kestraFs.createDirectory();
		context.subscriptions.push(vscode.workspace.registerFileSystemProvider('kestra', kestraFs));
	}
	context.subscriptions.push(downloadSchemaCommand(context.globalState));

	// Auto download schema
	if (vscode.env.uiKind === vscode.UIKind.Web) {
		const schemaUrl = (vscode.workspace.getConfiguration("kestra.api").get("url") as string) + "/plugins/schemas/flow";
		const flowSchemaResponse = await fetch(schemaUrl);
		if (flowSchemaResponse.ok) {
			writeYamlSchemaToKestra(context.globalState, await flowSchemaResponse.text());
			vscode.window.showInformationMessage("Auto-downloaded flow schema successfully. You can start using autocompletion for your flows.");
		}
	}

	const yamlExtension = await vscode.extensions.getExtension('redhat.vscode-yaml')?.activate();
	yamlExtension.registerContributor("kestra", (resource: string) => {
		if(vscode.env.uiKind === vscode.UIKind.Desktop || resource.includes("/flows/")) {
			return "kestra:/flow-schema.json";
		}

		return undefined;
	}, () => context.globalState.get("kestra.yaml.schema"));
}

export function deactivate() { }
