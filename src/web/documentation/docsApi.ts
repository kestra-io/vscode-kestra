import {kestraBaseUrl} from '../constants';

// Kestra's central docs service, the same source the core UI's docs tab reads.
// It is public: content is selected by the connected instance's version.

export type DocPage = {markdown: string; title: string; path: string; isIndex?: boolean};
export type DocSearchResult = {title: string; path: string};

type DocMetadata = {title?: string; parsedUrl?: string; isIndex?: boolean};

export function docByPath(version: string, path: string): Promise<DocPage | null> {
    return fetchPage(`${kestraBaseUrl}/docs/${path}/versions/${version}`, path);
}

export async function searchDocs(version: string, q: string): Promise<DocSearchResult[]> {
    const response = await fetch(`${kestraBaseUrl}/search/versions/${version}?q=${encodeURIComponent(q)}&type=DOCS`).catch(() => null);
    if (!response?.ok) {
        return [];
    }
    const body = (await response.json().catch(() => null)) as {results?: Array<{url: string; title: string}>} | null;
    return (body?.results ?? []).map(result => ({title: result.title, path: result.url}));
}

export type DocLink = {external: string} | {docPath: string};

// Resolves an href found inside a page, mirroring the core UI's useDocsLink.
export function resolveDocLink(href: string, page: {path: string; isIndex?: boolean}): DocLink {
    if (/^https?:\/\//.test(href)) {
        return {external: href};
    }
    // Site-absolute links target the kestra.io website.
    if (href.startsWith('/')) {
        return {external: `https://kestra.io${href}`};
    }
    let relative = normalizeDocsPath(href);
    // A non-index page lives beside its siblings, so its relative links resolve from the parent.
    if (page.isIndex === false) {
        relative = `../${relative}`;
    }
    const segments = page.path.split('/').filter(Boolean);
    for (const part of relative.split('/')) {
        if (part === '..') {
            segments.pop();
        } else if (part && part !== '.') {
            segments.push(part);
        }
    }
    return {docPath: segments.join('/')};
}

// Repo-relative markdown paths carry ordering prefixes ("03.flow") and file suffixes; canonical doc paths have neither.
function normalizeDocsPath(input: string): string {
    return input.replace(/(\/|^)\d+?\.(?!\d)/g, '$1').replace(/(?:\/index)?\.mdx?(#.+|$)/, '');
}

// Page metadata (title, canonical path) travels in a response header next to the raw markdown.
async function fetchPage(url: string, fallbackPath = ''): Promise<DocPage | null> {
    const response = await fetch(url).catch(() => null);
    if (!response?.ok) {
        return null;
    }
    const markdown = await response.text();
    let metadata: DocMetadata = {};
    try {
        metadata = JSON.parse(response.headers.get('x-kestra-metadata') ?? '{}') as DocMetadata;
    } catch {
        // Missing or malformed metadata only degrades the title and link resolution.
    }
    return {
        markdown,
        title: metadata.title ?? 'Documentation',
        path: metadata.parsedUrl ?? fallbackPath,
        isIndex: metadata.isIndex
    };
}
