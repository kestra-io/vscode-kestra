// apiClient.ts
import fetch, { Response } from 'node-fetch';
import * as vscode from 'vscode';

export default class ApiClient {

    // ignoreCodes allows to ignore some http codes, like 404 for the tasks documentation
    public static async fetch(url: string, options: any, errorMessage: string, ignoreCodes: number[] = []): Promise<Response> {
        try {
            const response = options ? await fetch(url, options) : await fetch(url);

            if (!response.ok) {
                this.handleFetchError(response, url, errorMessage, ignoreCodes);
            }
            return response;
        } catch (error) {
            vscode.window.showErrorMessage(`Fetch error: ${error}`);
            throw error;
        }
    }

    private static async handleFetchError(response: Response, url: string, errorMessage: string, ignoreCodes: number[] = []) {
        if (response.status === 401) {
            vscode.window.showInformationMessage("This Kestra instance is secured. Please provide credentials.");
            try {
                let newResponse = await this.askCredentialsAndFetch(url, errorMessage, ignoreCodes);

                if (newResponse.status !== 200 && !ignoreCodes.includes(newResponse.status)) {
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

        if (response.status !== 200 && !ignoreCodes.includes(response.status)) {
            vscode.window.showErrorMessage(`${errorMessage} ${response.statusText}`);
            return;
        }
        
        return response;
    } 

    private static basicAuthHeader(username: string | undefined, password: string | undefined) {
        return username && password ? {
            Authorization: `Basic ${btoa(username + ':' + password)}`
        } : undefined;
    }

    private static async askCredentialsAndFetch(url: string, errorMessage: string, ignoreCodes: number[] = []) {
        const username = await vscode.window.showInputBox({ prompt: "Basic auth username (ESC for none)" });
        let password;
        let response;
        if (username !== undefined && username !== "") {
            password = await vscode.window.showInputBox({ prompt: "Basic auth password", password: true });
            if (password === undefined || password === "") {
                throw new Error("You should provide a basic auth password if username is provided.");
            }
            response = await fetch(url, {
                headers: this.basicAuthHeader(username, password)
            });
        }
    
        // Still need JWT token
        if (response === undefined || response.status === 401) {
            const jwtToken = await vscode.window.showInputBox({ prompt: "JWT Token (copy it when logged in, under logout button)" });
            if (jwtToken === undefined) {
                throw new Error("You should provide a JWT Token or your basic auth credentials were incorrect.");
            }
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