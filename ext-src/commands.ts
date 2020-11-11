import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsextra from 'fs-extra';
import * as path from 'path';
import * as stream from 'stream'
import { promisify } from 'util';

import AbortController from 'abort-controller';
import * as got from 'got';
import * as unzipper from 'unzipper';
import fetch from 'node-fetch';
import * as osLocale from 'os-locale';
import * as yaml from 'js-yaml';

import { getZephyrBoardSpec, Board, BoardChip, boards, chips, getBoardChip, getJLinkChipPartId } from './boards';
import writeCMakeKitsJson from './cmake-kits';
import {
	getBuildPath, getExpandedBuildPath,
		updateBuildButtonItem, getWorkspacePath, getArdescoSDKPath,
		getNRFJProgPath, updateFlashButtonItem, FlashOperation,
		getGDBServerPath, 
		globalStoragePath,
		getArdescoSDKCurrentVersion,
		getArdescoSDKUpdateServer,
	getZephyrBasePath,
	updateStatusBarItems,
	ardescoOutputChannel
} from "./extension";
import writeLaunchJson from './launch-tasks';
import { execAsync } from "./utils";
import { progress, promptReload } from './ui';
import * as semver from 'semver';

export async function selectBoard() {
	return new Promise(async (resolve) => {
		let names = boards.map(m => m.name);
		const pick = await vscode.window.showQuickPick(names);
		if (!pick) {
			resolve();
			return;
		}

		const config = vscode.workspace.getConfiguration('ardesco');
		await config.update("board.name", pick, vscode.ConfigurationTarget.Workspace);

		await updateStatusBarItems();
		await handleConfigChange();

		resolve();
	});
}

export async function selectBoardChip() {
	return new Promise(async (resolve) => {
		let names = chips.map(c => c.name);
		const pick = await vscode.window.showQuickPick(names);
		if (!pick) {
			resolve();
			return;
		}

		const config = vscode.workspace.getConfiguration('ardesco');
		await config.update("board.chip", pick, vscode.ConfigurationTarget.Workspace);

		await updateStatusBarItems();
		await writeLaunchJson();
		await handleConfigChange();

		resolve();
	});
}

export async function selectSecureBuildMode() {
	return new Promise(async (resolve) => {
		const keys = ["Yes", "No"];
		const pick = await vscode.window.showQuickPick(keys);
		if (!pick) {
			resolve();
			return;
		}

		const isSecure = pick === "Yes";
		const config = vscode.workspace.getConfiguration('ardesco');
		await config.update("secureBuild", isSecure, vscode.ConfigurationTarget.Workspace);

		await updateStatusBarItems();
		await handleConfigChange();

		resolve();
	});
}

function ensureBuildDir() {
	const buildPath = getExpandedBuildPath();
	if (!buildPath)
		return;

	// Ensure existence of build directory
	if (fs.existsSync(buildPath))
		return;

		fs.mkdirSync(buildPath);
	}

function updateCMakeSettings() {
	const config = vscode.workspace.getConfiguration('ardesco');
	const zephyrBase = getZephyrBasePath();
	const gnuarmembToolchainPath: string = config.get('gnuarmembToolchainPath', '');

	vscode.workspace.getConfiguration("cmake").update("configureOnOpen", false, true);
	vscode.workspace.getConfiguration("cmake").update("environment", {
		"ZEPHYR_BASE": `${zephyrBase}`,
		"ZEPHYR_TOOLCHAIN_VARIANT": "gnuarmemb",
		"GNUARMEMB_TOOLCHAIN_PATH": `${gnuarmembToolchainPath}`
	});
}

function updateCortexDebugSettings() {
	const config = vscode.workspace.getConfiguration('ardesco');

	const gnuarmembToolchainPath: string = config.get('gnuarmembToolchainPath', '');
	if (gnuarmembToolchainPath) {
		vscode.workspace.getConfiguration("cortex-debug").update("armToolchainPath", `${gnuarmembToolchainPath}${path.sep}bin`);
	}

	const jlinkGdbServerPath: string = config.get('JLinkGDBServerPath', '');
	if (jlinkGdbServerPath) {
		vscode.workspace.getConfiguration("cortex-debug").update("JLinkGDBServerPath", jlinkGdbServerPath);
	}
}

