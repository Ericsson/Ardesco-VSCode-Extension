// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cmakeToolsAPI from './cmake-tools/api'
import {setup, configure, clean, build, flash, debug, createApplication, install, checkUpdates, openProject, openTerminal, handleConfigChange, isConfiguring} from './commands';
import {selectBoard, selectBoardChip, selectSecureBuildMode} from './commands';
import { getZephyrBoardSpec, doesAllowNonSecureBuild, getBoardChip, Board, BoardChip, getBoard } from './boards';
import which = require('which');
import { WebView, WebViewIcon } from './webview';
import { ArdescoCommandsProvider } from './treeview';

let boardSelectItem: vscode.StatusBarItem;
let boardChipSelectItem: vscode.StatusBarItem;
let secureSelectItem: vscode.StatusBarItem;
export let buildButtonItem: vscode.StatusBarItem;
export let flashButtonItem: vscode.StatusBarItem;
export let debugButtonItem: vscode.StatusBarItem;

export function getZephyrBasePath(): string|null {
	const config = vscode.workspace.getConfiguration('ardesco');

	// If there is an explicit ardesco.zephyr.base option, then use it.
	let zephyrBase: string|undefined = config.get('zephyr.base', '');
	if (zephyrBase)
		return zephyrBase;

	// Else look for it as the ZEPHYR_BASE environment variable.
	zephyrBase = process.env.ZEPHYR_BASE;
	return zephyrBase ?? null;
}

export function getArdescoSDKPath(): string|null {
	const config = vscode.workspace.getConfiguration('ardesco');

	// If there is an explicit ardesco.sdk.base option, then use it.
	let sdkBase: string = config.get("sdk.base", '');
	if (sdkBase)
		return sdkBase;

	const zephyrBase = getZephyrBasePath();
	if (!zephyrBase)
		return null;

	sdkBase = path.join(zephyrBase, 'ardesco');
	try {
		fs.statSync(sdkBase);
		return sdkBase;
	} catch {
		return null;
	}
}

export function hasValidArdescoSDK(): boolean {
	const sdkPath = getArdescoSDKPath();
	if (!sdkPath)
		return false;

	try {
		fs.statSync(sdkPath);
		return true;
	} catch {
		return false;
	}
}

export function getArdescoSDKCurrentVersion(): string|null {
	const sdkPath = getArdescoSDKPath();
	if (!sdkPath)
		return null;
		
	// Extract the SDK version from the ardesco.cmake file.
	const ardescoCmake = path.join(sdkPath, 'ardesco.cmake');
	try {
		const contents = fs.readFileSync(ardescoCmake, 'utf8');

		// Version contants look like the following.
		// set (ARDESCO_SDK_VERSION_MAJOR "1")
		// set (ARDESCO_SDK_VERSION_MINOR "2")
		// set (ARDESCO_SDK_VERSION_PATCH "0")

		const majorVersionRegex = /set \(ARDESCO_SDK_VERSION_MAJOR \"(\d)"\)/g;
		const majorVersion = majorVersionRegex.exec(contents);

		const minorVersionRegex = /set \(ARDESCO_SDK_VERSION_MINOR \"(\d)"\)/g;
		const minorVersion = minorVersionRegex.exec(contents);

		const patchVersionRegex = /set \(ARDESCO_SDK_VERSION_PATCH \"(\d)"\)/g;
		const patchVersion = patchVersionRegex.exec(contents);

		if (!majorVersion || !minorVersion || !patchVersion)
			return null;

		return `${majorVersion[1]}.${minorVersion[1]}.${patchVersion[1]}`;
	} catch {
		return null;
	}
}

export function getArdescoSDKUpdateServer() {
	const config = vscode.workspace.getConfiguration('ardesco');
	const updateServer = config.get("updateServer");
	return updateServer;
}

