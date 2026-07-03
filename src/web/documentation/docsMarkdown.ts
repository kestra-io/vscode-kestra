import * as markdownIt from 'markdown-it';
const container = require('markdown-it-container');

// The docs are MDC-flavored markdown (::alert, ::collapse and other Vue components).
// Alerts and collapses map to plain HTML; unknown components keep their content, minus the fences.

const KNOWN_COMPONENTS = new Set(['alert', 'collapse']);
const FENCE_OPEN = /^(:{2,})([A-Za-z][\w-]*)(\{[^}]*\})?\s*$/;
const FENCE_CLOSE = /^(:{2,})\s*$/;

const md = new markdownIt({html: true, linkify: true, langPrefix: 'language-'})
    .use(container, 'alert', {
        validate: (params: string) => /^alert(\{|\s|$)/.test(params.trim()),
        render: (tokens: Array<{nesting: number; info: string}>, idx: number) => {
            if (tokens[idx].nesting === 1) {
                const type = /type="(info|warning|danger|success)"/.exec(tokens[idx].info)?.[1] ?? 'info';
                return `<div class="alert ${type}">\n`;
            }
            return '</div>\n';
        }
    })
    .use(container, 'collapse', {
        validate: (params: string) => /^collapse(\{|\s|$)/.test(params.trim()),
        render: (tokens: Array<{nesting: number; info: string}>, idx: number) => {
            if (tokens[idx].nesting === 1) {
                const title = /title="([^"]*)"/.exec(tokens[idx].info)?.[1] ?? 'Details';
                return `<details><summary>${md.utils.escapeHtml(title)}</summary>\n<div class="collapse-body">\n`;
            }
            return '</div></details>\n';
        }
    });

export function renderDocMarkdown(markdown: string): string {
    const html = md.render(normalizeMdc(stripFrontmatter(markdown)));
    return html
        // Embedded players cannot run under the webview CSP, so link out instead.
        .replace(/<iframe[^>]*\bsrc="(https?:[^"]*)"[\s\S]*?<\/iframe>/g, '<p><a class="video-link" href="$1">Watch the video</a></p>')
        .replace(/<iframe[\s\S]*?<\/iframe>/g, '')
        // Images with repository-relative paths have no reachable URL from here.
        .replace(/<img(?![^>]*\bsrc="https?:)[^>]*\/?>/g, '');
}

function stripFrontmatter(markdown: string): string {
    return markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
}

// Rewrites MDC component fences line by line, leaving fenced code blocks untouched.
function normalizeMdc(markdown: string): string {
    const out: string[] = [];
    const stack: boolean[] = [];
    let inCode = false;
    for (const line of markdown.split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) {
            inCode = !inCode;
            out.push(line);
            continue;
        }
        if (inCode) {
            out.push(line);
            continue;
        }
        // MDX article files can carry component imports; they are meaningless here.
        if (/^import\s.+\sfrom\s+['"].+['"];?\s*$/.test(line)) {
            continue;
        }
        const open = FENCE_OPEN.exec(line);
        if (open) {
            const kept = KNOWN_COMPONENTS.has(open[2]);
            stack.push(kept);
            if (kept) {
                out.push(`${open[1].padEnd(3, ':')}${open[2]}${open[3] ?? ''}`);
            }
            continue;
        }
        const close = FENCE_CLOSE.exec(line);
        if (close && stack.length > 0) {
            if (stack.pop()) {
                out.push(close[1].padEnd(3, ':'));
            }
            continue;
        }
        out.push(line);
    }
    return out.join('\n');
}