export async function setup() {
	let kitName = "__unspec__"
	const generateCMakeKits = false
	if (generateCMakeKits) {
		kitName = "GNU Embedded (Ardesco)";
		await writeCMakeKitsJson(kitName);
	}

		await writeLaunchJson();

	ensureBuildDir();

	updateCMakeSettings();
	const cmakeConf = vscode.workspace.getConfiguration("cmake");

	// Configure the CMake extension UI
	await cmakeConf.update("statusbar.advanced", {
		 kit: { visibility: "hidden" },
		 workspace: { visibility: "hidden" },
		 buildTarget: { visibility: "hidden" },
		 launchTarget: { visibility: "hidden" },
		 status: { visibility: "compact" },
		 build: { visibility: "hidden" },
		 debug: { visibility: "hidden" },
		 launch: { visibility: "hidden" },
	});

	await cmakeConf.update("buildDirectory", getBuildPath());
	await cmakeConf.update("configureSettings", { "BOARD": `${getZephyrBoardSpec()}` });

	const cppToolsConf = vscode.workspace.getConfiguration("C_Cpp");
	await cppToolsConf.update("default.configurationProvider", "ms-vscode.cmake-tools");

	await vscode.commands.executeCommand('cmake.setKitByName', kitName);

	updateCortexDebugSettings();
}

export async function clean() {
	return new Promise(async (resolve) => {
		if (!fs.existsSync(getExpandedBuildPath()!)) {
			await configure();
			resolve();
			return;
		}
		
		try {
			await vscode.commands.executeCommand('cmake.cleanConfigure');
		} catch (err) {
			vscode.window.showErrorMessage(`Something went wrong during the clean process: ${err.message}`);
		}

		resolve();
	});
}

export let isConfiguring = false;
export let hasConfigChange = false;

export async function configure() {
	return new Promise(async (resolve) => {
		try {
			updateStatusBarItems();

			if (!insideValidWorkspace()) {
				vscode.window.showErrorMessage('No workspace was detected, ignoring request.');
				resolve();
				return;
			}

			if (isConfiguring) {
				resolve();
				return;
			}

			isConfiguring = true;
			hasConfigChange = false;

			await setup();
			await vscode.commands.executeCommand('cmake.configure');

			try {
				const compileCommands = getExpandedBuildPath() + "/compile_commands.json";
				fs.statSync(compileCommands);

				const clangdExt = vscode.extensions.getExtension('llvm-vs-code-extensions.vscode-clangd');
				if (clangdExt) {
					const workspaceCommands = path.join(getWorkspacePath()!, 'compile_commands.json')
					fs.symlinkSync(compileCommands, workspaceCommands, 'file')
				} else {
					const cppToolsConf = vscode.workspace.getConfiguration("C_Cpp");
					cppToolsConf.update("default.compileCommands", getBuildPath() + "/compile_commands.json");
				}
			} catch {
			}
		} catch (err) {
			vscode.window.showErrorMessage(`Something went wrong during the configure process: ${err.message}`);
		}

		// Prevent spurious configures triggered by config writes.
		setTimeout(() => { isConfiguring = false }, 100);

		resolve();
	});
}

export async function build() {
	return new Promise(async (resolve) => {
		if (!insideValidWorkspace()) {
			vscode.window.showErrorMessage('No workspace was detected, ignoring request.');
			resolve();
			return;
		}

		updateBuildButtonItem(false);

		// Configure if needed
		var needsConfigure = !fs.existsSync(getExpandedBuildPath()!) || hasConfigChange;
		if (needsConfigure)
			await configure();

		await vscode.commands.executeCommand('cmake.build');

		updateBuildButtonItem(true);
		resolve();
	});
}

