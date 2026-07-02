import * as assert from "assert";
import {parseSseFrame, readSseStream, SseFrame} from "../web/libs/sse";

describe("parseSseFrame", () => {
    it("uses the Kestra 'id' field as the frame name", () => {
        assert.deepStrictEqual(parseSseFrame("id: start\ndata: {}"), {name: "start", data: "{}"});
    });
    it("uses the standard 'event' field as the frame name", () => {
        assert.deepStrictEqual(parseSseFrame("event: end\ndata: {}"), {name: "end", data: "{}"});
    });
    it("prefers 'event' over 'id' when both are present", () => {
        assert.strictEqual(parseSseFrame("event: e\nid: i\ndata: x")?.name, "e");
    });
    it("returns data with no name when only data is present", () => {
        assert.deepStrictEqual(parseSseFrame("data: hello"), {name: undefined, data: "hello"});
    });
    it("joins multi-line data with newlines", () => {
        assert.strictEqual(parseSseFrame("id: progress\ndata: a\ndata: b")?.data, "a\nb");
    });
    it("returns null for a keep-alive or empty frame", () => {
        assert.strictEqual(parseSseFrame(":"), null);
        assert.strictEqual(parseSseFrame(""), null);
    });
    it("parses a realistic log frame", () => {
        const frame = "id: progress\ndata: {\"level\":\"INFO\",\"message\":\"hi\"}";
        assert.deepStrictEqual(parseSseFrame(frame), {name: "progress", data: "{\"level\":\"INFO\",\"message\":\"hi\"}"});
    });
});

describe("readSseStream", () => {
    function readerOf(...chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
        const encoder = new TextEncoder();
        const remaining = chunks.map(chunk => encoder.encode(chunk));
        return {
            read: () => Promise.resolve(remaining.length === 0 ? {done: true, value: undefined} : {done: false, value: remaining.shift()}),
            cancel: () => Promise.resolve(),
            closed: Promise.resolve(undefined),
            releaseLock: () => undefined
        } as unknown as ReadableStreamDefaultReader<Uint8Array>;
    }

    it("emits one frame per blank-line separator", async () => {
        const frames: SseFrame[] = [];
        await readSseStream(readerOf("id: a\ndata: 1\n\nid: b\ndata: 2\n\n"), frame => frames.push(frame));
        assert.deepStrictEqual(frames, [{name: "a", data: "1"}, {name: "b", data: "2"}]);
    });
    it("reassembles a frame split across chunks", async () => {
        const frames: SseFrame[] = [];
        await readSseStream(readerOf("id: a\nda", "ta: 1\n\n"), frame => frames.push(frame));
        assert.deepStrictEqual(frames, [{name: "a", data: "1"}]);
    });
    it("drops a trailing partial frame with no separator", async () => {
        const frames: SseFrame[] = [];
        await readSseStream(readerOf("id: a\ndata: 1"), frame => frames.push(frame));
        assert.deepStrictEqual(frames, []);
    });
});
