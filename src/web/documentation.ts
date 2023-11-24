import * as vscode from 'vscode';
import {YamlUtils} from './libs/yamlUtils';
import Markdown from './libs/markdown';
import ApiClient from './apiClient';
import taskHome from './documentation/task_home.md';
import basic from './documentation/basic.md';

const kestraBaseUrl = "https://api.kestra.io/v1";

export default class DocumentationPanel {
    
    public static current: DocumentationPanel | undefined;
    
    private view = "tasks";
    private latestType: string | null = null;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _kestraUrl: string;

    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, kestraUrl: string) {
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
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'documentation')]
            }
        );

        DocumentationPanel.current = new DocumentationPanel(panel, extensionUri, kestraUrl);
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, kestraUrl: string) {
        DocumentationPanel.current = new DocumentationPanel(panel, extensionUri, kestraUrl);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, kestraUrl: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._kestraUrl = kestraUrl;

        // By default, show tasks documentation
        this._panel.webview.html = this.getWebviewDocumentationContent(Markdown.render(taskHome));



		vscode.window.onDidChangeTextEditorSelection(async (editor) => {
			if (editor && this._panel.visible) {
				const content = vscode.window.activeTextEditor?.document.getText();
				const position = editor.textEditor.selection.active;
				if (content && position) {
					const type = YamlUtils.getTaskType(content, { lineNumber: position.line, column: position.character});
          if (JSON.stringify(type) !== JSON.stringify(this.latestType)) {
              const kestraUrl = this._kestraUrl;
              const path = kestraBaseUrl === kestraUrl ? `/plugins/definitions/${type}` : `/api/v1/plugins/${type}`;
              const url = kestraUrl.replace(/\/$/, "") + path;

            let response = await ApiClient.fetch(url, null, "Error while loading Kestra's task definition:", [404]);
            if (response?.status === 200 && this.view === "tasks") {
              this.latestType = type;
              const markdown = ((await response.json()).markdown as string);
               
              this._panel.webview.html = this.getWebviewDocumentationContent(Markdown.render(markdown));

            }
          }
				}
			}
		});


		this._panel.webview.onDidReceiveMessage(
			message => {
			  switch(message.view) {
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
			},
			undefined,
			this._disposables
		  );
    }

    private getWebviewDocumentationContent(webViewContent: string) {

      // const stylesPathMarkdownPath = vscode.Uri.joinPath(this._extensionUri, 'documentation', 'markdown.css');
      // const stylesMarkdownUri = this._panel.webview.asWebviewUri(stylesPathMarkdownPath);
      return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Kestra Documentation</title>
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
          }
          </script>
        <style>
        body {
          margin: 1rem;
        }
        p, pre, code {
          border-radius: 0.15rem;
        }

        mark {
          line-height: 1.5;
        }

        code {
          color: #FD3C97;
        }

        h1 {
          font-size: 2rem;
        }
        
        blockquote {
          margin-top: 0;
          background: none;
        }
        
        mark {
          background: #03daba;
          color: #fff;
          font-size: 0.875rem;
          padding: 2px 8px 2px 8px;
          border-radius: 0.15rem;
        
          * {
            color: #fff !important;
          }
        }
        
        h2 {
          margin-top: 2rem;
          border-bottom: 1px solid #2f3342;
          font-weight: bold;
          color: #918ba9;
        }
        
        h3 {
          code {
            display: inline-block;
            font-size: 1.1rem;
            font-weight: 400;
          }
        }
        
        h2,
        h3 {
          margin-left: -15px;
        
          .header-anchor {
            opacity: 0;
            transition: all ease 0.2s;
          }
        
          &:hover {
            .header-anchor {
              opacity: 1;
            }
          }
        }
        
        h4 {
          code {
            display: inline-block;
            font-size: 1rem;
            font-weight: 400;
          }
        }
        button {
          background-color: #8405FF;
          color: #fff;
          border: none;
          border-radius: 0.15rem;
          cursor: pointer;

          &:hover {
            background-color: #6A03CC;
          }
        }
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

