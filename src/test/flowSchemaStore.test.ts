import * as assert from "assert";
import {URI} from "vscode-uri";
import type * as vscode from "vscode";
import {FlowSchemaStore} from "../web/flowSchemaStore";

const legacyKey = "kestra.yaml.schema";

function memoryFs(failWrites = false) {
    const files = new Map<string, Uint8Array>();
    return {
        files,
        createDirectory: async () => {},
        writeFile: async (uri: vscode.Uri, content: Uint8Array) => {
            if (failWrites) {
                throw new Error("disk full");
            }
            files.set(uri.toString(), content);
        },
        readFile: async (uri: vscode.Uri) => {
            const content = files.get(uri.toString());
            if (!content) {
                throw new Error("FileNotFound");
            }
            return content;
        }
    };
}

function memento(entries: Record<string, unknown>): vscode.Memento {
    return {
        keys: () => Object.keys(entries),
        get: (key: string) => entries[key],
        update: async (key: string, value: unknown) => {
            if (value === undefined) {
                delete entries[key];
            } else {
                entries[key] = value;
            }
        }
    } as vscode.Memento;
}

const storageDir = URI.file("/storage/kestra-io.kestra") as unknown as vscode.Uri;

describe("FlowSchemaStore", () => {
    it("returns undefined before any schema is stored", async () => {
        const store = new FlowSchemaStore(memoryFs(), storageDir);
        assert.strictEqual(await store.read(), undefined);
    });

    it("moves a schema out of globalState and clears the key", async () => {
        const fs = memoryFs();
        const state: Record<string, unknown> = {[legacyKey]: '{"definitions":{}}'};

        await new FlowSchemaStore(fs, storageDir).migrateFrom(memento(state), legacyKey);

        assert.strictEqual(state[legacyKey], undefined);
        assert.strictEqual(await new FlowSchemaStore(fs, storageDir).read(), '{"definitions":{}}');
    });

    it("keeps the globalState schema when the file cannot be written", async () => {
        const state: Record<string, unknown> = {[legacyKey]: '{"definitions":{}}'};

        await assert.rejects(new FlowSchemaStore(memoryFs(true), storageDir).migrateFrom(memento(state), legacyKey));

        assert.strictEqual(state[legacyKey], '{"definitions":{}}');
    });
});
