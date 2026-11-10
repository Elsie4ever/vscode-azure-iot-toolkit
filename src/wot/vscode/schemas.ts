// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import { parse, ParseError } from "jsonc-parser";
import * as vscode from "vscode";
import { isJsonSchema } from "../core/detect";
import { configurationSection, configuredFolder } from "./folders";
import { reportCommandError, schemaWorkspace } from "./generation";

export const generateCommand = "azure-iot-toolkit.wot.generate";
export const copilotCommand = "azure-iot-toolkit.wot.generateWithCopilot";

type PromptAnswer = "generate" | "notNow" | "never" | undefined;

async function showSchemaPrompt(): Promise<PromptAnswer> {
    const generate = vscode.l10n.t("Generate Thing Model");
    const notNow = vscode.l10n.t("Not now");
    const never = vscode.l10n.t("Don't ask again");
    const answer = await vscode.window.showInformationMessage(
        vscode.l10n.t("Generate Thing Model using Copilot?"), generate, notNow, never);
    return answer === generate ? "generate" : answer === never ? "never" : answer === notNow ? "notNow" : undefined;
}

function validSchema(text: string): boolean {
    const errors: ParseError[] = [];
    const value: unknown = parse(text, errors, { allowTrailingComma: true });
    return !errors.length && isJsonSchema(value);
}

export class SchemaEntries implements vscode.Disposable, vscode.CodeLensProvider {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly watchers: vscode.Disposable[] = [];
    private readonly files = new Set<string>();
    private readonly changed = new vscode.EventEmitter<void>();
    private readonly pendingPrompts = new Set<string>();
    private generation = 0;
    public readonly onDidChangeCodeLenses = this.changed.event;

    constructor(
        private readonly context: Pick<vscode.ExtensionContext, "workspaceState">,
        private readonly prompt: () => Promise<PromptAnswer> = showSchemaPrompt,
    ) {
        this.disposables.push(this.changed,
            vscode.workspace.onDidSaveTextDocument((document) => {
                void this.inspect(document.uri, true, document.getText()).catch(reportCommandError);
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.refresh().catch(reportCommandError); }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration(configurationSection)) {
                    void this.refresh().catch(reportCommandError);
                }
            }),
            vscode.languages.registerCodeLensProvider([{ language: "json" }, { language: "jsonc" }], this));
    }

    public async refresh(): Promise<void> {
        const generation = ++this.generation;
        this.watchers.splice(0).forEach((watcher) => watcher.dispose());
        this.files.clear();
        await this.publish();
        for (const workspace of vscode.workspace.workspaceFolders || []) {
            if (generation !== this.generation) {
                return;
            }
            const folder = configuredFolder(workspace, "schemaFolder");
            const pattern = new vscode.RelativePattern(folder, "**/*.json");
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            let ready = false;
            const changed = (uri: vscode.Uri) => { void this.inspect(uri, ready).catch(reportCommandError); };
            const created = (uri: vscode.Uri) => { void this.inspect(uri, ready && !this.files.has(uri.fsPath)).catch(reportCommandError); };
            this.watchers.push(watcher, watcher.onDidCreate(created), watcher.onDidChange(changed),
                watcher.onDidDelete((uri) => {
                    this.files.delete(uri.fsPath);
                    void this.publish().catch(reportCommandError);
                }));
            const files = await vscode.workspace.findFiles(pattern);
            for (const uri of files) {
                if (generation !== this.generation) {
                    return;
                }
                await this.inspect(uri, false, undefined, generation);
            }
            ready = true;
        }
        this.changed.fire();
    }

    private async publish(): Promise<void> {
        await vscode.commands.executeCommand("setContext", "azure-iot-toolkit.wot.schemaFiles", [...this.files]);
        this.changed.fire();
    }

    private async inspect(uri: vscode.Uri, prompt: boolean, text?: string, generation = this.generation): Promise<void> {
        const workspace = schemaWorkspace(uri);
        if (!workspace) {
            return;
        }
        if (text === undefined) {
            try {
                text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
            } catch (error) {
                if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
                    return;
                }
                throw error;
            }
        }
        if (generation !== this.generation) {
            return;
        }
        if (!validSchema(text)) {
            this.files.delete(uri.fsPath);
            await this.publish();
            return;
        }
        this.files.add(uri.fsPath);
        await this.publish();
        if (!prompt) {
            return;
        }
        const config = vscode.workspace.getConfiguration(configurationSection, uri);
        const identity = process.platform === "win32" && uri.scheme === "file" ? uri.toString().toLowerCase() : uri.toString();
        const key = `wot.schemaPrompt:${identity}`;
        if (!config.get<boolean>("ai.enabled", true) || !config.get<boolean>("promptOnNewSchema", true) ||
            this.context.workspaceState.get(key) || this.pendingPrompts.has(key)) {
            return;
        }
        this.pendingPrompts.add(key);
        try {
            await this.context.workspaceState.update(key, "shown");
            const answer = await this.prompt();
            await this.context.workspaceState.update(key, answer || "dismissed");
            if (answer === "never") {
                await config.update("promptOnNewSchema", false,
                    vscode.workspace.workspaceFile ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace);
            } else if (answer === "generate") {
                await vscode.commands.executeCommand(copilotCommand, uri);
            }
        } finally {
            this.pendingPrompts.delete(key);
        }
    }

    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!schemaWorkspace(document.uri) || !validSchema(document.getText())) {
            return [];
        }
        const range = new vscode.Range(0, 0, 0, 0);
        const lenses = [new vscode.CodeLens(range, {
            command: generateCommand, title: vscode.l10n.t("Generate Thing Model (without Copilot)"), arguments: [document.uri],
        })];
        if (vscode.workspace.getConfiguration(configurationSection, document.uri).get<boolean>("ai.enabled", true)) {
            lenses.unshift(new vscode.CodeLens(range, {
                command: copilotCommand, title: vscode.l10n.t("Generate Thing Model using Copilot"), arguments: [document.uri],
            }));
        }
        return lenses;
    }

    public dispose(): void {
        ++this.generation;
        this.watchers.splice(0).forEach((watcher) => watcher.dispose());
        this.disposables.forEach((disposable) => disposable.dispose());
    }
}
