import * as vscode from 'vscode';
import {YamlUtils} from '../libs/yamlUtils';
import Markdown from '../libs/markdown';
import ApiClient from '../apiClient';
import taskHome from './task_home.md';
import basic from './basic.md';
import {kestraBaseUrl} from '../constants';

export default class DocumentationPanel {

    public static current: DocumentationPanel | undefined;

    private view = "tasks";
    private latestType: string | null = null;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _apiClient: ApiClient;

    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, apiClient: ApiClient) {
        const column = vscode.ViewColumn.Two;

        // Panel already exist
        if (DocumentationPanel.current) {
            DocumentationPanel.current._panel.reveal(column);
            return;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            'kestra.documentation',
            'Kestra Documentation',
            column,
            {
                enableScripts: true,
                enableCommandUris: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        DocumentationPanel.current = new DocumentationPanel(panel, extensionUri, apiClient);
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, apiClient: ApiClient) {
        DocumentationPanel.current = new DocumentationPanel(panel, extensionUri, apiClient);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, apiClient: ApiClient) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._apiClient = apiClient;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // By default, show tasks documentation
        this._panel.webview.html = this.getWebviewDocumentationContent(Markdown.render(taskHome));


        vscode.window.onDidChangeTextEditorSelection(async (editor) => {
            if (editor && this._panel.visible) {
                const content = vscode.window.activeTextEditor?.document.getText();
                const position = editor.textEditor.selection.active;
                if (content && position) {
                    const type = YamlUtils.getTaskType(content, {
                        lineNumber: position.line,
                        column: position.character
                    });
                    if (JSON.stringify(type) !== JSON.stringify(this.latestType) && type !== null) {
                        const kestraUrl = await ApiClient.getKestraUrl();
                        const path = kestraBaseUrl === kestraUrl ? `/plugins/definitions/${type}` : `/api/v1/plugins/${type}`;
                        const url = kestraUrl.replace(/\/$/, "") + path;

                        let response = await this._apiClient.apiCall(url, "Error while loading Kestra's task definition:", [404]);
                        if (response?.status === 200 && this.view === "tasks") {
                            this.latestType = type;
                            const markdown = (await response.json() as {markdown: string}).markdown;

                            this._panel.webview.html = this.getWebviewDocumentationContent(Markdown.render(markdown));
                        }
                    }
                }
            }
        });


        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.view) {
                    case "basics":
                        this.view = message.view;
                        this._panel.webview.html = this.getWebviewDocumentationContent(Markdown.render(basic));
                        break;
                    case "tasks":
                        this.view = message.view;
                        this.latestType = null;
                        this._panel.webview.html = this.getWebviewDocumentationContent(Markdown.render(taskHome));
                        break;
                }
                if (message.command === 'openExternal') {
                    vscode.env.openExternal(vscode.Uri.parse(message.text));
                }
            },
            undefined,
            this._disposables
        );
    }


    public dispose() {
        DocumentationPanel.current = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }


    private getWebviewDocumentationContent(webViewContent: string) {

        const stylesPathMarkdownPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'markdown.css');
        const stylesMarkdownUri = this._panel.webview.asWebviewUri(stylesPathMarkdownPath);

        return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Kestra Documentation</title>
				<link href="${stylesMarkdownUri}" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-okaidia.css" rel="stylesheet" />
        <script>
          window.onload = function() {
            const vscode = acquireVsCodeApi();
            document.getElementById('basics').addEventListener('click', () => {
              vscode.postMessage({
                view: 'basics'
              })
            });
          document.getElementById('tasks').addEventListener('click', () => {
              vscode.postMessage({
                  view: 'tasks'
              })
            });
            document.body.addEventListener('click', event => {
              if (event.target.tagName === 'A') {
                  const href = event.target.getAttribute('href');
                  if (href) {
                      event.preventDefault();
                      vscode.postMessage({
                          command: 'openExternal',
                          text: href
                      });
                  }
              }
          });
          }
          </script>
        <style>
        </style>
      </head>
      <body>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
        <div class="container">
          <h1 class="title">Kestra Documentation</h1>
          <button id="basics">Basics</button>
          <button id="tasks">Tasks</button>
          <br/>
          ${webViewContent}
        </div>
      </body>
      </html>`;
    }
}