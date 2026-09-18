import * as assert from "assert";
import {ExpressionContext, childrenOf, membersOf, rootNames, structureKey, supportsExpressionsEndpoint} from "../web/libs/expressionContext";

// Trimmed shape, for the tree logic below. The real executionContext is REAL_EXECUTION_CONTEXT.
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

describe("structureKey", () => {
    const parts = {
        namespace: "c.t", taskIds: ["download"], taskTypes: ["io.kestra.plugin.core.http.Download"],
        inputIds: ["url"], variables: ["region"], labels: ["env"]
    };

    // Typing inside an expression must not refetch, every context-changing edit must.
    it("is stable when nothing the endpoint reads changed", () => {
        assert.strictEqual(structureKey(parts), structureKey({...parts}));
    });

    it("changes when a task, input, variable, label or namespace changes", () => {
        const base = structureKey(parts);
        assert.notStrictEqual(base, structureKey({...parts, taskIds: ["fetch"]}));
        assert.notStrictEqual(base, structureKey({...parts, taskTypes: ["io.kestra.plugin.core.log.Log"]}));
        assert.notStrictEqual(base, structureKey({...parts, inputIds: ["url", "count"]}));
        assert.notStrictEqual(base, structureKey({...parts, variables: []}));
        assert.notStrictEqual(base, structureKey({...parts, labels: ["env", "team"]}));
        assert.notStrictEqual(base, structureKey({...parts, namespace: "other.ns"}));
    });
});

// Verbatim executionContext from POST /flows/expressions on Kestra 2.0.0, for a flow with one label.
const REAL_EXECUTION_CONTEXT = [
    "envs", "execution", "execution.endDate", "execution.id", "execution.originalId",
    "execution.outputs", "execution.startDate", "execution.state", "files", "flow", "flow.id",
    "flow.namespace", "flow.revision", "flow.tenantId", "globals", "inputs", "item", "item.index",
    "item.key", "item.parent", "item.parent.index", "item.parent.key", "item.parent.value",
    "item.parents", "item.value", "kestra", "kestra.environment", "kestra.url", "labels",
    "labels.env", "outputs", "parent", "parent.task", "parent.task.id", "parent.taskrun",
    "parent.taskrun.value", "parents", "task", "task.id", "task.type", "taskrun",
    "taskrun.attemptsCount", "taskrun.id", "taskrun.iteration", "taskrun.parentId",
    "taskrun.startDate", "taskrun.value", "tasks", "trigger", "vars"
];

// The fallback lists in pebbleCompletion.ts, copied so drift between them is caught here.
const FALLBACK_VARIABLES = ["outputs", "inputs", "vars", "flow", "execution", "trigger", "task",
    "taskrun", "labels", "envs", "globals", "parent", "parents", "error", "kestra"];
const FALLBACK_NESTED: Record<string, string[]> = {
    flow: ["id", "namespace", "revision", "tenantId"],
    execution: ["id", "startDate", "state", "originalId", "outputs"],
    task: ["id", "type"],
    taskrun: ["id", "startDate", "attemptsCount", "parentId", "value", "iteration"],
    error: ["taskId", "message", "stackTrace"],
    kestra: ["environment", "url"]
};

describe("coverage of the fallback lists by a real 2.0 context", () => {
    const real: ExpressionContext = {executionContext: REAL_EXECUTION_CONTEXT};

    // `error` is not a Kestra 2.0 variable: core exposes error context through errorLogs().
    it("offers every fallback root variable except error", () => {
        const roots = rootNames(real);
        const missing = FALLBACK_VARIABLES.filter(name => !roots.includes(name));
        assert.deepStrictEqual(missing, ["error"]);
    });

    it("offers roots the fallback list never had", () => {
        const roots = rootNames(real);
        for (const name of ["files", "item", "tasks"]) {
            assert.ok(roots.includes(name), name);
        }
    });

    it("offers every nested field the fallback lists, except under error", () => {
        for (const [base, fields] of Object.entries(FALLBACK_NESTED)) {
            const live = childrenOf(real, base);
            const missing = fields.filter(field => !live.includes(field));
            assert.deepStrictEqual(missing, base === "error" ? fields : [], base);
        }
    });
});
