import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspacePath } from './extension';

/**
 * Creates a cmake-kits.json for configuring the toolchain used by CMake Tools extension.
 * 
 * @param type type of process to execute e.g. build
 * @param name The name of the process to execute
 * @param cmd The command to execute within a shell.
 */
export default function writeCMakeKitsJson(toolchainName: string) {
    let config = vscode.workspace.getConfiguration('ardesco');
    let gnuToolchainPath: string = config.get('gnuarmembToolchainPath') || 'undefined';

    const cmakeKitsText = `
[
    {
        "name": "${toolchainName}",
        "compilers": {
            "C": "${gnuToolchainPath}/bin/arm-none-eabi-gcc",
            "CXX": "${gnuToolchainPath}/bin/arm-none-eabi-g++"
        }
    }
]
`;

    const workspacePath = getWorkspacePath()!;
    const vscodePath = path.join(workspacePath, '.vscode');
    if (!fs.existsSync(vscodePath))
        fs.mkdirSync(vscodePath);

    return new Promise<void>((resolve, reject) => {
        const jsonPath = path.join(vscodePath, 'cmake-kits.json');
        fs.writeFile(jsonPath, cmakeKitsText.trim(), err => {
            if (err) {
                return reject(err);
            }
            resolve();
        });
    });
}