export async function flash() {
	return new Promise(async (resolve) => {
		if (!insideValidWorkspace()) {
			vscode.window.showErrorMessage('No workspace was detected, ignoring request.');
			resolve();
			return;
		}

		// Check if the connected device is compatible with this configuration.
		const deviceChip = await getJLinkChipPartId();
		if (deviceChip) {
			const chip = getBoardChip();
			if (chip != deviceChip) {
				vscode.window.showErrorMessage(`${deviceChip.name} device not compatible with ${chip.name} target.`);
				resolve();
				return;
			}
		}

		let nrfjprog = await getNRFJProgPath();
		if (!nrfjprog) {
			vscode.window.showErrorMessage('nRF Command Line Tools could not be found, define ardesco.nrjprog in the config and try again.');
			resolve();
			return;
		}

		// We could also get this from ZEPHYR_RUNNER_CONFIG_KERNEL_HEX:STRING in CMakeCache.txt.
		// Though there is no advantage for now as all Ardesco apps follow the convention below.

		const zephyrBuildPath = path.join(getExpandedBuildPath()!, "zephyr");
		const zephyrHex = path.join(zephyrBuildPath, 'zephyr.hex');
		const mergedHex = path.join(zephyrBuildPath, 'merged.hex');
		const outputHex = fs.existsSync(mergedHex) ? mergedHex : zephyrHex;

		if (!fs.existsSync(outputHex)) {
			vscode.window.showErrorMessage('Output binary could not be found, make sure the project is built.');
			resolve();
			return;
		}

		ardescoOutputChannel.show();
		ardescoOutputChannel.clear();

		// Erase the board
		try {
			updateFlashButtonItem(FlashOperation.Erase);
			let args = ['-e'];
			ardescoOutputChannel.appendLine(`1) Executing flash erase: ${nrfjprog} ${args}`);
			const [stderr, stdout] = await execAsync(nrfjprog, args);
			ardescoOutputChannel.appendLine(stdout);
			ardescoOutputChannel.appendLine(stderr);
		} catch (e) {
			ardescoOutputChannel.append('Error: ');
			ardescoOutputChannel.appendLine(e);
			updateFlashButtonItem(FlashOperation.None);
			vscode.window.showErrorMessage('There was an error erasing the board via nrfjprog, please check the output logs.');
			resolve();
			return;
		}

		// Flash the output image.
		try {
			updateFlashButtonItem(FlashOperation.Program);
			let args = ['--program', outputHex, '--reset'];
			ardescoOutputChannel.appendLine(`2) Executing flash program: ${nrfjprog} ${args}`);
			const [stderr, stdout] = await execAsync(nrfjprog, args);
			ardescoOutputChannel.appendLine(stdout);
			ardescoOutputChannel.appendLine(stderr);
		} catch (e) {
			ardescoOutputChannel.append('Error: ');
			ardescoOutputChannel.appendLine(e);
			updateFlashButtonItem(FlashOperation.None);
			vscode.window.showErrorMessage('There was an error programming the board via nrfjprog, please check the output logs.');
			resolve();
			return;
		}

		ardescoOutputChannel.appendLine('Flash success.\n');

		updateFlashButtonItem(FlashOperation.None);
		resolve();
	});
}

export async function debug() {
	return new Promise(async (resolve) => {
		if (!insideValidWorkspace()) {
			vscode.window.showErrorMessage('No workspace was detected, ignoring request.');
			resolve();
			return;
		}

		const gdbServerPath = await getGDBServerPath() || '';
		if (!fs.existsSync(gdbServerPath)) {
			vscode.window.showErrorMessage('GDB server could not be found, define ardesco.JLinkGDBServerPath in the config and try again.');
			resolve();
			return;
		}

		// Check if the connected device is compatible with this configuration.
		const deviceChip = await getJLinkChipPartId();
		if (deviceChip) {
			const chip = getBoardChip();
			if (chip != deviceChip) {
				vscode.window.showErrorMessage(`${deviceChip.name} device not compatible with ${chip.name} target.`);
				resolve();
				return;
			}
		}

		const config = vscode.workspace.getConfiguration('ardesco');
		const shouldFlash = config.get("flashOnDebug");
		if (shouldFlash)
			await flash();

		const workspaceFolders = vscode.workspace.workspaceFolders;
		vscode.debug.startDebugging(workspaceFolders![0], "Cortex Debug", undefined);
		resolve();
	});
}

