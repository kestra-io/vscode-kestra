import * as assert from "assert";
import YamlUtils from "../web/libs/yamlUtils";

const flow = `id: hello
namespace: company.team

inputs:
  - id: url
    type: STRING
  - id: count
    type: INT

labels:
  env: prod
  team: data

variables:
  region: eu

tasks:
  - id: download
    type: io.kestra.plugin.core.http.Download
    uri: https://example.com
  - id: parent
    type: io.kestra.plugin.core.flow.Parallel
    tasks:
      - id: child
        type: io.kestra.plugin.core.log.Log
        message: hi
`;

describe("YamlUtils.isFlow", () => {
    it("is true with id, namespace and tasks", () => {
        assert.strictEqual(YamlUtils.isFlow(flow), true);
    });
    it("is true with triggers instead of tasks", () => {
        assert.strictEqual(YamlUtils.isFlow("id: a\nnamespace: b\ntriggers:\n  - id: t\n    type: X"), true);
    });
    it("is false without namespace", () => {
        assert.strictEqual(YamlUtils.isFlow("id: a\ntasks:\n  - id: t"), false);
    });
    it("is false without tasks or triggers", () => {
        assert.strictEqual(YamlUtils.isFlow("id: a\nnamespace: b"), false);
    });
    it("is false for non-flow content", () => {
        assert.strictEqual(YamlUtils.isFlow("just some text"), false);
    });
});

describe("YamlUtils.inputIds", () => {
    it("returns declared input ids", () => {
        assert.deepStrictEqual(YamlUtils.inputIds(flow), ["url", "count"]);
    });
    it("returns empty when there are no inputs", () => {
        assert.deepStrictEqual(YamlUtils.inputIds("id: a\nnamespace: b\ntasks: []"), []);
    });
});

describe("YamlUtils.taskIds", () => {
    it("collects top-level and nested task ids", () => {
        assert.deepStrictEqual(YamlUtils.taskIds(flow), ["download", "parent", "child"]);
    });
});

describe("YamlUtils.sectionKeys", () => {
    it("returns keys of the labels section", () => {
        assert.deepStrictEqual(YamlUtils.sectionKeys(flow, "labels"), ["env", "team"]);
    });
    it("returns keys of the variables section", () => {
        assert.deepStrictEqual(YamlUtils.sectionKeys(flow, "variables"), ["region"]);
    });
    it("returns empty for a missing section", () => {
        assert.deepStrictEqual(YamlUtils.sectionKeys(flow, "nope"), []);
    });
});

describe("YamlUtils.nodeRange", () => {
    it("resolves a path to the node's character offsets", () => {
        const range = YamlUtils.nodeRange(flow, ["tasks", 0, "uri"]);
        assert.ok(range, "expected a range");
        assert.strictEqual(flow.slice(range![0], range![1]), "https://example.com");
    });
    it("returns undefined for an unknown path", () => {
        assert.strictEqual(YamlUtils.nodeRange(flow, ["tasks", 99, "nope"]), undefined);
    });
    it("returns undefined for an empty path", () => {
        assert.strictEqual(YamlUtils.nodeRange(flow, []), undefined);
    });
});

const taskFlow = `id: a
namespace: b
tasks:
  - id: log1
    type: io.kestra.plugin.core.log.Log
    message: hi
`;

describe("YamlUtils.extractAllTypes", () => {
    it("extracts a task type", () => {
        const found = YamlUtils.extractAllTypes(taskFlow);
        assert.strictEqual(found.length, 1);
        assert.strictEqual(String(found[0].type), "io.kestra.plugin.core.log.Log");
    });
});

describe("YamlUtils.getTaskType", () => {
    it("returns the task type at a cursor inside the task", () => {
        assert.strictEqual(
            String(YamlUtils.getTaskType(taskFlow, {lineNumber: 5, column: 10})),
            "io.kestra.plugin.core.log.Log"
        );
    });
    it("returns null before any task", () => {
        assert.strictEqual(YamlUtils.getTaskType(taskFlow, {lineNumber: 1, column: 1}), null);
    });
});

describe("YamlUtils.taskRangeById", () => {
    it("returns the range of the task map with the given id", () => {
        const range = YamlUtils.taskRangeById(flow, "download");
        assert.ok(range);
        assert.ok(flow.slice(range[0], range[1]).startsWith("id: download"));
    });
    it("finds a nested task", () => {
        const range = YamlUtils.taskRangeById(flow, "child");
        assert.ok(range);
        assert.ok(flow.slice(range[0], range[1]).startsWith("id: child"));
    });
    it("returns undefined for an unknown id", () => {
        assert.strictEqual(YamlUtils.taskRangeById(flow, "nope"), undefined);
    });
});
