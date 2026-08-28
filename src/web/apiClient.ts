// apiClient.ts
import * as vscode from 'vscode';
import { kestraBaseUrl, secretStorageKey, yamlContentType, PebbleFunctionDef } from "./constants";
import { FlowGraph } from "../shared/flow";
import type { PluginDefinition, PluginEntry } from "./documentation/pluginDoc";
import { logWarn } from "./log";
import type { KestraInstance } from "./instanceUri";

export default class ApiClient {
    private readonly _secretStorage: vscode.SecretStorage;

    // A namespace folder is virtual and has no settings of its own, so the window is pinned to the
    // instance it was opened from. The pin wins over settings for the whole window.
    private static pinnedInstance: KestraInstance | undefined;

    public constructor(secretStorage: vscode.SecretStorage) {
        this._secretStorage = secretStorage;
    }

    public static pinInstance(instance: KestraInstance): void {
        ApiClient.pinnedInstance = instance;
    }

    // The instance this window talks to, with the url exactly as configured (not normalized).
    public static currentInstance(): KestraInstance {
        if (ApiClient.pinnedInstance) {
            return ApiClient.pinnedInstance;
        }
        const config = vscode.workspace.getConfiguration("kestra.api");
        return {url: (config.get("url") as string) || "", tenant: (config.get("tenant") as string) || ""};
    }

    public static isPinned(): boolean {
        return ApiClient.pinnedInstance !== undefined;
    }

    public async signIn(): Promise<void> {
        const basic = "Basic auth", apiToken = "API token (EE)", jwt = "JWT token (legacy)";
        const choice = await vscode.window.showQuickPick([basic, apiToken, jwt], {placeHolder: "Select how to authenticate to Kestra"});
        if (!choice) {
            return;
        }

        if (choice === basic) {
            const username = await vscode.window.showInputBox({prompt: "Username"});
            if (!username?.trim()) {
                return;
            }
            const password = await vscode.window.showInputBox({prompt: "Password", password: true});
            if (!password?.trim()) {
                return;
            }
            await this.clearSecrets();
            await this._secretStorage.store(this.secretKey(secretStorageKey.username), username.trim());
            await this._secretStorage.store(this.secretKey(secretStorageKey.password), password.trim());
        } else {
            const token = await vscode.window.showInputBox({prompt: choice === apiToken ? "Kestra API token" : "JWT token", password: true});
            if (!token?.trim()) {
                return;
            }
            await this.clearSecrets();
            await this._secretStorage.store(this.secretKey(choice === apiToken ? secretStorageKey.apiToken : secretStorageKey.token), token.trim());
        }

        const result = await this.verifyCredentials();
        if (result.status === "unauthorized") {
            await this.clearSecrets();
            vscode.window.showErrorMessage("Sign in failed: invalid credentials");
        } else if (result.status === "unreachable") {
            vscode.window.showWarningMessage(`Could not reach Kestra${result.detail ? `: ${result.detail}` : ""}. Check the URL and that the instance is running.`);
        } else {
            vscode.window.showInformationMessage("Signed in to Kestra");
        }
    }

    // GET /configs is the lightweight authenticated endpoint the Kestra UI itself uses to validate a login.
    // Fetches directly (not via silentFetch) so the thrown cause is surfaced instead of a blanket "unreachable".
    public async verifyCredentials(): Promise<{status: "ok" | "unauthorized" | "unreachable", detail?: string}> {
        if (!ApiClient.currentInstance().url) {
            return {status: "unreachable", detail: "no kestra.api.url configured"};
        }
        try {
            const base = await ApiClient.getKestraApiUrl(false, false);
            const authHeaders = await this.storedAuthHeaders();
            const response = await ApiClient.fetchWithTimeout(`${base}/configs`, {headers: authHeaders ?? {}});
            return {status: response.status === 401 ? "unauthorized" : "ok"};
        } catch (error) {
            const cause = (error as {cause?: {code?: string, message?: string}})?.cause;
            return {status: "unreachable", detail: cause?.code ?? cause?.message};
        }
    }