type TemplateParameterInfo = {
	type: string,
	name: string,
	config: string
}

type TemplateInfo = {
	folder: string,
	name: string,
	/*
	parameters: {
		token: string,
		type: "string" | "number"
	}[]
	*/
	parameters: TemplateParameterInfo[]
};

export function insideValidWorkspace() {
	var hasWorkspace = vscode.workspace.workspaceFolders != undefined;
	if (!hasWorkspace)
		return false;

	try {
		const cmakeLists = path.join(getWorkspacePath()!, "CMakeLists.txt");
		fs.existsSync(cmakeLists);
		return true;
	} catch {
		return false;
	}
}

export async function getAppTemplatesInfo(): Promise<TemplateInfo[]|null> {
		const sdkBase = getArdescoSDKPath();
		if (!sdkBase) {
			return null;
		}

		const templatePath = path.join(sdkBase, "templates");
		const templateFolders = await fs.promises.readdir(templatePath);
		const templateInfos: TemplateInfo[] = [];

		// Read the template.json file from each sample application.
		templateFolders.forEach(template => {
			const jsonPath = path.join(templatePath, template, "template.json");

			try {
				const json = fs.readFileSync(jsonPath, 'utf8');

				let info: TemplateInfo;
				info = JSON.parse(json);
				info.folder = path.join(templatePath, template);
				templateInfos.push(info)
			} catch {
			}
		});

	return templateInfos;
}

export async function getAppExamplesInfo(): Promise<TemplateInfo[]|null> {
	const sdkBase = getArdescoSDKPath();
	if (!sdkBase) {
		return null;
		}

	const examplesPath = path.join(sdkBase, "apps");
	const folders = await fs.promises.readdir(examplesPath);
	const infos: TemplateInfo[] = [];

	folders.forEach(example => {
		let info: TemplateInfo = {
			name: example,
			folder: path.join(examplesPath, example),
			parameters: []
		};

		try {
			const sampleYamlPath = path.join(info.folder, "sample.yaml");
			const contents = fs.readFileSync(sampleYamlPath, 'utf8');
			const data = yaml.safeLoad(contents) as any;
			if (data.sample.name)
				info.name = data.sample.name;
		} catch {

		}

		infos.push(info)
			});

	return infos;
			}

export async function createApplicationFromArgs(projectName: string, targetApp: string,
	targetAppPath: string, board?: Board, chip?: BoardChip, writeTriggerFile: boolean = false) {
	const templateInfos = await getAppTemplatesInfo();
	if (!templateInfos)
		return false;

			if (fs.existsSync(targetAppPath)) {
				vscode.window.showErrorMessage('Project with this name already exists, try again.');
		return false;
			}

		// Copy the files from the chosen app template to the workspace.
		const info = templateInfos.find(i => i.name == targetApp)!;
		const sourceAppPath = info.folder;
		await fsextra.copy(sourceAppPath, targetAppPath);

		const targetTemplateJson = path.join(targetAppPath, 'template.json');
		if (fs.existsSync(targetTemplateJson))
			await fs.promises.unlink(targetTemplateJson);

		// Replace the projectName token with the user-specified name.
		const targetCMakeLists = path.join(targetAppPath, 'CMakeLists.txt')
		if (fs.existsSync(targetCMakeLists)) {
			let contents = await fs.promises.readFile(targetCMakeLists, 'utf8');
			contents = contents.replace("%%{projectName}", projectName);
			await fs.promises.writeFile(targetCMakeLists, contents);
		}

	// Write settings.json with the user-selected board and chip.
	const vscodePath = path.join(targetAppPath, '.vscode');
	await fs.promises.mkdir(vscodePath);

	const settingsPath = path.join(vscodePath, 'settings.json');
	const settings = `{
		"ardesco.board.name": "${board?.id ?? ''}",
		"ardesco.board.chip": "${chip?.id ?? ''}"
}
`;
	await fs.promises.writeFile(settingsPath, settings);

	if (writeTriggerFile) {
		const triggerPath = path.join(vscodePath, '.trigger');
		await fs.promises.writeFile(triggerPath, '');
	}

	return true;
}

