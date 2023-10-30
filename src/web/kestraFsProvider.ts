/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as vscode from 'vscode';

type KestraFileAttributes = {
	fileName: string;
	lastModifiedTime: number;
	creationTime: number;
	type: keyof typeof vscode.FileType;
	size: number;
};

const fileStatFromKestraFileAttrs = ({ fileName, type, creationTime, lastModifiedTime, size }: KestraFileAttributes): vscode.FileStat => {
	const finalStats = {
		type: vscode.FileType[type],
		ctime: creationTime,
		mtime: lastModifiedTime,
		size
	};

	return finalStats;
};

const EXCLUDED_FOLDERS = [".git", ".vscode"];
const DEFAULT_DIRECTORY_SIZE = 4096;
const AUTHENTICATION_EXPIRED_ERROR = "Permission issue while calling Kestra's API. Please reload the page to reauthenticate (your changes are kept locally by VSCode cache).";

export class KestraFS implements vscode.FileSystemProvider {
	namespace: string;
	apiUrl: string;

	constructor(namespace: string) {
		this.namespace = namespace;
		this.apiUrl = vscode.workspace.getConfiguration("kestra.api").get("url") as string;
	}

	private async callFileApi(suffix?: string, options?: RequestInit): Promise<Response> {
		const fetchResponse = await fetch(`${this.apiUrl}/files/namespaces/${this.namespace}${suffix ?? ""}`, options);
		if (fetchResponse.status === 404) {
			throw vscode.FileSystemError.FileNotFound(suffix);
		}
		if (fetchResponse.status === 401) {
			throw vscode.FileSystemError.NoPermissions(AUTHENTICATION_EXPIRED_ERROR);
		}
		return fetchResponse;
	}

	private async callFlowsApi(suffix?: string, options?: RequestInit): Promise<Response> {
		const fetchResponse = await fetch(`${this.apiUrl}/flows${suffix ?? ""}`, options);
		if (fetchResponse.status === 404) {
			throw vscode.FileSystemError.FileNotFound(suffix);
		}
		if (fetchResponse.status === 401) {
			throw vscode.FileSystemError.NoPermissions(AUTHENTICATION_EXPIRED_ERROR);
		}
		return fetchResponse;
	}

	private isExcludedFolder(uri: vscode.Uri) {
		return EXCLUDED_FOLDERS.some(f => uri.path.includes(f));
	}

	private trimNamespace(path: string) {
		return path.substring(this.namespace.length + 1);
	}

	private isFlow(uri: vscode.Uri) {
		return uri.path.startsWith(`/${this.namespace}/_flows/`);
	}

	private isFlowsDirectory(uri: vscode.Uri) {
		return uri.path === `/${this.namespace}/_flows`;
	}

	private impactsFlowsDirectory(uri?: vscode.Uri) {
		if (!uri) {
			return false;
		}

		return this.isFlowsDirectory(uri) || this.isFlow(uri);
	}

	private extractFlowId(uri: vscode.Uri): string {
		const extensionIdx = uri.path.lastIndexOf(".");
		return uri.path.substring(uri.path.lastIndexOf("/") + 1, extensionIdx === -1 ? uri.path.length : extensionIdx);
	}

