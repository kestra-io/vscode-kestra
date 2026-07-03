import {renderDocMarkdown} from './docsMarkdown';

// Schema-rendered plugin doc: header, intro, type line, then Examples, Properties, Outputs, and Definitions.

export type PluginProperty = {
    type?: string;
    title?: string;
    description?: string;
    $ref?: string;
    $required?: boolean;
    $deprecated?: boolean;
    default?: unknown;
    enum?: unknown[];
    items?: PluginProperty;
    anyOf?: PluginProperty[];
    oneOf?: PluginProperty[];
    allOf?: PluginProperty[];
};

type PluginExample = {title?: string; code?: string; lang?: string; full?: boolean};
type PluginDefinitionEntry = {title?: string; description?: string; properties?: Record<string, PluginProperty>};

export type PluginSchema = {
    properties?: {
        title?: string;
        description?: string;
        $beta?: boolean;
        $examples?: PluginExample[];
        properties?: Record<string, PluginProperty>;
    };
    outputs?: {properties?: Record<string, PluginProperty>};
    definitions?: Record<string, PluginDefinitionEntry>;
};

export type PluginDefinition = {markdown?: string; schema?: PluginSchema};

// One row from GET /plugins/groups/subgroups: a plugin (subGroup null) or one of its subgroups.
export type PluginElement = {cls: string; title?: string; deprecated?: boolean};
export type PluginEntry = {
    name?: string;
    title?: string;
    group?: string;
    subGroup?: string | null;
    tasks?: PluginElement[];
    triggers?: PluginElement[];
    conditions?: PluginElement[];
};

export type IconResolver = (key: string) => string | undefined;

export function pluginElements(entry: PluginEntry): PluginElement[] {
    return [...(entry.tasks ?? []), ...(entry.triggers ?? []), ...(entry.conditions ?? [])].filter(element => !element.deprecated);
}

export function renderPluginList(entries: PluginEntry[], icon: IconResolver): string {
    const roots = entries.filter(entry => !entry.subGroup).sort(byTitle);
    return roots.map(entry => navRow(`group:${entry.name}`, icon(entry.group ?? ''), entry.title ?? entry.name ?? '')).join('');
}

export function renderGroupPage(root: PluginEntry, subs: PluginEntry[], icon: IconResolver): string {
    const header = pageHeader(icon(root.group ?? ''), root.title ?? root.name ?? '');
    const rows = subs.sort(byTitle).map(sub => navRow(`sub:${sub.subGroup}`, icon(sub.subGroup ?? ''), sub.title ?? '')).join('');
    return header + rows;
}

export function renderSubPage(sub: PluginEntry, icon: IconResolver): string {
    const header = pageHeader(icon(sub.subGroup ?? ''), sub.title ?? '');
    const rows = pluginElements(sub)
        .sort((a, b) => a.cls.localeCompare(b.cls))
        .map(element => navRow(`type:${element.cls}`, icon(element.cls), element.cls.split('.').pop() ?? element.cls, element.title))
        .join('');
    return header + rows;
}

function byTitle(a: PluginEntry, b: PluginEntry): number {
    return (a.title ?? '').localeCompare(b.title ?? '');
}

function pageHeader(icon: string | undefined, title: string): string {
    return `<div class="plugin-header">${icon ? `<img class="plugin-icon" src="${esc(icon)}" alt="">` : ''}<span class="plugin-name">${esc(title)}</span></div>`;
}

function navRow(nav: string, icon: string | undefined, label: string, subtitle?: string): string {
    return `<button class="nav-row" data-nav="${esc(nav)}">`
        + (icon ? `<img class="row-icon" src="${esc(icon)}" alt="">` : '<span class="row-icon"></span>')
        + `<span class="row-label">${esc(label)}${subtitle ? `<span class="row-sub">${esc(subtitle)}</span>` : ''}</span>`
        + '<span class="chev">›</span></button>';
}

const BETA_NOTICE = 'This plugin is currently in beta. While it is considered safe for use, please be aware that its API could change in ways that are not compatible with earlier versions in future releases, or it might become unsupported.';

export function renderPluginDoc(type: string, schema: PluginSchema, icon?: string): string {
    const meta = schema.properties ?? {};
    const name = type.split('.').pop() ?? type;
    const release = releaseNotesUrl(type);
    const parts = [
        '<div class="plugin-header">'
            + (icon ? `<img class="plugin-icon" src="${esc(icon)}" alt="">` : '')
            + `<span class="plugin-name">${esc(name)}</span>`
            + (release ? `<a class="release-notes" href="${esc(release)}">Release notes</a>` : '')
            + '</div>'
    ];
    if (meta.$beta) {
        parts.push(`<div class="alert warning"><p>${BETA_NOTICE}</p></div>`);
    }
    if (meta.title) {
        parts.push(`<div class="plugin-intro">${renderDocMarkdown(meta.title)}</div>`);
    }
    if (meta.description) {
        parts.push(`<div class="plugin-intro">${renderDocMarkdown(meta.description)}</div>`);
    }
    parts.push(renderDocMarkdown('```yaml\ntype: ' + type + '\n```'));

    if (meta.$examples?.length) {
        parts.push(section('Examples', meta.$examples.map(example => renderExample(type, example)).join('<hr>')));
    }
    parts.push(
        section('Properties', propertyList(meta.properties)),
        section('Outputs', propertyList(schema.outputs?.properties)),
        section('Definitions', definitionList(schema.definitions))
    );
    return parts.filter(Boolean).join('\n');
}

