import * as assert from "assert";
import {PluginSchema, renderPluginDoc} from "../web/documentation/pluginDoc";

const TYPE = "io.kestra.plugin.core.log.Log";

function render(schema: PluginSchema): string {
    return renderPluginDoc(TYPE, schema);
}

describe("renderPluginDoc", () => {
    it("renders the header with the class name and release notes link", () => {
        const html = render({properties: {}});
        assert.ok(html.includes('<span class="plugin-name">Log</span>'));
        assert.ok(html.includes('href="https://github.com/kestra-io/kestra/releases"'));
    });
    it("derives the release repository from non-core plugin classes", () => {
        const html = renderPluginDoc("io.kestra.plugin.aws.s3.Upload", {properties: {}});
        assert.ok(html.includes("github.com/kestra-io/plugin-aws/releases"));
    });
    it("omits the release notes link for ee plugins", () => {
        const html = renderPluginDoc("io.kestra.plugin.ee.assets.AssetShipper", {properties: {}});
        assert.ok(!html.includes("release-notes"));
    });
    it("prefixes partial examples with the id and type preamble", () => {
        // The base doc has no id line, so a highlighted id key can only come from the prepended preamble.
        const html = render({properties: {$examples: [{code: "message: hi"}]}});
        assert.ok(html.includes('<span class="hl-key">id</span>'));
        assert.ok(html.includes('<span class="hl-key">message</span>'));
    });
    it("keeps full examples untouched", () => {
        const html = render({properties: {$examples: [{code: "level: DEBUG", full: true}]}});
        assert.ok(html.includes('<span class="hl-key">level</span>'));
        assert.ok(!html.includes('<span class="hl-key">id</span>'));
    });
    it("sorts required properties first and stars them", () => {
        const html = render({properties: {properties: {zeta: {type: "string", $required: true}, alpha: {type: "string"}}}});
        assert.ok(html.indexOf("zeta") < html.indexOf("alpha"));
        assert.strictEqual((html.match(/class="req"/g) ?? []).length, 1);
    });
    it("flattens allOf so the type, required flag, and description surface", () => {
        const html = render({properties: {properties: {
            level: {allOf: [{type: "string", $required: true}, {description: "Log level."}]}
        }}});
        assert.ok(html.includes('<span class="type-box">string</span>'));
        assert.ok(html.includes('class="req"'));
        assert.ok(html.includes("Log level."));
    });
    it("hides deprecated properties", () => {
        const html = render({properties: {properties: {old: {type: "string", $deprecated: true}}}});
        assert.ok(!html.includes("old"));
    });
    it("renders ref types by their class name", () => {
        const html = render({properties: {properties: {cpu: {$ref: "#/definitions/io.kestra.core.models.tasks.Cpu"}}}});
        assert.ok(html.includes('<span class="type-box">Cpu</span>'));
    });
    it("names definitions by class, keeping the title in the body", () => {
        const html = render({
            properties: {},
            definitions: {"io.kestra.core.models.Credentials_1": {title: "Credentials for a registry.", properties: {}}}
        });
        assert.ok(html.includes("<code>Credentials</code>"));
        assert.ok(html.includes("Credentials for a registry."));
    });
    it("escapes html in attribute and text positions", () => {
        const html = render({properties: {properties: {'x"><img': {type: 'a"b'}}}});
        assert.ok(!html.includes('"><img'));
    });
});
