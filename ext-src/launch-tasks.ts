import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspacePath, getBuildPath } from './extension';
import { getBoardChip, BoardChip } from './boards';

/**
 * Creates a launch.json for debugging Ardesco/Nordic devices
 * using the cortex-debug extension
 * 
 * @param type type of process to execute e.g. build
 * @param name The name of the process to execute
 * @param cmd The command to execute within a shell.
 */
export default function writeLaunchJson() {
    const chip: BoardChip = getBoardChip();

    if (!chip.jlinkDevice) {
        vscode.window.showWarningMessage("Unknown J-Link chip device, debugging may have some issues...");
    }

    return new Promise<void>((resolve, reject) => {
        const exePath = getBuildPath()?.replace(path.sep, '/') + "/zephyr/zephyr.elf";
        const launchJsonText = `
{
    // Use IntelliSense to learn about possible attributes.
    // Hover to view descriptions of existing attributes.
    // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Cortex Debug",
            "cwd": "\${workspaceRoot}",
            "executable": "${exePath}",
            "request": "launch",
            "type": "cortex-debug",
            "servertype": "jlink",
            "device": "${chip.jlinkDevice}",
            "targetDownload": false,
            "overrideLaunchCommands": [
                "monitor halt",
                "monitor reset"
            ]
        }
    ]
}
`;

        const workspacePath = getWorkspacePath()!;
        const vscodePath = path.join(workspacePath, '.vscode');
        if (!fs.existsSync(vscodePath))
            fs.mkdirSync(vscodePath);

        const jsonPath: string = path.join(vscodePath, 'launch.json');
        fs.writeFile(jsonPath, launchJsonText.trim(), err => {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}