// apiClient.ts
import * as vscode from 'vscode';
import { kestraBaseUrl, secretStorageKey, yamlContentType, PebbleFunctionDef } from "./constants";
import { FlowGraph } from "../shared/flow";

export default class ApiClient {
    private readonly _secretStorage: vscode.SecretStorage;

    public constructor(secretStorage: vscode.SecretStorage) {
        this._secretStorage = secretStorage;
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
            await this._secretStorage.store(secretStorageKey.username, username.trim());
            await this._secretStorage.store(secretStorageKey.password, password.trim());
        } else {
            const token = await vscode.window.showInputBox({prompt: choice === apiToken ? "Kestra API token" : "JWT token", password: true});
            if (!token?.trim()) {
                return;
            }
            await this.clearSecrets();
            await this._secretStorage.store(choice === apiToken ? secretStorageKey.apiToken : secretStorageKey.token, token.trim());
        }

        const status = await this.verifyCredentials();
        if (status === "unauthorized") {
            await this.clearSecrets();
            vscode.window.showErrorMessage("Sign in failed: invalid credentials");
        } else if (status === "unreachable") {
            vscode.window.showWarningMessage("Could not reach Kestra. Check the URL and that the instance is running.");
        } else {
            vscode.window.showInformationMessage("Signed in to Kestra");
        }
    }

    // GET /configs is the lightweight authenticated endpoint the Kestra UI itself uses to validate a login.
    public async verifyCredentials(): Promise<"ok" | "unauthorized" | "unreachable"> {
        const response = await this.silentFetch("/configs", {}, false);
        if (!response) {
            return "unreachable";
        }
        return response.status === 401 ? "unauthorized" : "ok";
    }

    public async signOut(): Promise<void> {
        await this.clearSecrets();
        vscode.window.showInformationMessage("Signed out of Kestra");
    }

    private async clearSecrets(): Promise<void> {
        for (const key of Object.values(secretStorageKey)) {
            await this._secretStorage.delete(key);
        }
    }

    public static async getKestraApiUrl(forceInput: boolean = false, includeTenant: boolean = true): Promise<string> {
        const kestraConfigUrl = (vscode.workspace.getConfiguration("kestra.api").get("url") as string);
        let finalUrl = this.formatApiUrl(kestraConfigUrl);

        if (vscode.env.uiKind !== vscode.UIKind.Web && (!kestraConfigUrl || forceInput)) {
            const kestraInputUrl = await vscode.window.showInputBox({
                prompt: "Kestra instance URL",
                value: kestraConfigUrl ?? kestraBaseUrl
            });

            if (kestraInputUrl === undefined) {
                vscode.window.showErrorMessage("A Kestra instance URL is required.");
                return "";
            }

            finalUrl = this.formatApiUrl(kestraInputUrl);

            // url was updated, we must save it to config
            if (kestraConfigUrl !== finalUrl) {
                vscode.workspace.getConfiguration('kestra.api').update('url', finalUrl, vscode.ConfigurationTarget.Global);
            }
        }

        return includeTenant ? this.withTenant(finalUrl) : finalUrl;
    }

    private static withTenant(url: string): string {
        const tenant = (vscode.workspace.getConfiguration("kestra.api").get("tenant") as string);
        if (!url || !tenant) {
            return url;
        }
        return url.includes("/api/v1") ? url.replace("/api/v1", `/api/v1/${tenant}`) : `${url}/${tenant}`;
    }

    public static async executionUiUrl(namespace: string, flowId: string, executionId: string): Promise<string> {
        const webUrl = (await this.getKestraApiUrl()).split("/api/v1")[0];
        const tenant = (vscode.workspace.getConfiguration("kestra.api").get("tenant") as string) || "main";
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

    private async storedAuthHeaders(): Promise<Record<string, string> | undefined> {
        const apiToken = await this._secretStorage.get(secretStorageKey.apiToken);
        if (apiToken) {
            return this.bearerHeader(apiToken);
        }
        const jwtToken = await this._secretStorage.get(secretStorageKey.token);
        if (jwtToken) {
            return {cookie: `JWT=${jwtToken}`};
        }
        const username = await this._secretStorage.get(secretStorageKey.username);
        const password = await this._secretStorage.get(secretStorageKey.password);
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

    // The instance version selects the matching docs content, as the core UI does with config.version.
    public async instanceVersion(): Promise<string | null> {
        const response = await this.silentFetch("/configs", {}, false);
        return response?.ok ? ((await response.json().catch(() => null)) as {version?: string} | null)?.version ?? null : null;
    }

    // Task documentation from the connected instance; the public registry covers the no-instance case.
    public async pluginDoc(type: string): Promise<string | null> {
        const response = await this.silentFetch(`/plugins/${type}`, {}, false)
            ?? await ApiClient.fetchWithTimeout(`${kestraBaseUrl}/plugins/definitions/${type}`, {}).catch(() => null);
        return response?.ok ? ((await response.json().catch(() => null)) as {markdown?: string} | null)?.markdown ?? null : null;
    }

    // Base64 SVG icons per plugin type. The icons endpoint is not tenant-scoped.
    public async pluginIcons(): Promise<Record<string, {icon?: string}> | null> {
        const response = await this.silentFetch("/plugins/icons", {}, false);
        return response?.ok ? (await response.json().catch(() => null)) as Record<string, {icon?: string}> | null : null;
    }

    private async silentFetch(suffix: string, options: RequestInit = {}, includeTenant: boolean = true): Promise<Response | null> {
        if (!(vscode.workspace.getConfiguration("kestra.api").get("url") as string)) {
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

    // Update first (the common case for re-runs). A 404 means the flow does not exist yet, so create it.
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

    private async handleFetchError(response: Response, url: string, errorMessage: string, ignoreCodes: number[] = [], options?: RequestInit) {
        if (response.status === 401) {
            vscode.window.showInformationMessage("This Kestra instance requires authentication.");
            try {
                let newResponse = await this.askCredentialsAndFetch(url, options);

                if (newResponse.status >= 400 && !ignoreCodes.includes(newResponse.status)) {
                    vscode.window.showErrorMessage(`${errorMessage} ${response.statusText}`);
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
            const storedUsername = await this._secretStorage.get(secretStorageKey.username);
            const storedPassword = await this._secretStorage.get(secretStorageKey.password);

            let username = storedUsername;
            let password = storedPassword;

            if (!storedUsername || !storedPassword) {
                username = await vscode.window.showInputBox({
                    prompt: "Username (press Escape to use a token instead)",
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
                    await this._secretStorage.store(secretStorageKey.username, username.trim());
                    await this._secretStorage.store(secretStorageKey.password, password.trim());
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
            prompt: isApiToken ? "Kestra API token" : "JWT token (copy it from the Kestra UI)",
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
            await this._secretStorage.store(isApiToken ? secretStorageKey.apiToken : secretStorageKey.token, token.trim());
            vscode.window.showInformationMessage("Signed in to Kestra");
        }

        return tokenResponse;
    }
}
