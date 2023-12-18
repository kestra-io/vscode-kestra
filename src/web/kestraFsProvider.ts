/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as vscode from 'vscode';
import {
	CancellationToken,
	FilePermission,
	FileSearchOptions,
	FileSearchProvider,
	FileSearchQuery,
	ProviderResult,
	Uri
} from 'vscode';
import ApiClient from "./apiClient";

type KestraFileAttributes = {
	fileName: string;
	lastModifiedTime: number;
	creationTime: number;
	type: keyof typeof vscode.FileType;
	size: number;
	readOnly: boolean;
};

const fileStatFromKestraFileAttrs = ({ type, creationTime, lastModifiedTime, size, readOnly }: KestraFileAttributes): vscode.FileStat => {
	return {
		type: vscode.FileType[type],
		ctime: creationTime,
		mtime: lastModifiedTime,
		size,
		permissions: readOnly ? FilePermission.Readonly : undefined
	};
};

const EXCLUDED_FOLDERS = [".git", ".vscode"];
const DEFAULT_DIRECTORY_SIZE = 4096;

export class KestraFS implements vscode.FileSystemProvider {
	public readonly FLOWS_DIRECTORY = `_flows`;

	namespace: string;
	apiClient: ApiClient;

	constructor(namespace: string, apiClient: ApiClient) {
		this.namespace = namespace;
		this.apiClient = apiClient;
	}



	private isExcludedFolder(uri: vscode.Uri) {
		return EXCLUDED_FOLDERS.some(f => uri.path.includes(f));
	}

	private trimNamespace(path: string) {
		return path.substring(this.namespace.length + 1);
	}

	private isFlow(uri: vscode.Uri) {
		return uri.path.startsWith(`/${this.namespace}/${this.FLOWS_DIRECTORY}/`);
	}

