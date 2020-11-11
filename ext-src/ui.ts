import AbortController from "abort-controller";
import * as vscode from 'vscode';

export async function progress<T>(title: string, cancel: AbortController|null,
	body: (progress: (fraction: number) => void) => Promise<T>) {
	const opts = {
		location: vscode.ProgressLocation.Notification,
		title: title,
		cancellable: cancel != null,
	};

	const result = vscode.window.withProgress(opts, async (progress, canc) => {
		if (cancel)
			canc.onCancellationRequested((_) => cancel.abort());
		let lastFraction = 0;
		return body(fraction => {
			if (fraction > lastFraction) {
				progress.report({increment: 100 * (fraction - lastFraction)});
				lastFraction = fraction;
			}
		});
	});

	return Promise.resolve(result); // Thenable to real promise.
}

export async function slow<T>(title: string, result: Promise<T>) {
	const opts = {
		location: vscode.ProgressLocation.Notification,
		title: title,
		cancellable: false,
	};
	return Promise.resolve(vscode.window.withProgress(opts, () => result));
}

export async function promptReload(message: string) {
	if (await vscode.window.showInformationMessage(message, 'Reload window'))
		vscode.commands.executeCommand('workbench.action.reloadWindow');
}