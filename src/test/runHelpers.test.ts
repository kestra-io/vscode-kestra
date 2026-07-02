import * as assert from "assert";
import {durationOf, sanitizeFileName} from "../web/libs/runHelpers";

describe("durationOf", () => {
    it("computes seconds between the first and last history dates", () => {
        assert.strictEqual(
            durationOf({histories: [{date: "2024-01-01T00:00:00Z"}, {date: "2024-01-01T00:00:02.500Z"}]}),
            2.5
        );
    });
    it("returns 0 for a single history entry", () => {
        assert.strictEqual(durationOf({histories: [{date: "2024-01-01T00:00:00Z"}]}), 0);
    });
    it("never returns a negative duration", () => {
        assert.strictEqual(
            durationOf({histories: [{date: "2024-01-01T00:00:05Z"}, {date: "2024-01-01T00:00:00Z"}]}),
            0
        );
    });
    it("returns undefined for empty or missing histories", () => {
        assert.strictEqual(durationOf({histories: []}), undefined);
        assert.strictEqual(durationOf({}), undefined);
        assert.strictEqual(durationOf(undefined), undefined);
    });
    it("returns undefined for unparseable dates", () => {
        assert.strictEqual(durationOf({histories: [{date: "nope"}, {date: "nope"}]}), undefined);
    });
});

describe("sanitizeFileName", () => {
    it("replaces spaces with underscores", () => {
        assert.strictEqual(sanitizeFileName("my file.txt"), "my_file.txt");
    });
    it("replaces slashes and other special chars", () => {
        assert.strictEqual(sanitizeFileName("a/b\\c:d.txt"), "a_b_c_d.txt");
    });
    it("leaves letters, digits, dots, dashes and underscores untouched", () => {
        assert.strictEqual(sanitizeFileName("clean-name_1.2.txt"), "clean-name_1.2.txt");
    });
});
