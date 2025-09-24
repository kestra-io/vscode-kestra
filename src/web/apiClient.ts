// apiClient.ts
import * as vscode from 'vscode';
import { kestraBaseUrl, secretStorageKey } from "./constants";

export default class ApiClient {
    private readonly _secretStorage: vscode.SecretStorage;

    public constructor(secretStorage: vscode.SecretStorage) {
        this._secretStorage = secretStorage;
    }

    public static async getKestraApiUrl(forceInput: boolean = false): Promise<String> {
        let kestraConfigUrl = (vscode.workspace.getConfiguration("kestra.api").get("url") as string);
        let kestraUrl = kestraConfigUrl;

        let finalUrl = this.formatApiUrl(kestraUrl);
        if (vscode.env.uiKind !== vscode.UIKind.Web && (!kestraConfigUrl || forceInput)) {
            const kestraInputUrl = await vscode.window.showInputBox({
                prompt: "Kestra Webserver URL",
                value: kestraConfigUrl ?? kestraBaseUrl
            });

            if (kestraInputUrl === undefined) {
                vscode.window.showErrorMessage("Cannot get informations without proper Kestra URL.");
                return "";
            }

            finalUrl = this.formatApiUrl(kestraInputUrl);

            // url was updated, we must save it to config
            if (kestraUrl !== finalUrl) {
                kestraUrl = finalUrl;
                vscode.workspace.getConfiguration('kestra.api').update('url', kestraUrl, vscode.ConfigurationTarget.Global);
            }
        }

        return kestraUrl;
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

    // ignoreCodes allows to ignore some http codes, like 404 for the tasks documentation
    public async apiCall(url: string, errorMessage: string, ignoreCodes: number[] = [], options?: RequestInit): Promise<Response> {
        try {
            const jwtToken = await this._secretStorage.get(secretStorageKey.token);
            let response = jwtToken ?
                await fetch(url,
                    {
                        ...options,
                        headers: {
                            ...options?.headers,
                            cookie: `JWT=${jwtToken}`
                        }
                    }) :
                await fetch(url, options);

            if (!response.ok) {
                const newResponse = await this.handleFetchError(response, url, errorMessage, ignoreCodes);
                if (newResponse) {
                    return newResponse;
                }
            }
            return response;
        } catch (error) {
            vscode.window.showErrorMessage(`Fetch error: ${error}`);
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

    private async handleFetchError(response: Response, url: string, errorMessage: string, ignoreCodes: number[] = []) {
        if (response.status === 401) {
            vscode.window.showInformationMessage("This Kestra instance is secured. Please provide credentials.");
            try {
                let newResponse = await this.askCredentialsAndFetch(url);

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
            // eslint-disable-next-line @typescript-eslint/naming-convention
            'Authorization': `Basic ${btoa(username + ':' + password)}`
        } : undefined;
    }

    private async askCredentialsAndFetch(url: string): Promise<Response> {
        // Try basic auth first
        try {
            // Get stored credentials
            const storedUsername = await this._secretStorage.get(secretStorageKey.username);
            const storedPassword = await this._secretStorage.get(secretStorageKey.password);

            let username = storedUsername;
            let password = storedPassword;

            // If we don't have stored credentials, prompt for them
            if (!storedUsername || !storedPassword) {
                // Prompt for username
                username = await vscode.window.showInputBox({
                    prompt: "Basic auth username (ESC to skip and use JWT Token)",
                    value: storedUsername || "",
                    placeHolder: "Enter username or press ESC for JWT authentication"
                });

                // If username is provided, try basic auth
                if (username !== undefined && username.trim()) {
                    password = await vscode.window.showInputBox({
                        prompt: "Basic auth password",
                        password: true,
                        value: storedPassword || "",
                        placeHolder: "Enter password for basic authentication"
                    });
                }
            }

            // Try basic auth if we have both username and password
            if (username && username.trim() && password && password.trim()) {
                const basicAuthResponse = await fetch(url, {
                    headers: this.basicAuthHeader(username.trim(), password.trim())
                });

                if (basicAuthResponse.ok) {
                    // Only store credentials if authentication was successful
                    await this._secretStorage.store(secretStorageKey.username, username.trim());
                    await this._secretStorage.store(secretStorageKey.password, password.trim());
                    vscode.window.showInformationMessage("Saved basic credentials.");
                    return basicAuthResponse;
                }

                if (basicAuthResponse.status === 401) {
                    vscode.window.showWarningMessage("Basic auth failed. Please try JWT token authentication.");
                } else {
                    // Return non-401 responses as they might be valid (e.g., 403, 500, etc.)
                    return basicAuthResponse;
                }
            } else if (password === undefined) {
                // User cancelled password input, fall through to JWT
            } else if (username && username.trim() && (!password || !password.trim())) {
                vscode.window.showErrorMessage("Password is required when username is provided.");
            }
        } catch (error) {
            console.error("Basic auth attempt failed:", error);
        }

        // If basic auth fails or user cancels, try JWT token
        const jwtToken = await vscode.window.showInputBox({
            prompt: "JWT Token (copy it when logged in, under logout button)",
            placeHolder: "Paste your JWT token here"
        });

        if (!jwtToken || !jwtToken.trim()) {
            throw new Error("JWT Token is required for authentication.");
        }

        const jwtResponse = await fetch(url, {
            headers: {
                cookie: `JWT=${jwtToken.trim()}`
            }
        });

        if (jwtResponse.status === 401) {
            throw new Error("Invalid JWT Token. Please check your token and try again.");
        }

        if (jwtResponse.ok) {
            // Only store JWT token if authentication was successful
            await this._secretStorage.store(secretStorageKey.token, jwtToken.trim());
            vscode.window.showInformationMessage("JWT authentication successful.");
        }

        return jwtResponse;
    }
}