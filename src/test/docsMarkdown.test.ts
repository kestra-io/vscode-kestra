import * as assert from "assert";
import {renderDocMarkdown} from "../web/documentation/docsMarkdown";

describe("renderDocMarkdown", () => {
    it("strips frontmatter", () => {
        const html = renderDocMarkdown("---\ntitle: X\n---\nBody");
        assert.ok(!html.includes("title: X"));
        assert.ok(html.includes("Body"));
    });
    it("renders alert components with their type", () => {
        const html = renderDocMarkdown('::alert{type="warning"}\ncareful\n::');
        assert.ok(html.includes('<div class="alert warning">'));
        assert.ok(html.includes("careful"));
    });
    it("renders collapse components as details with the title", () => {
        const html = renderDocMarkdown('::collapse{title="id"}\nThe identifier.\n::');
        assert.ok(html.includes("<summary>id</summary>"));
        assert.ok(html.includes("The identifier."));
    });
    it("drops unknown component fences but keeps their content", () => {
        const html = renderDocMarkdown("::ChildCard\ninner text\n::");
        assert.ok(!html.includes("ChildCard"));
        assert.ok(html.includes("inner text"));
    });
    it("leaves fences inside code blocks untouched", () => {
        const html = renderDocMarkdown('````md\n```yaml\na: 1\n```\n````\n\n::alert{type="info"}\nvisible\n::');
        assert.ok(html.includes('<div class="alert info">'));
        assert.ok(html.includes("```yaml"));
    });
    it("strips mdx imports outside code blocks only", () => {
        const html = renderDocMarkdown('import X from "y"\n\n```js\nimport Y from "z"\n```');
        assert.ok(!html.includes("import X"));
        assert.ok(html.includes("import Y"));
    });
    it("colors yaml keys, values, and comments", () => {
        const html = renderDocMarkdown("```yaml\n# note\ntype: x\n```");
        assert.ok(html.includes('<span class="hl-key">type</span>'));
        assert.ok(html.includes('<span class="hl-comment"># note</span>'));
    });
    it("replaces iframes with a link", () => {
        const html = renderDocMarkdown('<iframe src="https://example.com/v"></iframe>');
        assert.ok(!html.includes("<iframe"));
        assert.ok(html.includes('href="https://example.com/v"'));
    });
    it("drops images with repository-relative paths and keeps absolute ones", () => {
        const html = renderDocMarkdown("![a](./x.png)\n\n![b](https://kestra.io/x.png)");
        assert.strictEqual((html.match(/<img/g) ?? []).length, 1);
        assert.ok(html.includes("https://kestra.io/x.png"));
    });
});
