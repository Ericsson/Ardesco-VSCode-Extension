import * as path from 'path';
import * as vscode from 'vscode';
import { createApplicationFromArgs, getAppTemplatesInfo, getArdescoPostsFromServer, getAppExamplesInfo } from './commands';
import { getArdescoSDKPath } from './extension';
import { getBoards, chips, boards } from './boards';

export type WebViewIcon = {
	light: vscode.Uri;
	dark: vscode.Uri;
}

/**
 * Manages VS Code webview panels
 */
export class WebView {
	/**
	 * Track the current panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: WebView | undefined;

	private static readonly viewType = 'react';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionPath: string;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionPath: string, title: string, icon?: WebViewIcon) {
		const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

		// If we already have a panel, show it.
		// Otherwise, create a new panel.
		if (WebView.currentPanel) {
			WebView.currentPanel._panel.reveal(column);
		} else {
			WebView.currentPanel = new WebView(extensionPath, column || vscode.ViewColumn.One, title, icon);
		}
	}

	private constructor(extensionPath: string, column: vscode.ViewColumn, title: string, icon?: WebViewIcon) {
		this._extensionPath = extensionPath;

		// Create and show a new webview panel
		this._panel = vscode.window.createWebviewPanel(WebView.viewType, title, column, {
			// Enable javascript in the webview
			enableScripts: true,

			// And restric the webview to only loading content from our extension's `media` directory.
			localResourceRoots: [
				vscode.Uri.file(path.join(this._extensionPath, 'build'))
			]
		});

		this._panel.iconPath = icon;
		
		// Set the webview's initial html content 
		this._panel.webview.html = this._getHtmlForWebview();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(this.handleMessage.bind(this), this, this._disposables);
	}

	public dispose() {
		WebView.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	public handleMessage(message: any) {
		switch (message.command) {
			case 'new-project':
				const targetAppPath = path.join(message.folder, message.name);
				const board = boards.find(b => b.name == message.board);
				const chip = chips.find(c => c.name == message.chip);
				createApplicationFromArgs(message.name, message.app, targetAppPath,
					board, chip, true).then((success) => {
					if (success) {
						vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetAppPath));
					}
				});
				return;
			case 'open-project':
				vscode.commands.executeCommand('ardesco.openProject');
				return;
			case 'documentation':
				vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs'));
				return;
			case 'pick-folder':
				const dialogOptions: vscode.OpenDialogOptions = {
					canSelectFolders: true,
					canSelectFiles: false,
					canSelectMany: false
				};

				if (message.path)
					dialogOptions.defaultUri = vscode.Uri.file(message.path);

				vscode.window.showOpenDialog(dialogOptions).then(uri => {
					if (!uri) return;
					const path = uri[0].fsPath;
					this._panel.webview.postMessage({ command: 'set-folder', uri: path })
				});
				return;
			case 'request-posts':
				(async () => {
					const posts = await getArdescoPostsFromServer();
					if (!posts)
						return false;

					this._panel.webview.postMessage({ command: 'response-posts', data: posts });
				})();
				return;
			case 'request-templates':
				(async () => {
					const templates = await getAppTemplatesInfo();
					if (!templates)
						return false;

					const data = {templates: templates, path: ''};
					const sdkPath = getArdescoSDKPath();
					if (sdkPath)
						data.path = path.join(sdkPath, "apps");

					this._panel.webview.postMessage({ command: 'response-templates', data: data });
				})();
				return;
			case 'request-examples':
				(async () => {
					const examples = await getAppExamplesInfo();
					if (!examples)
						return false;

					const data = {examples: examples, path: ''};
					const sdkPath = getArdescoSDKPath();
					if (sdkPath) {
						data.path = path.join(sdkPath, "apps");

						examples.forEach(example => {
							example.folder = example.folder.slice(data.path.length + 1);
						})
					}

					this._panel.webview.postMessage({ command: 'response-examples', data: data });
				})();
				return;
			case 'request-boards':
				(async () => {
					const boards = await getBoards();
					if (!boards)
						return false;

					const data = {boards: boards};
					this._panel.webview.postMessage({ command: 'response-boards', data: data });
				})();
				return;
			}
		}

	private _assetsFile(name: string) {
		const file = path.join(this._extensionPath, 'build', name);
		return vscode.Uri.file(file)
			.with({ scheme: 'vscode-resource' })
			.toString();
	};

	private _getHtmlForWebview() {
		const manifest = require(path.join(this._extensionPath, 'build', 'asset-manifest.json'));
		const mainScript = manifest.files['main.js'];
		const mainStyle = manifest.files['main.css'];

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
				<meta name="theme-color" content="#000000">
				<title>React App</title>
				<link rel="stylesheet" type="text/css" href="${this._assetsFile(mainStyle)}">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: https: http:; script-src 'nonce-${nonce}'; style-src vscode-resource: 'unsafe-inline' http: https: data:;">
				<base href="${this._panel.webview.asWebviewUri(vscode.Uri.file(path.join(this._extensionPath, 'build')))}/">
			</head>

			<body>
				<noscript>You need to enable JavaScript to run this app.</noscript>
				<div id="root"></div>
				<script nonce="${nonce}">
					const vscode = acquireVsCodeApi();
				</script>
				<script nonce="${nonce}" src="${this._assetsFile(mainScript)}"></script>
			</body>
			</html>`;
	}
}

function getNonce() {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}