	private async getFlowSource(uri: vscode.Uri): Promise<string> {
		const flowId = this.extractFlowId(uri);
		return (await (await this.callFlowsApi(`/${this.namespace}/${flowId}?source=true`)).json()).source;
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		if (this.isExcludedFolder(uri)) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		if (this.isFlowsDirectory(uri)) {
			return {
				type: vscode.FileType.Directory,
				ctime: 0,
				mtime: 0,
				size: DEFAULT_DIRECTORY_SIZE
			};
		}

		if (this.isFlow(uri)) {			
			return {
				type: vscode.FileType.File,
				ctime: 0,
				mtime: 0,
				size: (await this.getFlowSource(uri)).length
			};
		}
		
		const response = await this.callFileApi(`/stats?path=${this.trimNamespace(uri.path)}`);

		return fileStatFromKestraFileAttrs(await response.json() as KestraFileAttributes);
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		if (this.isFlowsDirectory(uri)) {
			const flowsResponse = await (await this.callFlowsApi(`/${this.namespace}`)).json();
			return (flowsResponse as Array<{ id: string }>)
				.map(r => [`${r.id}.yml`, vscode.FileType.File]);
		}

		const response = await this.callFileApi("/directory" + (uri ? `?path=${this.trimNamespace(uri.path)}` : ""));

		let directoryEntries: [string, vscode.FileType][] = (await response.json() as Array<KestraFileAttributes>)
			.map(attr => [attr.fileName, vscode.FileType[attr.type]]);
		
		if(uri.path === `/${this.namespace}`) {
			directoryEntries = [...directoryEntries, ["_flows", vscode.FileType.Directory]];
		}

		return directoryEntries;
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		if (this.isExcludedFolder(uri)) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		if (this.isFlow(uri)) {
			return new TextEncoder().encode(await this.getFlowSource(uri));
		}

		const response = await this.callFileApi("?path=" + this.trimNamespace(uri.path));

		return new Uint8Array(await response.arrayBuffer());
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		if(this.isFlow(uri)) {
			try {
				await this.getFlowSource(uri);
			} catch(e) {
				if(e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
					const response = (await this.callFlowsApi(``, {
						method: "POST",
						body: this.getDefaultFlow(this.extractFlowId(uri)),
						headers: {
							"Content-Type": "application/x-yaml"
						}
					}));
					if(!response.ok) {
						// Should never happen
						throw vscode.FileSystemError.NoPermissions("Invalid flow creation: " + (await response.json())?.message);
					}
					return;
				}
				throw e;
			}
			
			const response = (await this.callFlowsApi(`/${this.namespace}/${this.extractFlowId(uri)}`, {
				method: "PUT",
				body: new TextDecoder().decode(content),
				headers: {
					"Content-Type": "application/x-yaml"
				}
			}));
			if(!response.ok) {
				throw vscode.FileSystemError.NoPermissions("Invalid flow update: " + (await response.json())?.message);
			}

			return;
		}

		const formData = new FormData();
		formData.append('fileContent', new Blob([content]));
		
		await this.callFileApi("?path=" + this.trimNamespace(uri.path), {
			method: "POST",
			body: formData
		});
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		if(this.impactsFlowsDirectory(oldUri) || this.impactsFlowsDirectory(newUri)) {
			throw vscode.FileSystemError.NoPermissions("Cannot rename flows or parent directory as their metadata are read-only");
		}
		await this.callFileApi(`?from=${this.trimNamespace(oldUri.path)}&to=${this.trimNamespace(newUri.path)}`, { method: "PUT" });
	}

	async delete(uri: vscode.Uri): Promise<void> {
		if(this.impactsFlowsDirectory(uri)) {
			await this.callFlowsApi(`/${this.namespace}/${this.extractFlowId(uri)}`, {
				method: "DELETE"
			});
		}

		await this.callFileApi(`?path=${this.trimNamespace(uri.path)}`, { method: "DELETE" });
	}

	async createDirectory(uri?: vscode.Uri): Promise<void> {
		if(this.impactsFlowsDirectory(uri)) {
			throw vscode.FileSystemError.NoPermissions("'flows' is a reserved directory name");
		}

		await this.callFileApi("/directory" + (uri ? `?path=${this.trimNamespace(uri.path)}` : ""), { method: "POST" });
	}

	private getDefaultFlow(flowId: string): string  {
		return `id: ${flowId}
namespace: ${this.namespace}
tasks:
  - id: hello
    type: io.kestra.core.tasks.log.Log
    message: Kestra team wishes you a great day! 👋`;
	}

	// --- manage file events

	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	watch(_resource: vscode.Uri): vscode.Disposable {
		// ignore, fires for all changes...
		return new vscode.Disposable(() => { });
	}
}