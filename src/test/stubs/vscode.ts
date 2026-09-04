/* eslint-disable @typescript-eslint/naming-convention */
// Names must match the vscode API exactly, so the convention rule does not apply here.
// Enough of the vscode API to exercise KestraFS in mocha. URI behaviour is the real vscode-uri,
// which is what the editor itself uses, so path and authority handling is not approximated.
import {URI} from "vscode-uri";

export const Uri = URI;
export type Uri = URI;

export enum FileType {Unknown = 0, File = 1, Directory = 2, SymbolicLink = 64}
export enum FilePermission {Readonly = 1}

export class FileSystemError extends Error {
    public readonly code: string;
    constructor(code: string, message?: string) {
        super(message ?? code);
        this.code = code;
    }
    static FileNotFound(target?: unknown): FileSystemError {
        return new FileSystemError("FileNotFound", String(target));
    }
    static NoPermissions(target?: unknown): FileSystemError {
        return new FileSystemError("NoPermissions", String(target));
    }
    static FileExists(target?: unknown): FileSystemError {
        return new FileSystemError("FileExists", String(target));
    }
}

export class Disposable {
    constructor(private readonly onDispose: () => void) {}
    dispose(): void {
        this.onDispose();
    }
}

export class EventEmitter<T> {
    event = (_listener: (value: T) => void) => new Disposable(() => undefined);
    fire(_value: T): void {}
    dispose(): void {}
}

export const commands = {executeCommand: async (..._args: unknown[]) => undefined};
export const workspace = {getConfiguration: () => ({get: () => undefined})};
export const window = {showWarningMessage: async () => undefined};

// Type-only members the provider imports, including the proposed file-search API.
export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;
export interface CancellationToken {isCancellationRequested: boolean}
export interface FileSearchQuery {pattern: string}
export interface FileSearchOptions {maxResults?: number}
export interface FileSearchProvider {
    provideFileSearchResults(query: FileSearchQuery, options: FileSearchOptions, token: CancellationToken): ProviderResult<Uri[]>;
}
export interface FileStat {type: FileType; ctime: number; mtime: number; size: number; permissions?: FilePermission}
export interface FileChangeEvent {type: number; uri: Uri}
export interface FileSystemProvider {
    onDidChangeFile: unknown;
    watch(resource: Uri): Disposable;
    stat(uri: Uri): FileStat | Thenable<FileStat>;
}
export type Event<T> = (listener: (value: T) => void) => Disposable;