export async function createApplication() {
	return new Promise(async (resolve) => {
		if (insideValidWorkspace()) {
			vscode.window.showErrorMessage('This workspace already contains an application!');
			resolve();
			return;
		}

		const templateInfos = await getAppTemplatesInfo();
		if (!templateInfos) {
			vscode.window.showErrorMessage('No templates were found in Ardesco SDK.');
			resolve();
			return;
		}

		const targetApps = templateInfos.map(info => info.name);
		const targetApp = (await vscode.window.showQuickPick(targetApps));
		if (!targetApp) {
			resolve();
			return;
		}

		const projectName = await vscode.window.showInputBox({
			prompt: 'Enter a name for the new application',
			validateInput: (value: string): string => {
				if (!value.length)
					return 'A project name is required';
				return '';
			},
		});

		if (!projectName) {
			vscode.window.showErrorMessage('No valid project name was specified, try again.');
			resolve();
			return;
		}

		const sdkBase = getArdescoSDKPath();
		let targetAppPath = path.join(sdkBase!, "apps");

		if (!await createApplicationFromArgs(projectName, targetApp, targetAppPath))
			return;

		//if (!insideWorkspace) {
			//vscode.workspace.updateWorkspaceFolders(0, 0, { uri: Uri.file(targetAppPath) });
			vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetAppPath));
		//} else {
			// Configuring the app explicitly is not needed because the extension will
			// be activated by VS Code when CMakeLists.txt is written to the workspace.
		//}

		resolve();
	});
}

export async function openProject() {
	return new Promise(async (resolve, reject) => {
		const dialogOptions: vscode.OpenDialogOptions = {
			canSelectFolders: true,
			canSelectFiles: false,
			canSelectMany: false,
		};

		const ardescoSDKPath = getArdescoSDKPath();
		if (ardescoSDKPath)
			dialogOptions.defaultUri = vscode.Uri.file(path.join(ardescoSDKPath, "apps"));

		vscode.window.showOpenDialog(dialogOptions).then(uri => {
			if (!uri) {
				reject();
				return;
			}
			const path =  vscode.Uri.file(uri[0].fsPath);
			vscode.commands.executeCommand('vscode.openFolder', path);
		});

		resolve();
	});
}

export async function openTerminal() {
	return new Promise(async (resolve) => {
		let ardescoTerminal = vscode.window.terminals.find(t => t.name == "Ardesco");
		if (ardescoTerminal) {
			ardescoTerminal.show();
			resolve();
			return;
		}

		const options: vscode.TerminalOptions = {
			name: "Ardesco",
			env: {},
		};

		const ardescoSDKPath = getArdescoSDKPath();
		if (ardescoSDKPath) {
			options.env!['ARDESCO_ROOT'] = ardescoSDKPath;
			options.cwd = ardescoSDKPath;
		}

		const config = vscode.workspace.getConfiguration('ardesco');
		const zephyrBase = getZephyrBasePath();
		if (zephyrBase) {
			options.env!['ZEPHYR_BASE'] = zephyrBase;
		}

		const gnuarmembToolchainPath: string = config.get('gnuarmembToolchainPath', '');
		if (gnuarmembToolchainPath) {
			options.env!['GNUARMEMB_TOOLCHAIN_PATH'] = gnuarmembToolchainPath;
			options.env!['ZEPHYR_TOOLCHAIN_VARIANT'] = 'gnuarmemb';
		}

		ardescoTerminal = vscode.window.createTerminal(options);
		ardescoTerminal.show();

		resolve();
	});
}

type SdkIndex = {
	sdks: { file: string }[]
}

