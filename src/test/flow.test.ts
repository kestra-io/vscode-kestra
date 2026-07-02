import * as assert from "assert";
import {flattenInputs, formatDuration} from "../shared/flow";

describe("flattenInputs", () => {
    it("passes plain inputs through unchanged", () => {
        const inputs = [{id: "a", type: "STRING"}, {id: "b", type: "INT"}];
        assert.deepStrictEqual(flattenInputs(inputs), inputs);
    });
    it("expands a FORM into dotted-id children", () => {
        const inputs = [{id: "environment", type: "FORM", inputs: [{id: "region", type: "SELECT"}, {id: "dc", type: "STRING"}]}];
        assert.deepStrictEqual(flattenInputs(inputs), [
            {id: "environment.region", type: "SELECT"},
            {id: "environment.dc", type: "STRING"}
        ]);
    });
    it("keeps document order across plain inputs and FORM children", () => {
        const inputs = [
            {id: "a", type: "STRING"},
            {id: "form", type: "FORM", inputs: [{id: "x"}]},
            {id: "b", type: "DATE"}
        ];
        assert.deepStrictEqual(flattenInputs(inputs).map(input => input.id), ["a", "form.x", "b"]);
    });
    it("drops an empty FORM", () => {
        assert.deepStrictEqual(flattenInputs([{id: "form", type: "FORM"}]), []);
    });
    it("returns an empty list for missing inputs", () => {
        assert.deepStrictEqual(flattenInputs(undefined), []);
    });
});

describe("formatDuration", () => {
    it("keeps sub-minute durations in seconds with decimals", () => {
        assert.strictEqual(formatDuration(4.321), "4.32s");
    });
    it("shows the two largest units", () => {
        assert.strictEqual(formatDuration(94), "1m 34s");
        assert.strictEqual(formatDuration(3720), "1h 2m");
    });
    it("omits zero units", () => {
        assert.strictEqual(formatDuration(3600), "1h");
    });
});
