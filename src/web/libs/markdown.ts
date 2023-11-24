import * as markdownIt from "markdown-it";
const mark = require("markdown-it-mark");
const meta = require("markdown-it-meta");
import anchor from "markdown-it-anchor";
const container = require("markdown-it-container");

export default class Markdown {
    static render(markdown: string, options?: any): string {
        options = options || {};

        let md = new markdownIt()
            .use(mark)
            .use(meta)
            .use(anchor, {
                permalink: options.permalink ? anchor.permalink.ariaHidden({
                    placement: "before"
                }) : undefined
            })
            .use(container, 'warning');

        md.set({
            html: true,
            xhtmlOut: true,
            breaks: true,
            linkify: true,
            typographer: true,
            langPrefix: "language-",
            quotes: "“”‘’",
        });

        md.renderer.rules.table_open = () => "<table class=\"table\">\n";

        return md.render(markdown);
    }
}