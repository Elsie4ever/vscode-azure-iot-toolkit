// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as path from "path";
import * as vscode from "vscode";

export const configurationSection = "azure-iot-toolkit.wot";

export function configuredFolder(workspace: vscode.WorkspaceFolder, setting: "schemaFolder" | "modelFolder"): vscode.Uri {
    const fallback = setting === "schemaFolder" ? "wot/schemas" : "wot/models";
    const relative = vscode.workspace.getConfiguration(configurationSection, workspace.uri).get<string>(setting, fallback);
    if (!relative.trim() || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) ||
        relative.split(/[\\/]/).some((part) => part === "..") || /^[a-z][a-z0-9+.-]*:/i.test(relative)) {
        throw new Error(`WoT ${setting} must be a non-empty workspace-relative path without "..".`);
    }
    return vscode.Uri.joinPath(workspace.uri, ...relative.split(/[\\/]/));
}

export async function chooseWorkspace(uri?: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> {
    const containing = uri && vscode.workspace.getWorkspaceFolder(uri);
    if (containing) {
        return containing;
    }
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) {
        throw new Error("Open a workspace folder to use WoT authoring.");
    }
    return folders.length === 1 ? folders[0] : vscode.window.showWorkspaceFolderPick();
}

export async function createSchemaFolder(uri?: vscode.Uri): Promise<void> {
    const workspace = await chooseWorkspace(uri);
    if (!workspace) {
        return;
    }
    const schema = configuredFolder(workspace, "schemaFolder");
    const models = configuredFolder(workspace, "modelFolder");
    await vscode.workspace.fs.createDirectory(schema);
    await vscode.workspace.fs.createDirectory(models);
    const readme = vscode.Uri.joinPath(schema, "README.md");
    try {
        await vscode.workspace.fs.stat(readme);
    } catch (error) {
        if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") {
            throw error;
        }
        await vscode.workspace.fs.writeFile(readme, Buffer.from(
            "# WoT JSON Schemas\n\nSave device-data JSON Schemas (draft-07 or 2020-12) here.\n" +
            "Use Generate Thing Model using Copilot or Generate Thing Model (without Copilot).\n" +
            "Only explicit Copilot generation sends schema content to Copilot.\n"));
    }
    await vscode.commands.executeCommand("revealInExplorer", schema);
}
