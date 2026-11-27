import * as assert from "assert";
import type * as vscode from "vscode";
import ApiClient from "../web/apiClient";
import {secretStorageKey} from "../web/constants";

// Runs ApiClient against a real instance: KESTRA_TEST_URL, plus KESTRA_TEST_USERNAME / KESTRA_TEST_PASSWORD for basic auth
// and KESTRA_TEST_TENANT for an Enterprise Edition tenant. Skipped when KESTRA_TEST_URL is not set.
// Creates flows and files in the vscode.test namespace and deletes them.
const url = process.env.KESTRA_TEST_URL;
const namespace = "vscode.test";
const suffix = Date.now().toString(36);

class MemorySecrets implements vscode.SecretStorage {
    private readonly values = new Map<string, string>();
    readonly onDidChange = (() => ({dispose: () => undefined})) as unknown as vscode.Event<vscode.SecretStorageChangeEvent>;
    async keys(): Promise<string[]> {
        return [...this.values.keys()];
    }
    async get(key: string): Promise<string | undefined> {
        return this.values.get(key);
    }
    async store(key: string, value: string): Promise<void> {
        this.values.set(key, value);
    }
    async delete(key: string): Promise<void> {
        this.values.delete(key);
    }
}

function clientWith(username: string, password: string): ApiClient {
    const secrets = new MemorySecrets();
    // Keys are scoped to the instance URL, as ApiClient.secretKey builds them.
    void secrets.store(`${secretStorageKey.username}::${url}`, username);
    void secrets.store(`${secretStorageKey.password}::${url}`, password);
    return new ApiClient(secrets);
}

function flow(id: string, body: string): string {
    return `id: ${id}\nnamespace: ${namespace}\n${body}`;
}

const logFlow = (id: string) => flow(id, "inputs:\n  - id: user\n    type: STRING\ntasks:\n  - id: greet\n    type: io.kestra.plugin.core.log.Log\n    message: \"Hello {{ inputs.user }}\"\n");

describe("live Kestra instance", function () {
    this.timeout(60_000);
    let api: ApiClient;
    let major = 0;
    const createdFlows: string[] = [];

    before(async function () {
        if (!url) {
            this.skip();
        }
        ApiClient.pinInstance({url: url!, tenant: process.env.KESTRA_TEST_TENANT ?? ""});
        api = clientWith(process.env.KESTRA_TEST_USERNAME ?? "", process.env.KESTRA_TEST_PASSWORD ?? "");
        major = Number((await api.instanceVersion())?.split(".")[0] ?? 0);
    });

    after(async function () {
        if (!url) {
            return;
        }
        for (const id of createdFlows) {
            await api.flowsApi(`/${namespace}/${id}`, {method: "DELETE"}).catch(() => undefined);
        }
        await api.fileApi(namespace, "?path=/live", {method: "DELETE"}).catch(() => undefined);
    });

    it("accepts the credentials and rejects a wrong password", async () => {
        assert.deepStrictEqual(await api.verifyCredentials(), {status: "ok"});
        const wrong = await clientWith(process.env.KESTRA_TEST_USERNAME ?? "", "not-the-password").verifyCredentials();
        // 1.x serves /configs without auth, so a wrong password only shows on a protected route.
        if (wrong.status === "ok") {
            const response = await clientWith(process.env.KESTRA_TEST_USERNAME ?? "", "not-the-password").validateFlowSilent(logFlow("auth"));
            assert.strictEqual(response, null);
        } else {
            assert.strictEqual(wrong.status, "unauthorized");
        }
    });

    it("reads the instance version", () => {
        assert.ok(major >= 1, `unexpected version major ${major}`);
    });

    it("validates a flow and reports an unknown type", async () => {
        const valid = await (await api.validateFlow(logFlow("valid"))).json() as Array<{constraints?: string}>;
        // 2.0 omits constraints on a valid flow, develop sends an empty string.
        assert.ok(!valid[0].constraints, valid[0].constraints);

        const invalid = await (await api.validateFlow(flow("bad", "tasks:\n  - id: t\n    type: io.kestra.plugin.core.log.Nope\n"))).json() as Array<{constraints?: string}>;
        assert.match(invalid[0].constraints ?? "", /io\.kestra\.plugin\.core\.log\.Nope/);
    });

    it("builds the topology graph of an unsaved flow", async () => {
        const graph = await api.flowGraph(logFlow("graph"));
        assert.ok(graph?.nodes.some(node => JSON.stringify(node).includes("greet")), "no node for the greet task");
    });

    it("serves the expression context on 2.x only", async () => {
        const result = await api.flowExpressions(logFlow("expr"));
        if (major >= 2) {
            assert.strictEqual(result.status, "ok");
            assert.ok(result.status === "ok" && result.expressions.inputs?.some(input => input.includes("user")), "inputs.user missing");
        } else {
            // pebbleCompletion gates on the version, so 1.x never relies on this route.
            assert.notStrictEqual(result.status, "ok");
        }
        assert.ok((await api.pebbleFilters())?.includes("upper"));
        assert.ok(((await api.pebbleFunctions()) ?? []).length > 0);
    });

    it("serves plugin docs, groups and icons", async () => {
        const log = await api.pluginDefinition("io.kestra.plugin.core.log.Log");
        assert.ok(log?.schema?.properties?.properties?.message, "Log has no message property");
        assert.deepStrictEqual(await api.taskOutputProperties("io.kestra.plugin.core.output.OutputValues"), ["values"]);
        assert.ok(((await api.pluginSubgroups()) ?? []).length > 0);
        assert.ok(Object.keys((await api.pluginGroupIcons()) ?? {}).some(group => group.startsWith("io.kestra.plugin.core")));
        assert.ok((await api.pluginIcons())?.["io.kestra.plugin.core.log.Log"]);
    });

    it("creates, updates and reads back a flow, and finds its namespace", async () => {
        const id = `upsert_${suffix}`;
        createdFlows.push(id);
        assert.ok((await api.upsertFlow(namespace, id, logFlow(id))).ok);
        assert.ok((await api.upsertFlow(namespace, id, logFlow(id) + "description: updated\n")).ok);

        const saved = await (await api.flowsApi(`/${namespace}/${id}?source=true`)).json() as {source: string};
        assert.match(saved.source, /description: updated/);
        assert.ok((await api.listNamespaces()).includes(namespace));
        assert.strictEqual(await api.namespaceExists(namespace), true);
        assert.strictEqual(await api.namespaceExists(`missing.${suffix}`), false);
    });

    it("uploads and reads back a namespace file", async () => {
        const response = await api.uploadNamespaceFile(namespace, "live/hello.txt", new TextEncoder().encode("hello from vscode"));
        assert.ok(response?.ok, `upload failed with ${response?.status}`);
        assert.strictEqual(await (await api.fileApi(namespace, "?path=/live/hello.txt")).text(), "hello from vscode");
        assert.deepStrictEqual(await api.namespaceFilesReachable(namespace), {ok: true});
        assert.deepStrictEqual(await api.namespaceFilesReachable(`missing.${suffix}`), {ok: false, status: 404});
    });
});
