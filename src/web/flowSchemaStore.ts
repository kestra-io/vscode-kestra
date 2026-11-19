import type * as vscode from 'vscode';

type SchemaFileSystem = Pick<vscode.FileSystem, "readFile" | "writeFile" | "createDirectory">;

// The flow schema is ~34 MB, too large for globalState (issue #57), so it lives in a file and is cached in memory.
export class FlowSchemaStore {
    private schema: Promise<string | undefined> | undefined;
    private readonly file: vscode.Uri;

    constructor(private readonly fs: SchemaFileSystem, private readonly dir: vscode.Uri) {
        this.file = dir.with({path: `${dir.path}/flow-schema.json`});
    }

    read(): Promise<string | undefined> {
        this.schema ??= Promise.resolve(this.fs.readFile(this.file)).then(
            bytes => new TextDecoder().decode(bytes),
            () => undefined
        );
        return this.schema;
    }

    async write(content: string): Promise<void> {
        await this.fs.createDirectory(this.dir);
        await this.fs.writeFile(this.file, new TextEncoder().encode(content));
        this.schema = Promise.resolve(content);
    }

    // Moves a schema stored by versions up to 1.2.0 out of globalState. The key is cleared only once the file is written.
    async migrateFrom(globalState: vscode.Memento, legacyKey: string): Promise<void> {
        const legacy = globalState.get<string>(legacyKey);
        if (legacy === undefined) {
            return;
        }
        await this.write(legacy);
        await globalState.update(legacyKey, undefined);
    }
}
