export interface WebviewApi<T> {
    postMessage(message: T): void;
}

declare function acquireVsCodeApi(): WebviewApi<unknown>;

export function acquireApi<T>(): WebviewApi<T> {
    return acquireVsCodeApi() as WebviewApi<T>;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

// Material Design Icons (the set core uses), inlined because webviews cannot load the icon font.
const ICONS = {
    play: 'M8,5.14V19.14L19,12.14L8,5.14Z',
    copy: 'M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z',
    openInNew: 'M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z'
} as const;

export function icon(name: keyof typeof ICONS): string {
    return `<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
}