// The release notes repository derives from the plugin class.
function releaseNotesUrl(type: string): string | null {
    const [, , groupId, pluginType] = type.split('.');
    if (!pluginType || pluginType === 'ee' || pluginType === 'secret') {
        return null;
    }
    if (pluginType === 'core') {
        return 'https://github.com/kestra-io/kestra/releases';
    }
    return `https://github.com/kestra-io/${groupId === 'storage' ? 'storage' : 'plugin'}-${pluginType}/releases`;
}

function section(title: string, inner: string): string {
    return inner ? `<details class="section"><summary>${title}</summary><div class="section-body">${inner}</div></details>` : '';
}

// Partial examples get the id/type preamble.
function renderExample(type: string, example: PluginExample): string {
    if (!example.code) {
        return '';
    }
    const code = example.full ? example.code : `id: ${(type.split('.').pop() ?? '').toLowerCase()}\ntype: ${type}\n${example.code}`;
    const title = example.title ? renderDocMarkdown(example.title) : '';
    return `${title}${renderDocMarkdown('```' + (example.lang ?? 'yaml') + '\n' + code + '\n```')}`;
}

function propertyList(properties: Record<string, PluginProperty> | undefined): string {
    const entries = Object.entries(properties ?? {})
        .filter(([key]) => !key.startsWith('$'))
        .map(([key, property]): [string, PluginProperty] => [key, aggregateAllOf(property)])
        .filter(([, property]) => !property.$deprecated);
    const byKey = ([a]: [string, PluginProperty], [b]: [string, PluginProperty]) => a.localeCompare(b);
    const required = entries.filter(([, property]) => property.$required).sort(byKey);
    const optional = entries.filter(([, property]) => !property.$required).sort(byKey);
    return [...required, ...optional].map(propertyRow).join('');
}

// Schemas express many properties as allOf members, flatten them so type, required, and description surface.
function aggregateAllOf(property: PluginProperty): PluginProperty {
    if (!property.allOf) {
        return property;
    }
    const {allOf, ...rest} = property;
    return Object.assign({}, ...allOf, rest);
}

function propertyRow([key, property]: [string, PluginProperty]): string {
    const badges = typeNames(property).map(name => `<span class="type-box">${esc(name)}</span>`).join('');
    const body: string[] = [];
    if (property.title) {
        body.push(renderDocMarkdown(`**${property.title}**`));
    }
    if (property.description) {
        body.push(renderDocMarkdown(property.description));
    }
    if (property.default !== undefined) {
        body.push(`<p>Default: <code>${esc(plain(property.default))}</code></p>`);
    }
    if (property.enum) {
        body.push(`<p>Possible values: ${property.enum.map(value => `<code>${esc(plain(value))}</code>`).join(' ')}</p>`);
    }
    return `<details class="prop"><summary><code>${esc(key)}</code>${property.$required ? '<span class="req">*</span>' : ''}`
        + `<span class="spacer"></span>${badges}</summary>`
        + `<div class="prop-body">${body.join('') || '<p class="muted">No description.</p>'}</div></details>`;
}

function definitionList(definitions: Record<string, PluginDefinitionEntry> | undefined): string {
    return Object.entries(definitions ?? {}).map(([key, definition]) => {
        const name = key.split('_')[0].split('.').pop() ?? key;
        const body = [
            definition.title ? renderDocMarkdown(`**${definition.title}**`) : '',
            definition.description ? renderDocMarkdown(definition.description) : '',
            propertyList(definition.properties)
        ].join('');
        return `<details class="prop"><summary><code>${esc(name)}</code></summary>`
            + `<div class="prop-body">${body || '<p class="muted">No description.</p>'}</div></details>`;
    }).join('');
}

function typeNames(property: PluginProperty): string[] {
    if (property.$ref) {
        return [property.$ref.split('/').pop()?.split('_')[0].split('.').pop() ?? 'object'];
    }
    const variants = property.anyOf ?? property.oneOf ?? property.allOf;
    if (variants) {
        return [...new Set(variants.flatMap(typeNames))];
    }
    if (property.type === 'array') {
        return [`array of ${typeNames(property.items ?? {}).join(' | ') || 'object'}`];
    }
    return property.type ? [property.type] : ['object'];
}

function plain(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
