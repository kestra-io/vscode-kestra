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
import { kestraScheme } from "./constants";
import { namespaceRelativePath, hasExcludedSegment, isNamespaceRoot, encodePathSegments } from "./namespaceFilesHelpers";
import { logWarn } from "./log";

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
	private readonly authority: string;

	constructor(namespace: string, apiClient: ApiClient, authority: string = "") {
		this.namespace = namespace;
		this.apiClient = apiClient;
		this.authority = authority;
	}

	// Keeps the folder's authority, which pins the window to its instance.
	public uriFor(relativePath: string): vscode.Uri {
		return vscode.Uri.from({scheme: kestraScheme, authority: this.authority, path: `/${this.namespace}${relativePath}`});
	}



	private isExcludedFolder(uri: vscode.Uri) {
		return hasExcludedSegment(uri.path, EXCLUDED_FOLDERS);
	}

	// Encoded value for ?path=. Throws rather than guessing at a path outside the namespace.
	private filePath(uri: vscode.Uri): string {
		const relative = namespaceRelativePath(this.namespace, uri.path);
		if (relative === undefined) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		return encodePathSegments(relative);
	}

	// The root addresses every file, so only reads may name it.
	private writablePath(uri: vscode.Uri): string {
		const path = this.filePath(uri);
		if (isNamespaceRoot(path)) {
			throw vscode.FileSystemError.NoPermissions("Refusing to change the namespace root");
		}
		return path;
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
		const id = uri.path.substring(uri.path.lastIndexOf("/") + 1, extensionIdx === -1 ? uri.path.length : extensionIdx);
		if (!id) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		return id;
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
		
		// Hidden, not deleted: reading a file is not consent to remove it from the instance.
		if (this.isExcludedFolder(uri)) {
			logWarn(`Hiding ${uri.path}, ${EXCLUDED_FOLDERS.join(" and ")} cannot be used inside a namespace`);
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		const response = await this.apiClient.fileApi(this.namespace, `/stats?path=${this.filePath(uri)}`);
		return fileStatFromKestraFileAttrs(await response.json() as KestraFileAttributes);
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		this.checkExcludedFolderOrThrow(uri);

		if (this.isFlowsDirectory(uri)) {
			const flowsResponse = await (await this.apiClient.flowsApi(`/${this.namespace}`)).json();
			return (flowsResponse as Array<{ id: string }>)
				.map(r => [`${r.id}.yml`, vscode.FileType.File]);
		}

		const response = await this.apiClient.fileApi(this.namespace, `/directory?path=${this.filePath(uri)}`);

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

		const response = await this.apiClient.fileApi(this.namespace, `?path=${this.filePath(uri)}`);

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
		
		await this.apiClient.fileApi(this.namespace, `?path=${this.writablePath(uri)}`, {
			method: "POST",
			body: formData
		});
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		this.checkExcludedFolderOrThrow(newUri);

		if(this.impactsFlowsDirectory(oldUri) || this.impactsFlowsDirectory(newUri)) {
			throw vscode.FileSystemError.NoPermissions("Cannot rename flows or parent directory as their metadata are read-only");
		}
		await this.apiClient.fileApi(this.namespace, `?from=${this.writablePath(oldUri)}&to=${this.writablePath(newUri)}`, { method: "PUT" });
	}

	delete(uri: vscode.Uri) {
		this.checkExcludedFolderOrThrow(uri);

		return this.callDeleteApi(uri);
	}

	private async callDeleteApi(uri: vscode.Uri){
		if(this.isFlowsDirectory(uri)) {
			throw vscode.FileSystemError.NoPermissions(`'${this.FLOWS_DIRECTORY}' is a reserved directory name`);
		}

		if(this.isFlow(uri)) {
			await this.apiClient.flowsApi(`/${this.namespace}/${this.extractFlowId(uri)}`, {
				method: "DELETE"
			});
			return;
		}

		await this.apiClient.fileApi(this.namespace, `?path=${this.writablePath(uri)}`, { method: "DELETE" });
	}

	async createDirectory(uri?: vscode.Uri): Promise<void> {
		this.checkExcludedFolderOrThrow(uri);

		if(this.impactsFlowsDirectory(uri)) {
			throw vscode.FileSystemError.NoPermissions("'flows' is a reserved directory name");
		}

		await this.apiClient.fileApi(this.namespace, "/directory" + (uri ? `?path=${this.writablePath(uri)}` : ""), { method: "POST" });
	}

	// Open a landing doc if the namespace ships one, but never fail activation when none exists.
	async start() {
		for (const doc of ["README.md", "getting-started.md"]) {
			const uri = this.uriFor(`/${doc}`);
			try {
				await this.stat(uri);
			} catch {
				continue;
			}
			await vscode.commands.executeCommand("vscode.open", uri);
			return;
		}
	}

	private checkExcludedFolderOrThrow(uri?: vscode.Uri) {
		if (!uri) {
			return;
		}

		if (this.isExcludedFolder(uri)) {
			const matched = uri.path.split("/").find(segment => EXCLUDED_FOLDERS.includes(segment));
			throw vscode.FileSystemError.NoPermissions(
				`Using ${uri.path} is forbidden because it cannot include ${matched} in its path`
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
	fileSystemProvider: KestraFS;

	constructor(fileSystemProvider: KestraFS) {
		this.fileSystemProvider = fileSystemProvider;
	}

	private async searchFiles(pattern: string): Promise<Uri[]> {
		const fs = this.fileSystemProvider;
		const response = await fs.apiClient.fileApi(fs.namespace, `/search?q=${encodeURIComponent(pattern)}`);
		if (!response.ok) {
			throw new Error(await response.text());
		}
		return (await response.json() as Array<string>).map(path => fs.uriFor(path));
	}

	private async searchFlows(): Promise<Uri[]> {
		const flowsDirectory = `/${this.fileSystemProvider.FLOWS_DIRECTORY}`;
		const flows = await this.fileSystemProvider.readDirectory(this.fileSystemProvider.uriFor(flowsDirectory));
		return flows.map(([fileName]) => this.fileSystemProvider.uriFor(`${flowsDirectory}/${fileName}`));
	}

	// Half the results beat none, so one side failing does not discard the other.
	async provideFileSearchResults(query: FileSearchQuery, options: FileSearchOptions, token: CancellationToken): Promise<Uri[]> {
		const results = await Promise.allSettled([this.searchFiles(query.pattern), this.searchFlows()]);
		for (const result of results) {
			if (result.status === "rejected") {
				logWarn(`Namespace search partly failed: ${result.reason}`);
			}
		}
		return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
	}
}
