import type * as vscode from 'vscode';
import {flowSchemaUri} from './constants';

type SchemaFileSystem = Pick<vscode.FileSystem, "readFile" | "writeFile" | "createDirectory">;

// The flow schema is ~34 MB, too large for globalState (issue #57), so it lives in a file and is cached in memory.
export class FlowSchemaStore {
    private schema: Promise<string | undefined> | undefined;
    private loaded: string | undefined;
    private revision = 0;
    private readonly file: vscode.Uri;

    constructor(private readonly fs: SchemaFileSystem, private readonly dir: vscode.Uri) {
        this.file = dir.with({path: `${dir.path}/flow-schema.json`});
    }

    // redhat.vscode-yaml caches schema content per URI, a failed load included (issue #56). So no URI is handed out
    // before a schema is loaded, and a new one only when the content changes.
    get uri(): string | undefined {
        return this.loaded === undefined ? undefined : `${flowSchemaUri}?v=${this.revision}`;
    }

    read(): Promise<string | undefined> {
        this.schema ??= Promise.resolve(this.fs.readFile(this.file)).then(
            bytes => this.remember(new TextDecoder().decode(bytes)),
            () => {
                // Not cached, so a schema saved later, by this window or another one, is picked up on the next read.
                this.schema = undefined;
                return undefined;
            }
        );
        return this.schema;
    }

    async write(content: string): Promise<void> {
        await this.fs.createDirectory(this.dir);
        await this.fs.writeFile(this.file, new TextEncoder().encode(content));
        this.schema = Promise.resolve(this.remember(content));
    }

    // Moves a schema stored by versions up to 1.2.0 out of globalState. If the file cannot be written, the key is kept
    // and its value is still served for this session.
    async migrateFrom(globalState: vscode.Memento, legacyKey: string): Promise<void> {
        const legacy = globalState.get<string>(legacyKey);
        if (legacy === undefined) {
            return;
        }
        try {
            await this.write(legacy);
        } catch (error) {
            this.schema = Promise.resolve(this.remember(legacy));
            throw error;
        }
        await globalState.update(legacyKey, undefined);
    }

    private remember(content: string): string {
        if (this.loaded !== undefined && this.loaded !== content) {
            this.revision++;
        }
        this.loaded = content;
        return content;
    }
}
