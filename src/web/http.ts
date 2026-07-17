// Single fetch seam for all Kestra requests. The desktop build swaps in a fetch that
// trusts the OS certificate store (see systemCa.ts); the web build keeps the browser
// fetch, which already uses it. Defaults to the platform fetch until configured.
let delegate: typeof fetch = (input, init) => fetch(input, init);

export function httpFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return delegate(input, init);
}

export function setHttpFetch(fetchImpl: typeof fetch): void {
    delegate = fetchImpl;
}