export async function getGDBServerPath(): Promise<string|null> {
	// If the user has set an explicit path in the config, then use it.
	const config = vscode.workspace.getConfiguration('ardesco');
	const jlinkGdbServerPath: string|undefined = config.get('JLinkGDBServerPath');
	// Check if the path is actually valid.
	if (jlinkGdbServerPath && fs.existsSync(jlinkGdbServerPath)) {
		return jlinkGdbServerPath;
	}

	// If not, then auto-detect it from various locations.

	// First search in the PATH.
	const extension = process.platform == 'win32' ? '.exe' : '';
	const resolved = which.sync('JLinkGDBServerCLExe' + extension, {nothrow: true})
	if (resolved != null)
		return resolved;

	// Finally search for default locations on the OS.
	const platform = process.platform;
	if (platform == "win32") {
		const seggerBasePath = 'C:\\Program Files\\SEGGER\\'
		const dirs = await fs.promises.readdir(seggerBasePath);
		dirs.sort((a, b) => b.localeCompare(a));
		const basePath = dirs.length > 0 ? path.join(seggerBasePath, dirs[0]) : null;
		if (basePath && fs.existsSync(basePath))
			return path.join(basePath, 'JLinkGDBServerCL', extension)
	} else if(platform == "darwin") {
		const basePath = '/Applications/SEGGER/JLink'
		if (fs.existsSync(basePath))
			return path.join(basePath, 'JLinkGDBServerCLExe')
	} else if(platform == "linux") {
		const basePath = '/opt/SEGGER/JLink'
		if (fs.existsSync(basePath))
			return path.join(basePath, 'JLinkGDBServerCLExe')
	}

	return null;
}

export async function getNRFJProgPath(): Promise<string|null> {
	// If the user has set an explicit path in the config, then use it.
	const config = vscode.workspace.getConfiguration('ardesco');
	const nrfjprogConfig: string|undefined = await config.get('nrfjprog');
	// Check if the path is actually valid.
	if (nrfjprogConfig && fs.existsSync(nrfjprogConfig)) {
		return nrfjprogConfig;
	}

	// If not, then auto-detect it from various locations.

	// First search in the PATH.
	const extension = process.platform == 'win32' ? '.exe' : '';
	const resolved = which.sync('nrfjprog' + extension, {nothrow: true})
	if (resolved != null)
		return resolved;

	// Then search relative to the Ardesco SDK.
	const ardescoSDKPath = getArdescoSDKPath();
	if (ardescoSDKPath) {
		const dirs = await fs.promises.readdir(ardescoSDKPath);
		dirs.sort((a, b) => b.localeCompare(a));

		let validDir : string|null = null;
		dirs.forEach(d => {
			if (d.startsWith("nRF-Command-Line-Tools") && validDir == null)
				validDir = d;
		});

		if (validDir) {
			return path.join(ardescoSDKPath, validDir, 'nrfjprog', 'nrfjprog' + extension);
		}
	}

	// Finally search for default location on the OS.
	const platform = process.platform;
	if (platform == "win32") {
		const basePath = 'C:\\Program Files\\Nordic Semiconductor\\nrf-command-line-tools\\bin'
		if (fs.existsSync(basePath))
			return path.join(basePath, 'nrfjprog.exe');
	} else if(platform == "darwin") {
		const basePath = '/Applications/Nordic Semiconductor/nrfjprog'
		if (fs.existsSync(basePath))
			return path.join(basePath, 'nrfjprog');
	} else if(platform == "linux") {
		const basePath = '/opt/nrfjprog'
		if (fs.existsSync(basePath))
			return path.join(basePath, 'nrfjprog')
	}

	return null;
}

export function getWorkspacePath(): string|null {
	// Construct workspace path
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders) {
		return workspaceFolders[0].uri.fsPath;
	} else {
		// Not in a workspace, return
		console.log("Ardesco extension: Not in a workspace, returning.");
		return null;
	}
}

export function getBuildPath(): string|null {
	return "${workspaceRoot}" + path.sep + "build_" + getZephyrBoardSpec();
}

export function getExpandedBuildPath(): string|null {
	const workspacePath = getWorkspacePath();
	if (!workspacePath)
		return null;

	return workspacePath + path.sep + "build_" + getZephyrBoardSpec();
}

