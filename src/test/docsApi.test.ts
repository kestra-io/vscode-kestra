import * as assert from "assert";
import {resolveDocLink} from "../web/documentation/docsApi";

describe("resolveDocLink", () => {
    const index = {path: "docs/workflow-components/flow", isIndex: true};

    it("keeps full urls external", () => {
        assert.deepStrictEqual(resolveDocLink("https://example.com/x", index), {external: "https://example.com/x"});
    });
    it("sends site-absolute links to kestra.io", () => {
        assert.deepStrictEqual(resolveDocLink("/blueprints", index), {external: "https://kestra.io/blueprints"});
    });
    it("resolves sibling links from an index page", () => {
        assert.deepStrictEqual(resolveDocLink("../02.namespace/index.md", index), {docPath: "docs/workflow-components/namespace"});
    });
    it("resolves sibling links from a leaf page through the parent", () => {
        assert.deepStrictEqual(resolveDocLink("./sub.md", {path: "docs/tutorial", isIndex: false}), {docPath: "docs/sub"});
    });
    it("strips ordering prefixes, index suffixes, and anchors", () => {
        assert.deepStrictEqual(resolveDocLink("../01.tasks/index.mdx#section", index), {docPath: "docs/workflow-components/tasks"});
    });
});
