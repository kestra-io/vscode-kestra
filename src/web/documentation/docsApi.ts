import {kestraBaseUrl} from '../constants';
import {httpFetch} from '../http';

// Kestra's central docs service: public, content selected by the connected instance's version.

export type DocPage = {markdown: string; title: string; path: string; isIndex?: boolean};
export type DocSearchResult = {title: string; path: string};

type DocMetadata = {title?: string; parsedUrl?: string; isIndex?: boolean};

const FETCH_TIMEOUT_MS = 15000;

function fetchWithTimeout(url: string): Promise<Response> {
    return httpFetch(url, {signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)});
}

export function docByPath(version: string, path: string): Promise<DocPage | null> {
    return fetchPage(`${kestraBaseUrl}/docs/${path}/versions/${version}`, path);
}

export async function searchDocs(version: string, q: string): Promise<DocSearchResult[]> {
    const response = await fetchWithTimeout(`${kestraBaseUrl}/search/versions/${version}?q=${encodeURIComponent(q)}&type=DOCS`).catch(() => null);
    if (!response?.ok) {
        return [];
    }
    const body = (await response.json().catch(() => null)) as {results?: Array<{url: string; title: string}>} | null;
    return (body?.results ?? []).map(result => ({title: result.title, path: result.url}));
}

export type DocLink = {external: string} | {docPath: string};

export function resolveDocLink(href: string, page: {path: string; isIndex?: boolean}): DocLink {
    if (/^https?:\/\//.test(href)) {
        return {external: href};
    }
    if (href.startsWith('/')) {
        return {external: `https://kestra.io${href}`};
    }
    let relative = normalizeDocsPath(href);
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

function normalizeDocsPath(input: string): string {
    return input.replace(/(\/|^)\d+?\.(?!\d)/g, '$1').replace(/(?:\/index)?\.mdx?(#.+|$)/, '');
}

// Page metadata (title, canonical path) travels in a response header next to the raw markdown.
async function fetchPage(url: string, fallbackPath = ''): Promise<DocPage | null> {
    const response = await fetchWithTimeout(url).catch(() => null);
    if (!response?.ok) {
        return null;
    }
    const markdown = await response.text();
    let metadata: DocMetadata = {};
    try {
        metadata = JSON.parse(response.headers.get('x-kestra-metadata') ?? '{}') as DocMetadata;
    } catch {
        metadata = {};
    }
    return {
        markdown,
        title: metadata.title ?? 'Documentation',
        path: metadata.parsedUrl ?? fallbackPath,
        isIndex: metadata.isIndex
    };
}