function ensureValidSettings() {
	let config = vscode.workspace.getConfiguration('ardesco');

	// Validate Ardesco SDK base
	if (!hasValidArdescoSDK()) {
		vscode.window.showErrorMessage('Ardesco SDK base path invalid, update in settings and then close/reopen folder.');
		return;
	}

	// Validate Zephyr base
	try {
		const zephyrBase = getZephyrBasePath() || '';
		fs.statSync(zephyrBase);
	} catch {
		vscode.window.showErrorMessage('Zephyr base path invalid, update in settings and then close/reopen folder.');
		return;
	}

	// Validate gnuarmemb toolchain directory
	try {
		const gnuarmembToolchainPath: string = config.get('gnuarmembToolchainPath', '');
		fs.statSync(gnuarmembToolchainPath);
	} catch {
		vscode.window.showErrorMessage('GNU ARM Embedded toolchain path invalid, update in settings and then close/reopen folder.');
		return;
	}

	/*
	// Ensure board and chip were selected
	let board: string = config.get('board.name', '');
	let chip: string = config.get('board.chip', '');
	if (!board || !chip) {
		vscode.window.showErrorMessage('Please select target board and chip in settings and then close/reopen folder.');
		return;
	}
	*/

	//vscode.window.showInformationMessage("Ardesco launched");
}

function getSecureBuildMode(): boolean {
	let config = vscode.workspace.getConfiguration('ardesco');
	return config.get('board.secureBuild') || false;
}

function createStatusBarItems() {
	boardSelectItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 11);
	boardSelectItem.tooltip = "Change the Ardesco board target";
	boardSelectItem.command = "ardesco.board";
	boardSelectItem.show();

	boardChipSelectItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10.9);
	boardChipSelectItem.tooltip = "Change the Ardesco board chip target";
	boardChipSelectItem.command = "ardesco.board.chip";
	boardChipSelectItem.show();

	secureSelectItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10.8);
	secureSelectItem.tooltip = "Change the Ardesco secure build mode";
	secureSelectItem.command = "ardesco.secure";
	secureSelectItem.show();

	buildButtonItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10.7);
	buildButtonItem.tooltip = "Build Ardesco target";
	buildButtonItem.command = "ardesco.build";
	updateBuildButtonItem(true);
	buildButtonItem.show();

	flashButtonItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10.6);
	flashButtonItem.tooltip = "Flash Ardesco target";
	flashButtonItem.command = "ardesco.flash";
	updateFlashButtonItem(FlashOperation.None);
	flashButtonItem.show();

	debugButtonItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10.5);
	debugButtonItem.tooltip = "Debug Ardesco target";
	debugButtonItem.command = "ardesco.debug";
	debugButtonItem.text = "$(debug) Debug";
	debugButtonItem.show();
}

export async function updateStatusBarItems() {
	await updateBoardSelectItem(getBoard());
	const chip = getBoardChip();
	await updateBoardChipSelectItem(chip);
	await updateSecureSelectItem(chip);
}

export enum FlashOperation {
	None,
	Erase,
	Program,
	Error
}

export async function updateFlashButtonItem(op: FlashOperation) {
	switch(op) {
	case FlashOperation.None:
		flashButtonItem.text = "$(database) Flash";
		flashButtonItem.color = undefined;
		break;
	case FlashOperation.Erase:
		flashButtonItem.text = "$(database) Erasing...";
		//flashButtonItem.color = new vscode.ThemeColor('errorForeground');
		break;
	case FlashOperation.Program:
		flashButtonItem.text = "$(database) Programming...";
		break;
	case FlashOperation.Error:
		flashButtonItem.text = "$(database) Error flashing ";
		break;
	}

	flashButtonItem.show();
	return true;
}

export async function updateBuildButtonItem(isBuild: boolean) {
	const text = isBuild ?  "$(gear) Build" : "$(dialog-close) Stop";
	buildButtonItem.text = text;
	buildButtonItem.show();
	return true;
}

export async function updateBoardSelectItem(board: Board) {
	boardSelectItem.text = `$(circuit-board) Board: ${board.name}`;
	boardSelectItem.show();
	return true;
}

export async function updateBoardChipSelectItem(chip: BoardChip) {
	boardChipSelectItem.text = `$(screen-full) Chip: ${chip.name}`;
	boardChipSelectItem.show();
	return true;
}

export async function updateSecureSelectItem(chip: BoardChip) {
	secureSelectItem.text = `$(lock) Secure Build: ${getSecureBuildMode() ? "Yes" : "No"}`;

	if (doesAllowNonSecureBuild(chip))
		secureSelectItem.show();
	else
		secureSelectItem.hide();

	return true;
}

