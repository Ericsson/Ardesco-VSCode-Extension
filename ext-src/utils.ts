import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

export function fs_exists(fspath: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => { fs.exists(fspath, res => resolve(res)); });
}

export function copyFileSync(source: string, target: string) {
	var targetFile = target;

	//if target is a directory a new file with the same name will be created
	if (fs.existsSync(target)) {
		if (fs.lstatSync(target).isDirectory()) {
			targetFile = path.join(target, path.basename(source));
		}
	}

	fs.writeFileSync(targetFile, fs.readFileSync(source));
}

export function copyFolderRecursiveSync(source: string, target: string) {
	var files = [];

	// Check if folder needs to be created or integrated
	var targetFolder = target;
	if (!fs.existsSync(targetFolder)) {
		fs.mkdirSync(targetFolder);
	}

	// Copy
	if (fs.lstatSync(source).isDirectory()) {
		files = fs.readdirSync(source);
		files.forEach(function (file) {
			var curSource = path.join(source, file);
			if (fs.lstatSync(curSource).isDirectory()) {
				copyFolderRecursiveSync(curSource, targetFolder);
			} else {
				copyFileSync(curSource, targetFolder);
			}
		});
	}
}

export async function execAsync(command: string, args: string[]): Promise<string[]> {
	return new Promise((resolve, reject) => {
		execFile(command, args, (error, stdout, stderr) => {
			if (error) {
				reject(error);
				return;
			}

			resolve([stderr.trim(), stdout.trim()]);
		});
	});
}