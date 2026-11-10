// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as path from "path";
import { randomUUID } from "crypto";
import { parse, ParseError, printParseErrorCode } from "jsonc-parser";
import * as vscode from "vscode";
import { TelemetryClient } from "../../telemetryClient";
import { Conversion, convertSchema } from "../core/converter/convert";
import { isJsonSchema, JsonObject } from "../core/detect";
import { Cancellation, GenerationCancelled, saveModel } from "../core/output";
import { createModelValidator, ModelValidator, ValidationIssue } from "../core/validate";
import { configuredFolder } from "./folders";

export function schemaWorkspace(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    const workspace = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspace || !uri.path.endsWith(".json") || uri.path.endsWith(".tm.json")) {
        return undefined;
    }
    const folder = configuredFolder(workspace, "schemaFolder");
    const windowsFile = process.platform === "win32" && uri.scheme === "file";
    const filePath = windowsFile ? uri.path.toLowerCase() : uri.path;
    const folderPath = windowsFile ? folder.path.toLowerCase() : folder.path;
    return uri.scheme === folder.scheme && uri.authority === folder.authority && filePath.startsWith(folderPath.replace(/\/$/, "") + "/")
        ? workspace : undefined;
}

export function readSchema(text: string): JsonObject {
    const errors: ParseError[] = [];
    const schema: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length) {
        throw new Error(`Invalid JSON Schema: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}.`);
    }
    if (!isJsonSchema(schema)) {
        throw new Error("The selected document is not a JSON Schema.");
    }
    return schema;
}

export async function loadValidator(context: Pick<vscode.ExtensionContext, "extensionUri">): Promise<ModelValidator> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, "resources", "wot", "tm-json-schema-validation.json"));
    return createModelValidator(JSON.parse(Buffer.from(bytes).toString("utf8")));
}

export async function writeAndOpenModel(
    workspace: vscode.WorkspaceFolder, stem: string, model: JsonObject, token: Cancellation,
): Promise<vscode.TextDocument | undefined> {
    const folder = configuredFolder(workspace, "modelFolder");
    const name = await saveModel(stem, JSON.stringify(model, null, 2) + "\n", {
        exists: async (name) => {
            try {
                await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, name));
                return true;
            } catch (error) {
                if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
                    return false;
                }
                throw error;
            }
        },
        confirm: async () => {
            const answer = await vscode.window.showWarningMessage(vscode.l10n.t("The Thing Model already exists."),
                { modal: true }, vscode.l10n.t("Overwrite"), vscode.l10n.t("Keep both"));
            return answer === vscode.l10n.t("Overwrite") ? "overwrite" : answer === vscode.l10n.t("Keep both") ? "keepBoth" : "cancel";
        },
        write: async (name, text, overwrite) => {
            await vscode.workspace.fs.createDirectory(folder);
            const uri = vscode.Uri.joinPath(folder, name);
            // WorkspaceEdit's createFile honors overwrite:false, including files created after the prompt.
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(uri, { overwrite, contents: Buffer.from(text) });
            if (!await vscode.workspace.applyEdit(edit)) {
                throw new Error("Could not write the Thing Model. The destination may have changed.");
            }
        },
    }, token);
    if (!name) {
        return undefined;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, name));
    await vscode.window.showTextDocument(document);
    return document;
}

export function showReport(output: vscode.OutputChannel, conversion: Conversion, issues: ValidationIssue[], model: JsonObject): void {
    const kept = Object.keys(model.properties || {}).length + Object.keys(model.events || {}).length;
    output.clear();
    output.appendLine(JSON.stringify({ kept, ...conversion.report, issues }, null, 2));
    const message = vscode.l10n.t("Thing Model: {0} fields kept, {1} dropped, {2} items needing input, {3} issues remaining.",
        kept, conversion.report.droppedFields.length, conversion.report.needsInput.length, issues.length);
    const notify = issues.length ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    void notify(message, vscode.l10n.t("View report")).then((answer) => {
        if (answer) {
            output.show();
        }
    });
}

export async function generateWithoutCopilot(
    context: Pick<vscode.ExtensionContext, "extensionUri">, output: vscode.OutputChannel, uri?: vscode.Uri,
): Promise<void> {
    uri = uri || vscode.window.activeTextEditor?.document.uri;
    const workspace = uri && schemaWorkspace(uri);
    if (!workspace) {
        throw new Error("Select a JSON Schema file inside the configured WoT schema folder.");
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const stem = path.posix.basename(uri.path, ".json");
    const validate = await loadValidator(context);
    const conversion = convertSchema({ id: `urn:uuid:${randomUUID()}`, name: stem, schema: readSchema(document.getText()) }, validate);
    const written = await writeAndOpenModel(workspace, stem, conversion.model, { isCancellationRequested: false });
    if (written) {
        showReport(output, conversion, [], conversion.model);
        void TelemetryClient.sendEvent("wot.generate", { mode: "deterministic", outcome: "success" });
    }
}

export async function reportCommandError(error: unknown): Promise<void> {
    if (error instanceof GenerationCancelled || error instanceof vscode.CancellationError) {
        return;
    }
    await vscode.window.showErrorMessage(vscode.l10n.t("WoT: {0}", error instanceof Error ? error.message : String(error)));
}
