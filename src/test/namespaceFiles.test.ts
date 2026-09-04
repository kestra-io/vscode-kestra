import * as assert from "assert";
import {basename, namespacePath, matchesPattern, isIgnored, reachabilityError, uploadNotice, namespaceRelativePath, hasExcludedSegment} from "../web/namespaceFilesHelpers";

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

describe("matchesPattern", () => {
    it("matches an exact name", () => {
        assert.ok(matchesPattern(".git", ".git"));
        assert.ok(!matchesPattern(".gitignore", ".git"));
    });
    it("matches a trailing-wildcard suffix", () => {
        assert.ok(matchesPattern("server.pem", "*.pem"));
        assert.ok(matchesPattern("tls.KEY", "*.key")); // case-insensitive
        assert.ok(!matchesPattern("pem.txt", "*.pem"));
    });
    it("matches a leading-wildcard prefix", () => {
        assert.ok(matchesPattern(".env.local", ".env.*"));
        assert.ok(matchesPattern("id_rsa.pub", "id_rsa*"));
    });
});

describe("isIgnored", () => {
    const patterns = [".git", "node_modules", ".env", ".env.*", "*.pem", "credentials.json"];
    it("excludes metadata, env, and secret files", () => {
        assert.ok(isIgnored(".git", patterns));
        assert.ok(isIgnored("node_modules", patterns));
        assert.ok(isIgnored(".env", patterns));
        assert.ok(isIgnored(".env.local", patterns));
        assert.ok(isIgnored("server.pem", patterns));
        assert.ok(isIgnored("credentials.json", patterns));
    });
    it("keeps ordinary source files", () => {
        assert.ok(!isIgnored("main.py", patterns));
        assert.ok(!isIgnored("query.sql", patterns));
        assert.ok(!isIgnored("README.md", patterns));
    });
    it("excludes nothing when the pattern list is empty", () => {
        assert.ok(!isIgnored(".env", []));
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

describe("namespaceRelativePath", () => {
    it("returns the path below the namespace folder", () => {
        assert.strictEqual(namespaceRelativePath("company.team", "/company.team/notes.txt"), "/notes.txt");
    });
    it("returns empty for the namespace folder itself, which reads as its root", () => {
        assert.strictEqual(namespaceRelativePath("company.team", "/company.team"), "");
    });
    // Issue #51: these sliced into "" and "ings.json", and an empty DELETE path wiped the namespace.
    it("refuses a path that is not under the namespace", () => {
        for (const path of ["/.vscode", "/.git", "/.vscode/settings.json", "/other/notes.txt", "/"]) {
            assert.strictEqual(namespaceRelativePath("company.team", path), undefined, `accepted "${path}"`);
        }
    });
    it("does not treat a namespace that only shares a prefix as a parent", () => {
        assert.strictEqual(namespaceRelativePath("team", "/team-other/notes.txt"), undefined);
    });
});

describe("hasExcludedSegment", () => {
    it("matches a whole segment", () => {
        assert.strictEqual(hasExcludedSegment("/ns/.vscode/settings.json", [".git", ".vscode"]), true);
    });
    it("does not match a name that merely contains one", () => {
        for (const path of ["/ns/.gitignore", "/ns/my.github.notes", "/ns/legit.vscoded"]) {
            assert.strictEqual(hasExcludedSegment(path, [".git", ".vscode"]), false, `excluded "${path}"`);
        }
    });
});
