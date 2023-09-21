/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as path from 'path';
import * as vscode from 'vscode';

export class File implements vscode.FileStat {

	type: vscode.FileType;
	ctime: number;
	mtime: number;
	size: number;

	name: string;
	data?: Uint8Array;

	constructor(name: string, data: Uint8Array) {
		this.type = vscode.FileType.File;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = 0;
		this.name = name;
		this.data = data;
	}
}

export class Directory implements vscode.FileStat {

	type: vscode.FileType;
	ctime: number;
	mtime: number;
	size: number;

	name: string;
	entries: Array<Entry>;

	constructor(name: string) {
		this.type = vscode.FileType.Directory;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = 0;
		this.name = name;
		this.entries = [];
	}
}

export type Entry = File | Directory;

export class KestraFS implements vscode.FileSystemProvider {
	entryByPath : {[key: string]: Entry} = {"/root": new Directory("root")};

	stat(uri: vscode.Uri): vscode.FileStat {
		console.log("STAT : "+uri.path);
		return this._lookup(uri);
	}

	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
		console.log("DIR READ : "+uri.path);
		return ((this._lookup(uri, true) as Directory)?.entries || []).map(entry => [entry.name, entry.type]);
	}

	readFile(uri: vscode.Uri): Uint8Array {
		console.log("File READ : "+uri.path);
		return ((this._lookup(uri) as File)?.data as Uint8Array);
	}

	writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
		console.log("File CREATE : "+uri.path);
		const current = this._lookup(uri, true);
		if((current === undefined && options?.create) || (current && options?.overwrite)) {
			const splitPath = uri.path.split("/");
			this.entryByPath[uri.path] = new File(splitPath.pop() as string, content);
			console.log("splitPathJoin : "+splitPath.join("/"));
			(this.entryByPath[splitPath.join("/")] as Directory).entries.push(this.entryByPath[uri.path]);
		}
	}

	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
		this.entryByPath[newUri.path] = this._lookup(oldUri);
		delete this.entryByPath[oldUri.path];
	}

	delete(uri: vscode.Uri): void {
		delete this.entryByPath[uri.path];
	}

	createDirectory(uri: vscode.Uri): void {
		console.log("Directory CREATE : "+uri.path);
		const splitPath = uri.path.split("/");
		this.entryByPath[uri.path] = new Directory(splitPath.pop() as string);
		(this.entryByPath[splitPath.join("/")] as Directory).entries.push(this.entryByPath[uri.path]);
	}

	private _lookup(uri: vscode.Uri, silent?: boolean): Entry {
		const entry = this.entryByPath[uri.path];

		if(!entry && !silent) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		return entry;
	}

	// --- manage file events

	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _bufferedEvents: vscode.FileChangeEvent[] = [];
	private _fireSoonHandle?: NodeJS.Timeout;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	watch(_resource: vscode.Uri): vscode.Disposable {
		// ignore, fires for all changes...
		return new vscode.Disposable(() => { });
	}

	private _fireSoon(...events: vscode.FileChangeEvent[]): void {
		this._bufferedEvents.push(...events);

		if (this._fireSoonHandle) {
			clearTimeout(this._fireSoonHandle);
		}

		this._fireSoonHandle = setTimeout(() => {
			this._emitter.fire(this._bufferedEvents);
			this._bufferedEvents.length = 0;
		}, 5);
	}
}