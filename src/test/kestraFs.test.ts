import * as assert from "assert";
import {URI} from "vscode-uri";
import {KestraFS} from "../web/kestraFsProvider";
import type ApiClient from "../web/apiClient";

type Call = {api: "files" | "flows"; namespace?: string; suffix: string; method: string};

// The helpers are unit-tested on their own. What this covers is the wiring: which helper each call
// site uses, and the exact query it puts on the wire. Issue #51 was a wiring bug, not a helper bug.
function provider(namespace = "company.team"): {fs: KestraFS; calls: Call[]} {
    const calls: Call[] = [];
    const fileAttrs = {fileName: "notes.txt", type: "File", creationTime: 0, lastModifiedTime: 0, size: 1, readOnly: false};
    const respond = (suffix: string) => ({
        ok: true,
        status: 200,
        // A listing returns an array, everything else one object.
        json: async () => (suffix.startsWith("/directory") ? [fileAttrs] : fileAttrs),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0)
    });
    const apiClient = {
        fileApi: async (ns: string, suffix?: string, options?: {method?: string}) => {
            calls.push({api: "files", namespace: ns, suffix: suffix ?? "", method: options?.method ?? "GET"});
            return respond(suffix ?? "");
        },
        flowsApi: async (suffix?: string, options?: {method?: string}) => {
            calls.push({api: "flows", suffix: suffix ?? "", method: options?.method ?? "GET"});
            return {...respond(""), json: async () => ({source: "id: x"})};
        }
    };
    return {fs: new KestraFS(namespace, apiClient as unknown as ApiClient, "abc123"), calls};
}

const failsWith = (code: string) => (error: unknown) => (error as {code?: string}).code === code;

const uri = (path: string) => URI.from({scheme: "kestra", authority: "abc123", path}) as never;

describe("KestraFS query building", () => {
    it("sends the namespace-relative path for a read", async () => {
        const {fs, calls} = provider();
        await fs.readFile(uri("/company.team/dir/notes.txt"));
        assert.deepStrictEqual(calls, [{api: "files", namespace: "company.team", suffix: "?path=/dir/notes.txt", method: "GET"}]);
    });

    it("lists the namespace root with an empty path", async () => {
        const {fs, calls} = provider();
        await fs.readDirectory(uri("/company.team"));
        assert.strictEqual(calls[0].suffix, "/directory?path=");
    });

    // Unencoded, fetch dropped everything from the # and the server deleted the namespace root.
    it("encodes a fragment in a file name on delete", async () => {
        const {fs, calls} = provider();
        await fs.delete(uri("/company.team/#notes.md"));
        assert.deepStrictEqual(calls, [{api: "files", namespace: "company.team", suffix: "?path=/%23notes.md", method: "DELETE"}]);
    });

    it("encodes both sides of a rename", async () => {
        const {fs, calls} = provider();
        await fs.rename(uri("/company.team/a&b.txt"), uri("/company.team/c d.txt"), {overwrite: false});
        assert.strictEqual(calls[0].suffix, "?from=/a%26b.txt&to=/c%20d.txt");
        assert.strictEqual(calls[0].method, "PUT");
    });
});

describe("KestraFS refuses destructive paths", () => {
    it("will not delete the namespace root, however it is spelled", async () => {
        for (const path of ["/company.team", "/company.team/"]) {
            const {fs, calls} = provider();
            await assert.rejects(() => Promise.resolve(fs.delete(uri(path))), failsWith("NoPermissions"), `deleted "${path}"`);
            assert.deepStrictEqual(calls, [], `called the api for "${path}"`);
        }
    });

    it("will not touch a path outside the namespace", async () => {
        const {fs, calls} = provider();
        await assert.rejects(() => fs.readFile(uri("/other/notes.txt")), failsWith("FileNotFound"));
        await assert.rejects(() => Promise.resolve(fs.delete(uri("/other/notes.txt"))), failsWith("FileNotFound"));
        assert.deepStrictEqual(calls, []);
    });

    it("will not delete the reserved flows directory", async () => {
        const {fs, calls} = provider();
        await assert.rejects(() => Promise.resolve(fs.delete(uri("/company.team/_flows"))), failsWith("NoPermissions"));
        assert.deepStrictEqual(calls, []);
    });

    // A read is not consent to remove the file from the instance.
    it("hides an excluded folder without deleting it", async () => {
        const {fs, calls} = provider();
        await assert.rejects(() => fs.stat(uri("/company.team/.vscode/settings.json")), failsWith("FileNotFound"));
        assert.deepStrictEqual(calls, []);
    });
});
