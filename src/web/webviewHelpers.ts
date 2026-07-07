import * as vscode from 'vscode';

function makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

// The HTML shell every webview shares: CSP, shared tokens, one stylesheet, one bundled script.
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, options: {title: string; style: string; script: string; allowImages?: boolean; remoteImages?: boolean; codicons?: boolean}): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', options.script));
    const tokensUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'tokens.css'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', options.style));
    const imgSrc = options.allowImages ? ` img-src ${webview.cspSource}${options.remoteImages ? ' https:' : ''} data:;` : '';
    // The codicon font is served from the extension, so allow it as a font source and link its stylesheet.
    const fontSrc = options.codicons ? ` font-src ${webview.cspSource};` : '';
    const codiconUri = options.codicons ? webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'codicon.css')) : undefined;
    const codiconLink = codiconUri ? `\n    <link href="${codiconUri}" rel="stylesheet">` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';${imgSrc}${fontSrc} style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${options.title}</title>
    <link href="${tokensUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">${codiconLink}
</head>
<body>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
