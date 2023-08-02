/* eslint-disable @typescript-eslint/naming-convention */
import fetch from 'node-fetch';
import * as vscode from 'vscode';
import { Uri } from 'vscode';

function basicAuthHeader(username: string | undefined, password: string | undefined) {
	return username && password ? {
		Authorization: `Basic ${btoa(username + ':' + password)}`
	} : undefined;
}

function writeJsonSchemaToExtensionPath(extensionPath: string, jsonSchema: string) {
	vscode.workspace.fs.writeFile(Uri.parse(`${extensionPath}/flow-schema.json`), new TextEncoder().encode(jsonSchema));
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

function downloadSchemaCommand(extensionPath: string) {
	return vscode.commands.registerCommand('kestra.schema.download', async () => {
		const kestraApi = "https://api.kestra.io";
		const kestraUrl = await vscode.window.showInputBox({ prompt: "Kestra Webserver URL", value: kestraApi });
		if (kestraUrl === undefined) {
			vscode.window.showErrorMessage("Cannot download schema without proper Kestra URL.");
			return;
		}

		const url = kestraUrl.replace(/\/$/, "") + (kestraUrl === kestraApi ? "" : "/api") + "/v1/plugins/schemas/flow";
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

		writeJsonSchemaToExtensionPath(extensionPath, await flowSchema.text());

		const decision = await vscode.window.showInformationMessage(
			`Successfully downloaded schema. Must reload window for schema to be effective, please save all your changes before`,
			"Reload",
			"Cancel"
		);
		if (decision === "Reload") {
			vscode.commands.executeCommand("workbench.action.reloadWindow");
		}
	});
}

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(downloadSchemaCommand(context.extensionPath));
}

export function deactivate() { }