export async function getArdescoSdksIndex(): Promise<SdkIndex | null> {
	try {
		const response = await got.default(`${getArdescoSDKUpdateServer()}/index.json`).json<object>();
		console.log(response);
		return response as SdkIndex;
	} catch (error) {
		console.log("Error while requesting Ardesco SDKs index from update server: " + error);
		return null;
	}
}

interface IDictionary<TValue> {
    [key: string]: TValue;
}

type PostWithLocales = {
	date: string,
	thumbnail: string,
	title: IDictionary<string>,
	contents: IDictionary<string[]>,
	link: IDictionary<string>
}

type Post = {
	date: string,
	thumbnail: string,
	title: string,
	contents: string[]
	link: string
}

export async function getArdescoPostsFromServer(): Promise<Post[] | null> {
	try {
		const response = await got.default(`${getArdescoSDKUpdateServer()}/posts/index.json`).json<object>();
		const index = response as { posts: PostWithLocales[] };

		const locale = await osLocale();
		const defaultLocale = "en-US";

		const posts: Post[] = []
		index.posts.forEach(post => {
			const link = (locale in post.link) ? post.link[locale] : post.link[defaultLocale];
			const title = (locale in post.title) ? post.title[locale] : post.title[defaultLocale];
			const contents = (locale in post.contents) ? post.contents[locale] : post.contents[defaultLocale];

			const localizedPost: Post = {
				date: post.date,
				thumbnail: `${getArdescoSDKUpdateServer()}/posts/${post.thumbnail}`,
				link: link,
				title: title,
				contents: contents
			};

			posts.push(localizedPost);
		});

		return posts;
	} catch (error) {
		console.log("Error while requesting Ardesco SDKs news index from update server: " + error);
		return null;
	}
}

export function parseLatestSdkVersion(index: SdkIndex) {
	const sdks = index.sdks;
	if (sdks.length == 0) {
		vscode.window.showErrorMessage('No valid Ardesco SDK versions were found in index.');
		return null;
	}

	const sortedSdks = sdks.sort((s1, s2) => s2.file.localeCompare(s1.file));
	const latest = sortedSdks[0];

	const versionRegex = /.*-(\d\.\d\.\d).*/g;
	const latestVersion  = versionRegex.exec(latest.file);
	if (!latestVersion) {
		vscode.window.showErrorMessage('Could not parse Ardesco SDK version from index.');
		return null;
	}

	return [latest.file, latestVersion[1]];
}

export async function promptInstall(version: string) {
	const message = 'Ardesco SDK was not detected on your system.\n ' +
					`Would you like to download and install Ardesco SDK ${version}?`;
	const yes = 'Yes';
	const no = 'No';
	const response = await vscode.window.showInformationMessage(message, yes, no);
	return response == yes;
}

// Downloads `url` to a local file `dest` (whose parent should exist).
// A progress dialog is shown, if it is cancelled then `abort` is signaled.
async function download(url: string, dest: string, abort: AbortController): Promise<void> {
	console.log('Downloading ', url, ' to ', dest);
	return progress(
		`Downloading ${path.basename(dest)}`, abort, async (progress) => {
			const response = await fetch(url, { signal: abort.signal });
			if (!response.ok)
				throw new Error(`Failed to download $url`);

				const size = Number(response.headers.get('content-length'));
			let read = 0;
			response.body.on('data', (chunk: Buffer) => {
				read += chunk.length;
				progress(read / size);
			});

			const out = fs.createWriteStream(dest);
			await promisify(stream.pipeline)(response.body, out).catch(e => {
				// Clean up the partial file if the download failed.
				fs.unlink(dest, (_) => null); // Don't wait, and ignore error.
				throw e;
			});
		});
}