export let ardescoOutputChannel: vscode.OutputChannel;

export let globalStoragePath: string = '';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	const cmakeToolsExt = vscode.extensions.getExtension<cmakeToolsAPI.ExtAPI>("ms-vscode.cmake-tools");
	if (!cmakeToolsExt) {
		vscode.window.showErrorMessage("CMake Tools extension was not found.")
		return undefined
	}

	// Disable CMake Tools extension F7 build keybindings which conflict with our own.
	vscode.commands.executeCommand('setContext', "cmake:hideBuildCommand", true);

	globalStoragePath = context.globalStoragePath;

	ensureValidSettings();
	createStatusBarItems();
	updateStatusBarItems();

	registerCommands(context);

	ardescoOutputChannel = vscode.window.createOutputChannel("Ardesco");

	vscode.window.registerTreeDataProvider('ardescoCommands',
		new ArdescoCommandsProvider(context));

	vscode.workspace.onDidChangeConfiguration(handleVSConfigChange());

	// Check if we have a valid Ardesco SDK. If so, then check for updates
	// if the user does not have it disabled, else then issue an install command.
	if (hasValidArdescoSDK()) {
		let config = vscode.workspace.getConfiguration('ardesco');
		let checkUpdates: boolean = config.get('checkForUpdates') || true;
		if (checkUpdates)
			vscode.commands.executeCommand("ardesco.checkUpdates");

		let shouldConfigure = false
		const workspacePath = getWorkspacePath();
		if (workspacePath) {
			const cmakeLists = path.join(workspacePath, "CMakeLists.txt");
			shouldConfigure = fs.existsSync(cmakeLists);

			const triggerFile = path.join(workspacePath, '.vscode', '.trigger');
			const shouldOpenFile = fs.existsSync(triggerFile);
			if (shouldOpenFile) {
				const entryFile = path.join(workspacePath, 'src', 'main.c');
				vscode.commands.executeCommand("vscode.open", vscode.Uri.file(entryFile));
				fs.unlinkSync(triggerFile);
			}
		}

		if (shouldConfigure)
			vscode.commands.executeCommand("ardesco.configure");
		else
			vscode.commands.executeCommand("ardesco.home");
	} else {
		vscode.commands.executeCommand("ardesco.install");
	}
}

function handleVSConfigChange(): (e: vscode.ConfigurationChangeEvent) => any {
	return event => {
		if (isConfiguring)
			return;

		if (event.affectsConfiguration("ardesco")) {
			handleConfigChange();
		}
		else if (event.affectsConfiguration("cmake")) {
			handleConfigChange();
		}
		else if (event.affectsConfiguration("C_Cpp")) {
			handleConfigChange();
		}
		else if (event.affectsConfiguration("cortex-debug")) {
			handleConfigChange();
		}
	};
}

function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('ardesco.board',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await selectBoard();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.board.chip',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await selectBoardChip();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.secure',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await selectSecureBuildMode();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.configure',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await configure();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.clean',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await clean();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.build',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await build();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.flash',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await flash();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.debug',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await debug();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.setup',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await setup();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.createApplication',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await createApplication();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.install',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await install();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.checkUpdates',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await checkUpdates();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.home',
		async () => new Promise(async (resolve, reject) => {
			try {
				const ericssonIcons: WebViewIcon = {
					light: vscode.Uri.file(path.join(context.extensionPath, 'resources', 'ericsson.svg')),
					dark: vscode.Uri.file(path.join(context.extensionPath, 'resources', 'ericsson.svg'))
				};

				WebView.createOrShow(context.extensionPath, "Ardesco", ericssonIcons);
				resolve();
			}
			catch (err) {
				reject(err);
			}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.showOutputLog',
	 async () => new Promise(async (resolve, reject) => {
		ardescoOutputChannel.show();
		resolve();
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.openProject',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await openProject();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));

	context.subscriptions.push(vscode.commands.registerCommand('ardesco.openTerminal',
	 async () => new Promise(async (resolve, reject) => {
		try {
			await openTerminal();
			resolve();
		}
		catch (err) {
			reject(err);
		}
	})));
}

// this method is called when your extension is deactivated
export function deactivate() { }
