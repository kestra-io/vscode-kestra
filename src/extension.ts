import fetch from 'node-fetch';
import * as vscode from 'vscode';
import { Uri } from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	const kestraApi = "https://api.kestra.io";
	const promptOptions = { prompt: "Kestra Webserver URL", value: kestraApi };

	let disposable = vscode.commands.registerCommand('kestra.schema.download', async () => {
		const kestraUrl = await vscode.window.showInputBox(promptOptions);
		if (kestraUrl === undefined) {
			vscode.window.showErrorMessage("Cannot download schema without proper Kestra URL.");
			return;
		}

		const apiEndpoint = kestraUrl === kestraApi ? "" : "/api";
		const flowSchema = await fetch(`${kestraUrl.replace(/\/$/, "")}${apiEndpoint}/v1/plugins/schemas/flow`);

		if (flowSchema.status === 401) {
			vscode.window.showErrorMessage("Cannot load schema from secured Kestra instance.");
			return;
		} else if(flowSchema.status !== 200) {
			vscode.window.showErrorMessage(`Error while loading Kestra's schema: ${flowSchema.statusText}`);
			return;
		}

		vscode.workspace.fs.writeFile(Uri.parse(`${context.extensionPath}/flow-schema.json`), new TextEncoder().encode(await flowSchema.text()));

		const decision = await vscode.window.showInformationMessage(
			`Successfully downloaded schema from ${kestraUrl}. Must reload window for schema to be effective, please save all your changes before`, 
			"Reload",
			"Cancel"
			);
		if (decision === "Reload") {
			vscode.commands.executeCommand("workbench.action.reloadWindow");
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }
