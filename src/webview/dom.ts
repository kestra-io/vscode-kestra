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