    public async signOut(): Promise<void> {
        await this.clearSecrets();
        vscode.window.showInformationMessage("Signed out of Kestra");
    }

    private async clearSecrets(): Promise<void> {
        for (const key of Object.values(secretStorageKey)) {
            await this._secretStorage.delete(this.secretKey(key));
            await this._secretStorage.delete(key);
        }
    }

    public static async getKestraApiUrl(forceInput: boolean = false, includeTenant: boolean = true): Promise<string> {
        const kestraConfigUrl = ApiClient.currentInstance().url;
        let finalUrl = this.formatApiUrl(kestraConfigUrl);

        // A pinned window is bound to one instance, so asking for a url there would be a no-op.
        if (vscode.env.uiKind !== vscode.UIKind.Web && !ApiClient.pinnedInstance && (!kestraConfigUrl || forceInput)) {
            const kestraInputUrl = await vscode.window.showInputBox({
                prompt: "Kestra instance URL",
                value: kestraConfigUrl || kestraBaseUrl
            });

            if (!kestraInputUrl?.trim()) {
                vscode.window.showErrorMessage("A Kestra instance URL is required.");
                return "";
            }

            finalUrl = this.formatApiUrl(kestraInputUrl.trim());

            // url was updated, we must save it to config. A settings file that cannot be written is
            // worth reporting, but the caller still has the url it asked for, so it is not fatal.
            if (kestraConfigUrl !== finalUrl) {
                try {
                    await vscode.workspace.getConfiguration('kestra.api').update('url', finalUrl, this.urlTarget());
                } catch (error) {
                    logWarn(`Could not save kestra.api.url: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }

        return includeTenant ? this.withTenant(finalUrl) : finalUrl;
    }

    // The answer goes back to the scope the url already lives in, so replying to the prompt in a
    // folder that configures its own instance does not change every other workspace.
    private static urlTarget(): vscode.ConfigurationTarget {
        const scopes = vscode.workspace.getConfiguration("kestra.api").inspect<string>("url");
        return scopes?.workspaceValue !== undefined
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
    }

    private static withTenant(url: string): string {
        const tenant = ApiClient.currentInstance().tenant;
        if (!url || !tenant) {
            return url;
        }
        return url.includes("/api/v1") ? url.replace("/api/v1", `/api/v1/${tenant}`) : `${url}/${tenant}`;
    }

    public static async executionUiUrl(namespace: string, flowId: string, executionId: string): Promise<string> {
        const webUrl = (await this.getKestraApiUrl()).split("/api/v1")[0];
        const tenant = ApiClient.currentInstance().tenant || "main";
        return `${webUrl}/ui/${tenant}/executions/${namespace}/${flowId}/${executionId}`;
    }

    private static formatApiUrl(kestraUrl?: string) {
        if (!kestraUrl) {
            return "";
        }
        if (kestraUrl.endsWith("/")) {
            kestraUrl = kestraUrl.substring(0, kestraUrl.length - 1);
        }
        if (kestraUrl !== kestraBaseUrl && !kestraUrl.includes("/api/v1")) {
            kestraUrl += "/api/v1";
        }

        return kestraUrl;
    }

    // SecretStorage is global to the extension, so scope credentials to the instance URL.
    private secretKey(base: string): string {
        const url = ApiClient.currentInstance().url;
        return url ? `${base}::${url}` : base;
    }

    private async getSecret(base: string): Promise<string | undefined> {
        const key = this.secretKey(base);
        const scoped = await this._secretStorage.get(key);
        if (scoped !== undefined || key === base) {
            return scoped;
        }
        const legacy = await this._secretStorage.get(base);
        if (legacy !== undefined) {
            await this._secretStorage.store(key, legacy);
            await this._secretStorage.delete(base);
        }
        return legacy;
    }

    // True when a credential is stored, used to tell "never signed in" apart from an authenticated-but-denied 401.
    public async hasStoredCredentials(): Promise<boolean> {
        return (await this.storedAuthHeaders()) !== undefined;
    }

    private async storedAuthHeaders(): Promise<Record<string, string> | undefined> {
        const apiToken = await this.getSecret(secretStorageKey.apiToken);
        if (apiToken) {
            return this.bearerHeader(apiToken);
        }
        const jwtToken = await this.getSecret(secretStorageKey.token);
        if (jwtToken) {
            return {cookie: `JWT=${jwtToken}`};
        }
        const username = await this.getSecret(secretStorageKey.username);
        const password = await this.getSecret(secretStorageKey.password);
        return this.basicAuthHeader(username, password);
    }

    private bearerHeader(token: string) {
        return {"Authorization": `Bearer ${token}`};
    }

    // ignoreCodes allows to ignore some http codes, like 404 for the tasks documentation
    public async apiCall(url: string, errorMessage: string, ignoreCodes: number[] = [], options?: RequestInit): Promise<Response> {
        try {
            const authHeaders = await this.storedAuthHeaders();
            let response = authHeaders ?
                await fetch(url,
                    {
                        ...options,
                        headers: {
                            ...options?.headers,
                            ...authHeaders
                        }
                    }) :
                await fetch(url, options);

            if (!response.ok) {
                const newResponse = await this.handleFetchError(response, url, errorMessage, ignoreCodes, options);
                if (newResponse) {
                    return newResponse;
                }
            }
            return response;
        } catch (error) {
            let origin: string | undefined;
            try {
                origin = new URL(url).origin;
            } catch {
                origin = undefined;
            }
            vscode.window.showErrorMessage(
                origin
                    ? `Cannot reach Kestra at ${origin}. Check that the instance is running and that kestra.api.url is correct.`
                    : `No valid Kestra URL configured. Set "kestra.api.url" in settings (current value: "${url}").`
            );
            throw error;
        }
    }

    public async fileApi(namespace: string, suffix?: string, options?: RequestInit): Promise<Response> {
        const fetchResponse = await this.apiCall(`${await ApiClient.getKestraApiUrl()}/namespaces/${namespace}/files${suffix ?? ""}`, "Error while fetching Kestra's file API:", [404], options);
        if (fetchResponse.status === 404) {
            throw vscode.FileSystemError.FileNotFound(suffix);
        }
        return fetchResponse;
    }

    public async flowsApi(suffix?: string, options?: RequestInit): Promise<Response> {
        const fetchResponse = await this.apiCall(`${await ApiClient.getKestraApiUrl()}/flows${suffix ?? ""}`, "Error while fetching Kestra's flow API:", [404], options);
        if (fetchResponse.status === 404) {
            throw vscode.FileSystemError.FileNotFound(suffix);
        }
        return fetchResponse;
    }

    public async executionsApi(suffix?: string, options?: RequestInit): Promise<Response> {
        return this.apiCall(`${await ApiClient.getKestraApiUrl()}/executions${suffix ?? ""}`, "Error while calling Kestra's execution API:", [], options);
    }

    public async logsApi(suffix?: string, options?: RequestInit): Promise<Response> {
        return this.apiCall(`${await ApiClient.getKestraApiUrl()}/logs${suffix ?? ""}`, "Error while calling Kestra's logs API:", [], options);
    }

    public async validateFlow(source: string): Promise<Response> {
        return this.apiCall(`${await ApiClient.getKestraApiUrl()}/flows/validate`, "Error while validating flow:", [], {
            method: "POST",
            body: source,
            headers: {
                "Content-Type": yamlContentType
            }
        });
    }

    public async validateFlowSilent(source: string, signal?: AbortSignal): Promise<Response | null> {
        const response = await this.silentFetch("/flows/validate", {
            method: "POST",
            body: source,
            signal,
            headers: {"Content-Type": yamlContentType}
        });
        return response?.ok ? response : null;
    }

    public async pebbleFilters(): Promise<string[] | null> {
        const response = await this.silentFetch("/pebble/filters", {}, false);
        return response?.ok ? (await response.json().catch(() => null)) as string[] | null : null;
    }

    public async pebbleFunctions(): Promise<Array<string | PebbleFunctionDef> | null> {
        const response = await this.silentFetch("/pebble/functions", {}, false);
        return response?.ok ? (await response.json().catch(() => null)) as Array<string | PebbleFunctionDef> | null : null;
    }

    // Generates the topology graph for a flow source, without saving the flow.
    public async flowGraph(source: string): Promise<FlowGraph | null> {
        const response = await this.silentFetch("/flows/graph", {
            method: "POST",
            body: source,
            headers: {"Content-Type": yamlContentType}
        });
        return response?.ok ? (await response.json().catch(() => null)) as FlowGraph | null : null;
    }

    // Existing namespaces on the instance, to populate the "Open namespace" picker. Paged through in
    // full so instances with more than one page are not silently truncated.
    public async listNamespaces(): Promise<string[]> {
        const size = 200;
        const maxPages = 50;
        const ids: string[] = [];
        let page = 1;
        for (; page <= maxPages; page++) {
            const response = await this.silentFetch(`/namespaces/search?existing=true&size=${size}&page=${page}&sort=id%3Aasc`);
            if (!response?.ok) {
                logWarn(`Namespace list request failed on page ${page}${response ? ` (HTTP ${response.status})` : ''}; showing the ${ids.length} loaded so far.`);
                return ids;
            }
            const body = (await response.json().catch(() => null)) as {results?: Array<{id?: string}>; total?: number} | null;
            const results = body?.results ?? [];
            ids.push(...results.map(r => r.id).filter((id): id is string => !!id));
            if (results.length < size || (body?.total !== undefined && ids.length >= body.total)) {
                return ids;
            }
        }
        logWarn(`Namespace list truncated at ${ids.length}; type the name directly if it is not shown.`);
        return ids;
    }

    // Whether the namespace exists. null when it can't be checked, so callers fall back to the files probe.
    public async namespaceExists(namespace: string): Promise<boolean | null> {
        const response = await this.silentFetch(`/namespaces/search?q=${encodeURIComponent(namespace)}&existing=true&size=200`);
        if (!response?.ok) {
            return null;
        }
        const body = (await response.json().catch(() => null)) as {results?: Array<{id?: string}>} | null;
        return (body?.results ?? []).some(r => r.id === namespace);
    }

    // Uploads one file and returns the raw response (null if unreachable). The caller reports errors,
    // so a batch sync can summarize instead of toasting per file. Path segments are encoded individually.
    public async uploadNamespaceFile(namespace: string, path: string, content: Uint8Array, signal?: AbortSignal): Promise<Response | null> {
        const base = await ApiClient.getKestraApiUrl();
        if (!base) {
            return null;
        }
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        const form = new FormData();
        form.append("fileContent", new Blob([content]));
        const authHeaders = await this.storedAuthHeaders();
        try {
            return await fetch(`${base}/namespaces/${encodeURIComponent(namespace)}/files?path=${encodedPath}`, {method: "POST", body: form, headers: {...(authHeaders ?? {})}, signal});
        } catch {
            return null;
        }
    }

    // Checks a namespace is usable before opening it, so a bad URL, tenant, permission, or typo errors clearly.
    public async namespaceFilesReachable(namespace: string): Promise<{ok: boolean; status?: number; detail?: string}> {
        // A nonexistent namespace returns 200 here and auto-creates an empty dir, so reject typos first.
        if ((await this.namespaceExists(namespace)) === false) {
            return {ok: false, status: 404};
        }
        const response = await this.silentFetch(`/namespaces/${encodeURIComponent(namespace)}/files/directory?path=/`);
        if (!response) {
            return {ok: false, detail: "the instance is not reachable, or you are not signed in"};
        }
        if (response.ok) {
            return {ok: true};
        }
        const detail = ((await response.json().catch(() => null)) as {message?: string} | null)?.message;
        return {ok: false, status: response.status, detail};
    }

    // The instance version selects the matching docs content.
    public async instanceVersion(): Promise<string | null> {
        const response = await this.silentFetch("/configs", {}, false);
        return response?.ok ? ((await response.json().catch(() => null)) as {version?: string} | null)?.version ?? null : null;
    }

    // Schema and markdown from the instance, the public registry covers the no-instance case.
    public async pluginDefinition(type: string): Promise<PluginDefinition | null> {
        const response = await this.silentFetch(`/plugins/${encodeURIComponent(type)}`, {}, false)
            ?? await ApiClient.fetchWithTimeout(`${kestraBaseUrl}/plugins/definitions/${encodeURIComponent(type)}`, {}).catch(() => null);
        return response?.ok ? (await response.json().catch(() => null)) as PluginDefinition | null : null;
    }

    // One entry per plugin plus one per subgroup.
    public async pluginSubgroups(): Promise<PluginEntry[] | null> {
        const response = await this.silentFetch("/plugins/groups/subgroups", {}, false);
        return response?.ok ? (await response.json().catch(() => null)) as PluginEntry[] | null : null;
    }

    // Base64 SVG icons for plugin groups and subgroups, keyed by package id.
    public async pluginGroupIcons(): Promise<Record<string, {icon?: string}> | null> {
        const response = await this.silentFetch("/plugins/icons/groups", {}, false);
        return response?.ok ? (await response.json().catch(() => null)) as Record<string, {icon?: string}> | null : null;
    }

    // Base64 SVG icons per plugin type. The icons endpoint is not tenant-scoped.
    public async pluginIcons(): Promise<Record<string, {icon?: string}> | null> {
        const response = await this.silentFetch("/plugins/icons", {}, false);
        return response?.ok ? (await response.json().catch(() => null)) as Record<string, {icon?: string}> | null : null;
    }

    // Output property names for a task type, as the UI completes `outputs.<taskId>.`. Null if unknown.
    public async taskOutputProperties(type: string): Promise<string[] | null> {
        // The plugins endpoint is not tenant-scoped.
        const response = await this.silentFetch(`/plugins/${type}`, {}, false);
        if (!response?.ok) {
            return null;
        }
        const doc = (await response.json().catch(() => null)) as {schema?: {outputs?: {properties?: Record<string, unknown>}}} | null;
        return Object.keys(doc?.schema?.outputs?.properties ?? {});
    }

    private async silentFetch(suffix: string, options: RequestInit = {}, includeTenant: boolean = true): Promise<Response | null> {
        if (!ApiClient.currentInstance().url) {
            return null;
        }
        try {
            const base = await ApiClient.getKestraApiUrl(false, includeTenant);
            const authHeaders = await this.storedAuthHeaders();
            return await ApiClient.fetchWithTimeout(`${base}${suffix}`, {
                ...options,
                headers: {...(authHeaders ?? {}), ...(options.headers ?? {})}
            });
        } catch {
            return null;
        }
    }

    private static async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 15000): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const external = options.signal;
        if (external) {
            if (external.aborted) {
                controller.abort();
            } else {
                external.addEventListener("abort", () => controller.abort(), {once: true});
            }
        }
        try {
            return await fetch(url, {...options, signal: controller.signal});
        } finally {
            clearTimeout(timer);
        }
    }

    // Update first, a 404 means the flow does not exist yet, so create it.
    public async upsertFlow(namespace: string, id: string, source: string): Promise<Response> {
        const base = await ApiClient.getKestraApiUrl();
        const headers = {
            "Content-Type": yamlContentType
        };

        const updated = await this.apiCall(`${base}/flows/${namespace}/${id}`, "Error while updating flow:", [404], {method: "PUT", body: source, headers});
        if (updated.status === 404) {
            return this.apiCall(`${base}/flows`, "Error while creating flow:", [], {method: "POST", body: source, headers});
        }
        return updated;
    }

    private static originOf(url: string): string {
        try {
            return new URL(url).origin;
        } catch {
            return url;
        }
    }

    private async handleFetchError(response: Response, url: string, errorMessage: string, ignoreCodes: number[] = [], options?: RequestInit) {
        if (response.status === 401) {
            vscode.window.showInformationMessage(`${ApiClient.originOf(url)} requires authentication.`);
            try {
                let newResponse = await this.askCredentialsAndFetch(url, options);

                if (newResponse.status >= 400 && !ignoreCodes.includes(newResponse.status)) {
                    vscode.window.showErrorMessage(`${errorMessage} ${newResponse.statusText}`);
                    return;
                }
                return newResponse;
            } catch (e) {
                if (e instanceof Error) {
                    vscode.window.showErrorMessage(e.message);
                }
            }
        }

        if (response.status >= 400 && !ignoreCodes.includes(response.status)) {
            vscode.window.showErrorMessage(`${errorMessage} ${response.statusText}`);
            return;
        }

        return response;
    }

    private basicAuthHeader(username: string | undefined, password: string | undefined) {
        return username && password ? {
            "Authorization": `Basic ${btoa(username + ':' + password)}`
        } : undefined;
    }

    private async askCredentialsAndFetch(url: string, options?: RequestInit): Promise<Response> {
        try {
            const storedUsername = await this.getSecret(secretStorageKey.username);
            const storedPassword = await this.getSecret(secretStorageKey.password);

            let username = storedUsername;
            let password = storedPassword;

            if (!storedUsername || !storedPassword) {
                username = await vscode.window.showInputBox({
                    prompt: `Username for ${ApiClient.originOf(url)} (press Escape to use a token instead)`,
                    value: storedUsername || ""
                });

                if (username !== undefined && username.trim()) {
                    password = await vscode.window.showInputBox({
                        prompt: "Password",
                        password: true,
                        value: storedPassword || ""
                    });
                }
            }

            if (username && username.trim() && password && password.trim()) {
                const basicAuthResponse = await fetch(url, {
                    ...options,
                    headers: {
                        ...options?.headers,
                        ...this.basicAuthHeader(username.trim(), password.trim())
                    }
                });

                if (basicAuthResponse.status === 401) {
                    vscode.window.showWarningMessage("Invalid credentials. Try a token instead.");
                } else {
                    await this._secretStorage.store(this.secretKey(secretStorageKey.username), username.trim());
                    await this._secretStorage.store(this.secretKey(secretStorageKey.password), password.trim());
                    if (basicAuthResponse.ok) {
                        vscode.window.showInformationMessage("Signed in to Kestra");
                    }
                    return basicAuthResponse;
                }
            } else if (password === undefined) {
                // cancelled, fall through to the token prompt
            } else if (username && username.trim() && (!password || !password.trim())) {
                vscode.window.showErrorMessage("A password is required.");
            }
        } catch (error) {
            console.error("Basic auth attempt failed:", error);
        }

        const apiToken = "API token (EE)";
        const jwt = "JWT token (legacy)";
        const choice = await vscode.window.showQuickPick([apiToken, jwt], {placeHolder: "Select how to authenticate to Kestra"});
        if (!choice) {
            throw new Error("Authentication is required.");
        }
        const isApiToken = choice === apiToken;

        const token = await vscode.window.showInputBox({
            prompt: `${isApiToken ? "Kestra API token" : "JWT token (copy it from the Kestra UI)"} for ${ApiClient.originOf(url)}`,
            password: true,
            placeHolder: "Paste your token here"
        });
        if (!token || !token.trim()) {
            throw new Error("A token is required.");
        }

        const tokenHeaders = isApiToken ? this.bearerHeader(token.trim()) : {cookie: `JWT=${token.trim()}`};
        const tokenResponse = await fetch(url, {...options, headers: {...options?.headers, ...tokenHeaders}});

        if (tokenResponse.status === 401) {
            throw new Error("Invalid token.");
        }
        if (tokenResponse.ok) {
            await this._secretStorage.store(this.secretKey(isApiToken ? secretStorageKey.apiToken : secretStorageKey.token), token.trim());
            vscode.window.showInformationMessage("Signed in to Kestra");
        }

        return tokenResponse;
    }
}
