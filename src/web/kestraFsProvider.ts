/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as path from 'path';
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

export class KestraFS implements vscode.FileSystemProvider {
	namespace: string;
	url: string;

	constructor(namespace: string) {
		this.namespace = namespace;
		this.url = vscode.workspace.getConfiguration("kestra.api").get("url") as string;
	}

	private async callFileApi(suffix?: string, options?: RequestInit): Promise<Response> {
		const fetchResponse = await fetch(`${this.url}/api/v1/files/${this.namespace}${suffix ?? ""}`, options);
		if(fetchResponse.status === 404) {
			throw vscode.FileSystemError.FileNotFound(suffix);
		}
		return fetchResponse;
	}

	private async callFlowsApi(suffix?: string, options?: RequestInit): Promise<Response> {
		const fetchResponse = await fetch(`${this.url}/api/v1/flows${suffix ?? ""}`, options);
		if(fetchResponse.status === 404) {
			throw vscode.FileSystemError.FileNotFound(suffix);
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
		return uri.path.startsWith(`/${this.namespace}/flows/`);
	}

	private isFlowsDirectory(uri: vscode.Uri) {
		return uri.path === `/${this.namespace}/flows`;
	}

	private impactsFlowsDirectory(uri?: vscode.Uri) {
		if(!uri) {
			return false;
		}

		return this.isFlowsDirectory(uri) || this.isFlow(uri);
	}

	private extractFlowId(uri: vscode.Uri): string {
		return uri.path.substring(uri.path.lastIndexOf("/") + 1);
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
			const defaultDirectorySize = 4096;
			return {
				type: vscode.FileType.Directory,
				ctime: 0,
				mtime: 0,
				size: defaultDirectorySize
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
		if(this.isFlowsDirectory(uri)) {
			const flowsResponse = (await (await this.callFlowsApi(`/search?namespace=${this.namespace}&size=-1`)).json());
			return (flowsResponse.results as Array<{ id: string }>)
				.map(r => [r.id, vscode.FileType.File]);
		}

		const response = await this.callFileApi("/directory" + (uri ? `?path=${this.trimNamespace(uri.path)}` : ""));

		let directoryEntries: [string, vscode.FileType][] = (await response.json() as Array<KestraFileAttributes>)
			.map(attr => [attr.fileName, vscode.FileType[attr.type]]);
		
		if(uri.path === `/${this.namespace}`) {
			directoryEntries = [...directoryEntries, ["flows", vscode.FileType.Directory]];
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
		if(options.create && uri.path.startsWith(`/${this.namespace}/flows`)) {
			throw vscode.FileSystemError.NoPermissions("Cannot create files in 'flows' directory as it's a reserved directory for flows");
		}

		if(this.isFlow(uri)) {
			await this.callFlowsApi(`/${this.namespace}/${this.extractFlowId(uri)}`, {
				method: "PUT",
				body: new TextDecoder().decode(content)
			});
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
			throw vscode.FileSystemError.NoPermissions("Cannot create files in 'flows' directory as it's a reserved directory for flows");
		}

		await this.callFileApi(`?path=${this.trimNamespace(uri.path)}`, { method: "DELETE" });
	}

	async createDirectory(uri?: vscode.Uri): Promise<void> {
		if(this.impactsFlowsDirectory(uri)) {
			throw vscode.FileSystemError.NoPermissions("'flows' is a reserved directory name");
		}

		await this.callFileApi("/directory" + (uri ? `?path=${this.trimNamespace(uri.path)}` : ""), { method: "POST" });
	}

	// --- manage file events

	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	watch(_resource: vscode.Uri): vscode.Disposable {
		// ignore, fires for all changes...
		return new vscode.Disposable(() => { });
	}
}