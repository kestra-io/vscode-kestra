// apiClient.ts
import * as vscode from 'vscode';
import {kestraBaseUrl, secretStorageKey} from "./constants";

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

            finalUrl = this.formatApiUrl(kestraUrl);

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
            Authorization: `Basic ${btoa(username + ':' + password)}`
        } : undefined;
    }

    private async askCredentialsAndFetch(url: string) {
        let username: string | undefined = await this._secretStorage.get(secretStorageKey.username);
        username = await vscode.window.showInputBox({
            prompt: "Basic auth username (ESC to login with JWT Token)",
            value: username
        });
        let password;
        let response;
        if (username !== undefined && username !== "") {
            this._secretStorage.store(secretStorageKey.username, username);
            password = await vscode.window.showInputBox({
                prompt: "Basic auth password (ESC to login with JWT Token)",
                password: true
            });
            if (password === undefined || password === "") {
                throw new Error("You should provide a basic auth password if username is provided.");
            }
            response = await fetch(url, {
                headers: this.basicAuthHeader(username, password)
            });
        }

        // Still need JWT token
        if (response === undefined || response.status === 401) {
            const jwtToken = await vscode.window.showInputBox({prompt: "JWT Token (copy it when logged in, under logout button)"});
            if (jwtToken === undefined) {
                throw new Error("You should provide a JWT Token or your basic auth credentials were incorrect.");
            }
            this._secretStorage.store(secretStorageKey.token, jwtToken);
            response = await fetch(
                url,
                {
                    headers: {
                        ...(this.basicAuthHeader(username, password) ?? {}),
                        cookie: `JWT=${jwtToken}`
                    }
                }
            );

            if (response.status === 401) {
                throw new Error("Wrong credentials, please retry with proper ones.");
            }
        }

        return response;
    }
}