export async function downloadAndInstall(sdkFile: string, sdkVersion: string) {
	// Make sure the global extension storage path exists.
	await fs.promises.mkdir(globalStoragePath, {'recursive': true});

	// Download the SDK while informing the user about progress.
	const zipFile = path.join(globalStoragePath, sdkFile);
	try {
		const controller = new AbortController();
		await download(`${getArdescoSDKUpdateServer()}/${sdkFile}`, zipFile, controller);
	} catch(e) {
		vscode.window.showErrorMessage('Error while downloading the Ardesco SDK.');
		return null;
	}

	// Extract the SDK zip and update the settings with the new paths.
	const baseFilename = sdkFile.substr(0, sdkFile.lastIndexOf('.')) || sdkFile;
	const extractRoot = path.join(globalStoragePath, baseFilename)
	await fs.promises.mkdir(extractRoot, {'recursive': true});

	const archive = await unzipper.Open.file(zipFile);
	archive.extract({path: extractRoot});
	//slow('Extracting Ardesco SDK', archive.extract({path: extractRoot}));

	// Update the Ardesco SDK location in config.
	const config = vscode.workspace.getConfiguration('ardesco');
	await config.update("sdk.base", extractRoot, vscode.ConfigurationTarget.Global);

	// Prompt the user to reload the window.
	await promptReload(`Ardesco SDK ${sdkVersion} is now installed.`);
}

export async function install() {
	return new Promise(async (resolve) => {
		// Download a JSON index from the SDK update server.
		const index = await getArdescoSdksIndex();
		if (!index) {
			vscode.window.showErrorMessage('Could not get Ardesco SDK index from update server.');
			resolve();
			return null;
		}

		// Parse the latest SDK version from the index.
		const latestSdkResult = parseLatestSdkVersion(index);
		if (!latestSdkResult) {
			resolve();
			return null;
		}

		const [latestFile, latestVersion] = latestSdkResult;

		// Inform the user and wait for an action to see if we should proceed.
		const shouldInstall = await promptInstall(latestVersion);
		if (!shouldInstall) {
			resolve();
			return null;
		}

		await downloadAndInstall(latestFile, latestVersion);
		resolve();
	});
}

export async function promptUpdate(newVersion: string) {
	const message = `Ardesco SDK ${newVersion} is available as an update.\n ` +
					`Would you like to download and install it?`;
	const yes = 'Yes';
	const dontAsk = "Don't ask again";
	const response = await vscode.window.showInformationMessage(message, yes, dontAsk);
	if (response == dontAsk) {
		const config = vscode.workspace.getConfiguration('ardesco');
		await config.update("checkForUpdates", true, vscode.ConfigurationTarget.Global);
		return false;
	}
	return response == yes;
}

export async function checkUpdates() {
	return new Promise(async (resolve) => {
		// Download a JSON index from the SDK update server.
		const index = await getArdescoSdksIndex();
		if (!index) {
			vscode.window.showErrorMessage('Could not get Ardesco SDK index from update server.');
			resolve();
			return null;
		}

		// Parse the latest SDK version from the index.
		const latestSdkResult = parseLatestSdkVersion(index);
		if (!latestSdkResult) {
			resolve();
			return null;
		}

		const [latestFile, latestVersion] = latestSdkResult;
		const currentVersion = getArdescoSDKCurrentVersion();
		if (!currentVersion) {
			await install();
			resolve();
			return null;
		}

		if (!semver.gt(latestVersion, currentVersion)) {
			resolve();
			return null;
		}

		// Inform the user and wait for an action to see if we should proceed.
		const shouldUpdate = await promptUpdate(latestVersion);
		if (!shouldUpdate) {
			resolve();
			return null;
		}

		// Upgrade the SDK version.
		await downloadAndInstall(latestFile, latestVersion);
	});
}

export async function handleConfigChange() {
	const config = vscode.workspace.getConfiguration('ardesco');
	const action = config.get("configureOnConfigChanges");

	switch(action)
	{
	case "ask":
		await promptReconfigure();
		hasConfigChange = false;
		return;
	case "automatic":
		hasConfigChange = true;
		return;
	case "manual":
		return;
	}
}

export async function promptReconfigure() {
	const message = `Ardesco settings have been changed.\n ` +
		`Would you like to re-configure the project?`;
	const yes = 'Yes';
	const no = "No";
	const response = await vscode.window.showInformationMessage(message, yes, no);
	if (response == yes) {
		vscode.commands.executeCommand("ardesco.configure");
		return true;
	}
	return false;
}
