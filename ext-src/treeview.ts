import * as vscode from 'vscode';
import * as path from 'path';

let vsContext: vscode.ExtensionContext|null = null;

type ArdescoCommandDescription = {
  command: string,
  title: string
}

export class ArdescoCommandsProvider implements vscode.TreeDataProvider<ArdescoCommand> {

  constructor(context: vscode.ExtensionContext) {
    vsContext = context;
  }

  getTreeItem(element: ArdescoCommand): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ArdescoCommand): Thenable<ArdescoCommand[]> {
    if (element) {
      return Promise.resolve([]);
    } else {
        const packageJson = require(path.join(vsContext!.extensionPath, 'package.json'))
        const commandsJson: ArdescoCommandDescription[] = packageJson.contributes.commands;

        const commands = commandsJson.map((cmd) => new ArdescoCommand(
          cmd.title,
          { title: cmd.title, command: cmd.command },
          vscode.TreeItemCollapsibleState.None
        ));

        return Promise.resolve(commands);
    }
  }
}

class ArdescoCommand extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly command: vscode.Command,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }

  get tooltip(): string {
    return `${this.label}`;
  }

  iconPath = {
    light: path.join(vsContext!.extensionPath, 'resources', 'dot-circle.svg'),
    dark: path.join(vsContext!.extensionPath, 'resources', 'dot-circle.svg')
  };
}