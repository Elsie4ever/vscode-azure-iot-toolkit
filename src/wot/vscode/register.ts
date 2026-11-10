// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as vscode from "vscode";
import { createSchemaFolder } from "./folders";
import { generateWithoutCopilot, loadValidator, reportCommandError } from "./generation";
import { generateWithCopilot } from "./copilot";
import { copilotCommand, SchemaEntries } from "./schemas";
import { ModelDiagnostics } from "./validation";

export function registerWot(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel("WoT Thing Models");
    const diagnostics = vscode.languages.createDiagnosticCollection("wot-generation");
    const entries = new SchemaEntries(context);
    context.subscriptions.push(output, diagnostics, entries,
        vscode.workspace.onDidChangeTextDocument((event) => diagnostics.delete(event.document.uri)),
        vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)));
    void entries.refresh().catch(reportCommandError);
    void loadValidator(context).then((validate) => {
        context.subscriptions.push(new ModelDiagnostics(validate));
    }).catch(reportCommandError);
    context.subscriptions.push(vscode.commands.registerCommand(copilotCommand, async (uri?: vscode.Uri) => {
        try {
            await generateWithCopilot(context, output, diagnostics, uri);
        } catch (error) {
            await reportCommandError(error);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("azure-iot-toolkit.wot.generate", async (uri?: vscode.Uri) => {
        try {
            await generateWithoutCopilot(context, output, uri);
        } catch (error) {
            await reportCommandError(error);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand("azure-iot-toolkit.wot.createSchemaFolder", async (uri?: vscode.Uri) => {
        try {
            await createSchemaFolder(uri);
        } catch (error) {
            await vscode.window.showErrorMessage(`WoT: ${error instanceof Error ? error.message : String(error)}`);
        }
    }));
}
