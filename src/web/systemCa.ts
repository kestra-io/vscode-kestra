import {setHttpFetch} from "./http";

// Desktop build. Node's global fetch (undici) ignores the OS trust store, so an instance
// behind an internal or corporate CA fails even when the browser trusts it. Route requests
// through undici with the system CAs added, matching what the browser already trusts.
// No-op on Node without getCACertificates (< 22.15), where NODE_EXTRA_CA_CERTS is the fallback.
export async function configureSystemCa(): Promise<void> {
    const tls = await import("node:tls");
    // getCACertificates is newer than @types/node@20 declares, so read it through a narrow type.
    const getCACertificates = (tls as {getCACertificates?: (type?: string) => string[]}).getCACertificates;
    if (typeof getCACertificates !== "function") {
        return;
    }
    const undici = await import("undici");
    const ca = [...tls.rootCertificates, ...getCACertificates("system")];
    const dispatcher = new undici.Agent({connect: {ca}});
    setHttpFetch((input, init) => undici.fetch(input as Parameters<typeof undici.fetch>[0], {...init, dispatcher} as Parameters<typeof undici.fetch>[1]) as unknown as Promise<Response>);
}
