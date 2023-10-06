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
		return await fetch(`${this.url}/api/v1/files/${this.namespace}${suffix ?? ""}`, options);
	}

	private isExcludedFolder(uri: vscode.Uri) {
		return EXCLUDED_FOLDERS.some(f => uri.path.includes(f));
	}

	private trimNamespace(path: string) {
		return path.substring(this.namespace.length + 1);
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		if (this.isExcludedFolder(uri)) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		
		const response = await this.callFileApi(`/stats?path=${this.trimNamespace(uri.path)}`);
		if(!response.ok) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		return fileStatFromKestraFileAttrs(await response.json() as KestraFileAttributes);
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const response = await this.callFileApi("/directory" + (uri ? `?path=${this.trimNamespace(uri.path)}` : ""));
		if(!response.ok) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		return (await response.json() as Array<KestraFileAttributes>)
			.map(attr => [attr.fileName, vscode.FileType[attr.type]]);
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		if (this.isExcludedFolder(uri)) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		const response = await this.callFileApi("?path=" + this.trimNamespace(uri.path));

		return new Uint8Array(await response.arrayBuffer());
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		const formData = new FormData();
		formData.append('fileContent', new Blob([content]));
		
		await this.callFileApi("?path=" + this.trimNamespace(uri.path), {
			method: "POST",
			body: formData
		});
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		await this.callFileApi(`?from=${this.trimNamespace(oldUri.path)}&to=${this.trimNamespace(newUri.path)}`, { method: "PUT" });
	}

	async delete(uri: vscode.Uri): Promise<void> {
		await this.callFileApi(`?path=${this.trimNamespace(uri.path)}`, { method: "DELETE" });
	}

	async createDirectory(uri?: vscode.Uri): Promise<void> {
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