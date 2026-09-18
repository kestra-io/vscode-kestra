import * as assert from "assert";
import {ExpressionContext, childrenOf, membersOf, rootNames, supportsExpressionsEndpoint} from "../web/libs/expressionContext";

// Shape as returned by POST /flows/expressions on Kestra 2.0.
const context: ExpressionContext = {
    taskOutputs: ["outputs.download.uri", "outputs.download.headers.contentType", "outputs['my-task'].uri", "trigger.date"],
    executionContext: ["execution", "execution.id", "execution.state", "flow", "flow.id", "inputs", "outputs", "vars"],
    inputs: ["inputs.url"],
    variables: ["vars.region"],
    secrets: ["secret('DB_PASSWORD')"],
    filters: ["upper"],
    functions: ["now()"]
};

describe("expressionContext", () => {
    it("lists root variables from every path category, deduplicated", () => {
        const roots = rootNames(context);
        assert.deepStrictEqual(roots, ["outputs", "trigger", "execution", "flow", "inputs", "vars"]);
    });

    it("keeps bracket-quoted task ids out of the root list", () => {
        assert.ok(!rootNames(context).some(name => name.includes("[")));
    });

    it("resolves children one level under a base", () => {
        assert.deepStrictEqual(childrenOf(context, "outputs"), ["download"]);
        assert.deepStrictEqual(childrenOf(context, "execution"), ["id", "state"]);
        assert.deepStrictEqual(childrenOf(context, "inputs"), ["url"]);
    });

    it("resolves nested task output properties", () => {
        assert.deepStrictEqual(childrenOf(context, "outputs.download"), ["uri", "headers"]);
        assert.deepStrictEqual(childrenOf(context, "outputs.download.headers"), ["contentType"]);
    });

    it("returns nothing for an unknown base", () => {
        assert.deepStrictEqual(childrenOf(context, "nope"), []);
        assert.deepStrictEqual(childrenOf(context, "outputs.download.uri"), []);
    });

    it("ignores call-form and filter categories", () => {
        assert.ok(!rootNames(context).some(name => name.startsWith("secret")));
        assert.ok(!rootNames(context).includes("upper"));
        assert.ok(!rootNames(context).includes("now()"));
    });

    it("handles an empty context", () => {
        assert.deepStrictEqual(rootNames({}), []);
        assert.deepStrictEqual(childrenOf({}, "outputs"), []);
    });
});

describe("supportsExpressionsEndpoint", () => {
    it("accepts Kestra 2.0 and later", () => {
        for (const version of ["2.0.0", "2.0.2", "2.1.0-SNAPSHOT", "3.0.0"]) {
            assert.ok(supportsExpressionsEndpoint(version), version);
        }
    });

    // On 1.x the same POST matches "update every flow in namespace expressions", so it must not fire.
    it("rejects Kestra 1.x, and any version it cannot read", () => {
        for (const version of ["1.3.39", "1.0.60", "0.18.0", "", "LATEST", null]) {
            assert.ok(!supportsExpressionsEndpoint(version), String(version));
        }
    });
});

describe("membersOf", () => {
    // The endpoint omits tasks with no declared outputs, which would drop them from `outputs.`.
    it("keeps task ids the endpoint does not report", () => {
        assert.deepStrictEqual(
            membersOf(context, "outputs", ["download", "log-it", "pause"]),
            ["download", "log-it", "pause"]
        );
    });

    it("does not duplicate a task the endpoint already reports", () => {
        assert.deepStrictEqual(membersOf(context, "outputs", ["download"]), ["download"]);
    });

    it("merges task ids only under outputs", () => {
        assert.deepStrictEqual(membersOf(context, "execution", ["download"]), ["id", "state"]);
        assert.deepStrictEqual(membersOf(context, "outputs.download", ["download"]), ["uri", "headers"]);
    });
});
