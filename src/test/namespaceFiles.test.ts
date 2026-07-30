import * as assert from "assert";
import {basename, namespacePath, isIgnoredName, reachabilityError, uploadNotice} from "../web/namespaceFilesHelpers";

describe("basename", () => {
    it("returns the last path segment", () => {
        assert.strictEqual(basename("/a/b/c.py"), "c.py");
    });
    it("ignores trailing slashes", () => {
        assert.strictEqual(basename("/a/b/"), "b");
    });
    it("falls back to the input when there is no segment", () => {
        assert.strictEqual(basename("/"), "/");
    });
});

describe("namespacePath", () => {
    it("joins a root base", () => {
        assert.strictEqual(namespacePath("/", "a.py"), "/a.py");
    });
    it("joins a nested base and relative path", () => {
        assert.strictEqual(namespacePath("/scripts", "sub/a.py"), "/scripts/sub/a.py");
    });
    it("does not double the slash when the base has a trailing one", () => {
        assert.strictEqual(namespacePath("/scripts/", "a.py"), "/scripts/a.py");
    });
});

describe("isIgnoredName", () => {
    it("ignores metadata directories", () => {
        assert.ok(isIgnoredName(".git"));
        assert.ok(isIgnoredName("node_modules"));
    });
    it("ignores env and credential files", () => {
        assert.ok(isIgnoredName(".env"));
        assert.ok(isIgnoredName(".env.local"));
        assert.ok(isIgnoredName("credentials.json"));
        assert.ok(isIgnoredName(".npmrc"));
    });
    it("ignores private key material by suffix", () => {
        assert.ok(isIgnoredName("server.pem"));
        assert.ok(isIgnoredName("tls.KEY"));
        assert.ok(isIgnoredName("id_rsa"));
    });
    it("keeps ordinary source files", () => {
        assert.ok(!isIgnoredName("main.py"));
        assert.ok(!isIgnoredName("query.sql"));
        assert.ok(!isIgnoredName("README.md"));
    });
});

describe("reachabilityError", () => {
    it("tells a signed-out user to sign in on 401", () => {
        assert.match(reachabilityError("ns", {status: 401}, false), /not signed in/);
    });
    it("reports access denied for a signed-in 401", () => {
        assert.match(reachabilityError("ns", {status: 401}, true), /access denied/);
    });
    it("names the files permission on 403", () => {
        assert.match(reachabilityError("ns", {status: 403}, true), /permission/);
    });
    it("reports not found on 404", () => {
        assert.match(reachabilityError("ns", {status: 404}, true), /not found/);
    });
    it("falls back to unreachable when there is no status", () => {
        assert.match(reachabilityError("ns", {}, true), /not reachable/);
    });
});

describe("uploadNotice", () => {
    it("errors when stopped by an access denial", () => {
        const notice = uploadNotice("ns", 5, {uploaded: 2, failed: ["x"], stoppedByAuth: true, cancelled: false});
        assert.strictEqual(notice.kind, "error");
    });
    it("reports cancellation with the failed count, ahead of the failure list", () => {
        const notice = uploadNotice("ns", 5, {uploaded: 3, failed: ["x"], stoppedByAuth: false, cancelled: true});
        assert.strictEqual(notice.kind, "info");
        assert.match(notice.text, /cancelled/);
        assert.match(notice.text, /1 failed/);
    });
    it("warns when some files failed", () => {
        const notice = uploadNotice("ns", 5, {uploaded: 4, failed: ["x"], stoppedByAuth: false, cancelled: false});
        assert.strictEqual(notice.kind, "warning");
    });
    it("confirms success when everything uploaded", () => {
        const notice = uploadNotice("ns", 5, {uploaded: 5, failed: [], stoppedByAuth: false, cancelled: false});
        assert.strictEqual(notice.kind, "info");
        assert.match(notice.text, /Uploaded 5/);
    });
});