	private isFlowsDirectory(uri: vscode.Uri) {
		return uri.path === `/${this.namespace}/${this.FLOWS_DIRECTORY}`;
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
		return ((await (await this.apiClient.flowsApi(`/${this.namespace}/${flowId}?source=true`)).json()) as {source: string}).source;
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
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
		
		const response = await this.apiClient.fileApi(this.namespace, `/stats?path=${this.trimNamespace(uri.path)}`);

		try {
			this.checkExcludedFolderOrThrow(uri);
		} catch (e) {
			// If the file is in an excluded folder, we delete it to purge bad files from storage
			await this.callDeleteApi(uri);
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		return fileStatFromKestraFileAttrs(await response.json() as KestraFileAttributes);
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		this.checkExcludedFolderOrThrow(uri);

		if (this.isFlowsDirectory(uri)) {
			const flowsResponse = await (await this.apiClient.flowsApi(`/${this.namespace}`)).json();
			return (flowsResponse as Array<{ id: string }>)
				.map(r => [`${r.id}.yml`, vscode.FileType.File]);
		}

		const response = await this.apiClient.fileApi(this.namespace, "/directory" + (uri ? `?path=${this.trimNamespace(uri.path)}` : ""));

		let directoryEntries: [string, vscode.FileType][] = (await response.json() as Array<KestraFileAttributes>)
			.map(attr => [attr.fileName, vscode.FileType[attr.type]]);
		
		if(uri.path === `/${this.namespace}`) {
			directoryEntries = [...directoryEntries, [this.FLOWS_DIRECTORY, vscode.FileType.Directory]];
		}

		return directoryEntries;
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		this.checkExcludedFolderOrThrow(uri);

		if (this.isFlow(uri)) {
			return new TextEncoder().encode(await this.getFlowSource(uri));
		}

		const response = await this.apiClient.fileApi(this.namespace, "?path=" + this.trimNamespace(uri.path));

		return new Uint8Array(await response.arrayBuffer());
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		this.checkExcludedFolderOrThrow(uri);

		if(this.isFlow(uri)) {
			try {
				await this.getFlowSource(uri);
			} catch(e) {
				if(e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
					const response = (await this.apiClient.flowsApi(``, {
						method: "POST",
						body: this.getDefaultFlow(this.extractFlowId(uri)),
						headers: {
							"Content-Type": "application/x-yaml"
						}
					}));
					if(!response.ok) {
						// Should never happen
						throw vscode.FileSystemError.NoPermissions("Invalid flow creation: " + ((await response.json()) as {message?: string})?.message);
					}
					return;
				}
				throw e;
			}
			
			const response = (await this.apiClient.flowsApi(`/${this.namespace}/${this.extractFlowId(uri)}`, {
				method: "PUT",
				body: new TextDecoder().decode(content),
				headers: {
					"Content-Type": "application/x-yaml"
				}
			}));
			if(!response.ok) {
				throw vscode.FileSystemError.NoPermissions("Invalid flow update: " + ((await response.json()) as {message?: string})?.message);
			}

			return;
		}

		const formData = new FormData();

		formData.append('fileContent', new Blob([content]));
		
		await this.apiClient.fileApi(this.namespace, "?path=" + this.trimNamespace(uri.path), {
			method: "POST",
			body: formData
		});
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		this.checkExcludedFolderOrThrow(newUri);

		if(this.impactsFlowsDirectory(oldUri) || this.impactsFlowsDirectory(newUri)) {
			throw vscode.FileSystemError.NoPermissions("Cannot rename flows or parent directory as their metadata are read-only");
		}
		await this.apiClient.fileApi(this.namespace, `?from=${this.trimNamespace(oldUri.path)}&to=${this.trimNamespace(newUri.path)}`, { method: "PUT" });
	}

	delete(uri: vscode.Uri) {
		this.checkExcludedFolderOrThrow(uri);

		return this.callDeleteApi(uri);
	}

	private async callDeleteApi(uri: vscode.Uri){
		if(this.impactsFlowsDirectory(uri)) {
			await this.apiClient.flowsApi(`/${this.namespace}/${this.extractFlowId(uri)}`, {
				method: "DELETE"
			});
		}

		await this.apiClient.fileApi(this.namespace, `?path=${this.trimNamespace(uri.path)}`, { method: "DELETE" });
	}

	async createDirectory(uri?: vscode.Uri): Promise<void> {
		this.checkExcludedFolderOrThrow(uri);

		if(this.impactsFlowsDirectory(uri)) {
			throw vscode.FileSystemError.NoPermissions("'flows' is a reserved directory name");
		}

		await this.apiClient.fileApi(this.namespace, "/directory" + (uri ? `?path=${this.trimNamespace(uri.path)}` : ""), { method: "POST" });
	}

	async start() {
		try {
			await this.stat(vscode.Uri.parse(`kestra:///${this.namespace}/README.md`));
			await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(`kestra:///${this.namespace}/README.md`));
		} catch (e) {
			if(e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
				await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(`kestra:///${this.namespace}/getting-started.md`));
			}
		}
	}

	private checkExcludedFolderOrThrow(uri?: vscode.Uri) {
		if (!uri) {
			return;
		}

		if (this.isExcludedFolder(uri)) {
			throw vscode.FileSystemError.NoPermissions(
				`Using ${uri.path} is forbidden because it cannot include ${EXCLUDED_FOLDERS.filter(f => uri.path.includes(f))[0]} in its path`
			);
		}
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

export class KestraFileSearchProvider implements FileSearchProvider {
	namespace: string;
	fileSystemProvider: KestraFS;
	apiClient: ApiClient;

	constructor(namespace: string, fileSystemProvider: KestraFS, apiClient: ApiClient) {
		this.namespace = namespace;
		this.fileSystemProvider = fileSystemProvider;
		this.apiClient = apiClient;
	}

	provideFileSearchResults(query: FileSearchQuery, options: FileSearchOptions, token: CancellationToken): ProviderResult<Uri[]> {
		return Promise.all([
			new Promise(async (resolve, reject) => {
				const response = await this.apiClient.fileApi(this.namespace, `/search?q=${query.pattern}`);
				if (!response.ok) {
					reject(response.text());
				}

				resolve((await response.json() as Array<string>).map(path => vscode.Uri.parse("kestra:///" + this.namespace + path)));
			}) as Promise<Uri[]>,
			this.fileSystemProvider.readDirectory(vscode.Uri.parse("kestra:///" + this.namespace + "/" + this.fileSystemProvider.FLOWS_DIRECTORY))
				.then(flows => flows
					.map(([fileName]) => vscode.Uri.parse(`kestra:///${this.namespace}/${this.fileSystemProvider.FLOWS_DIRECTORY}/${fileName}`))
				)
		]).then(([files, flows]) => {
			return [...files, ...flows];
		});
	}
}