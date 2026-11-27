import * as assert from "assert";
import type * as vscode from "vscode";
import ApiClient from "../web/apiClient";

describe("ApiClient.upsertFlow", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    it("never PUTs a flow when the existence check fails", async () => {
        const calls: string[] = [];
        globalThis.fetch = (async (url: string, options?: RequestInit) => {
            calls.push(`${options?.method ?? "GET"} ${url}`);
            return new Response("{}", {status: 503});
        }) as typeof fetch;
        ApiClient.pinInstance({url: "http://kestra.test", tenant: ""});
        const secrets = {get: async () => undefined, store: async () => undefined, delete: async () => undefined} as unknown as vscode.SecretStorage;

        const response = await new ApiClient(secrets).upsertFlow("company.team", "hello", "id: hello\n");

        assert.strictEqual(response.status, 503);
        assert.deepStrictEqual(calls, ["GET http://kestra.test/api/v1/flows/company.team/hello"]);
    });
});
