// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as path from "path";
import { randomUUID } from "crypto";
import { parseTree } from "jsonc-parser";
import * as vscode from "vscode";
import { TelemetryClient } from "../../telemetryClient";
import { enrichModel, LanguageModel } from "../core/ai/enrich";
import { promptVersion } from "../core/ai/prompt";
import { convertSchema } from "../core/converter/convert";
import { checkCancellation, GenerationCancelled } from "../core/output";
import { ValidationIssue } from "../core/validate";
import { configurationSection } from "./folders";
import { loadValidator, readSchema, schemaWorkspace, showReport, writeAndOpenModel } from "./generation";
import { rangeForPointer } from "./validation";

export async function selectCopilot(token: vscode.CancellationToken): Promise<LanguageModel | undefined> {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    checkCancellation(token);
    if (!models.length) {
        return undefined;
    }
    return {
        request: async (messages) => {
            const chat = messages.map((message) => message.role === "user"
                ? vscode.LanguageModelChatMessage.User(message.content) : vscode.LanguageModelChatMessage.Assistant(message.content));
            const response = await models[0].sendRequest(chat, {}, token);
            let text = "";
            for await (const chunk of response.text) {
                checkCancellation(token);
                text += chunk;
            }
            return text;
        },
    };
}

function publishIssues(collection: vscode.DiagnosticCollection, document: vscode.TextDocument, issues: ValidationIssue[]): void {
    const tree = parseTree(document.getText());
    collection.set(document.uri, issues.map((issue) => {
        const diagnostic = new vscode.Diagnostic(rangeForPointer(document, tree, issue.pointer),
            issue.message, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = "WoT generation";
        diagnostic.code = "wot.ai.validation";
        return diagnostic;
    }));
}

export async function generateWithCopilot(
    context: Pick<vscode.ExtensionContext, "extensionUri">, output: vscode.OutputChannel, diagnostics: vscode.DiagnosticCollection, uri?: vscode.Uri,
    select: (token: vscode.CancellationToken) => Promise<LanguageModel | undefined> = selectCopilot,
    offerFallback: (error: vscode.LanguageModelError) => Promise<boolean> = async (error) => {
        const answer = await vscode.window.showWarningMessage(
            vscode.l10n.t("Copilot is unavailable ({0}): {1}", error.code, error.message), vscode.l10n.t("Use non-Copilot result"));
        return !!answer;
    },
): Promise<void> {
    uri = uri || vscode.window.activeTextEditor?.document.uri;
    const workspace = uri && schemaWorkspace(uri);
    if (!workspace) {
        throw new Error("Select a JSON Schema file inside the configured WoT schema folder.");
    }
    if (!vscode.workspace.getConfiguration(configurationSection, uri).get<boolean>("ai.enabled", true)) {
        throw new Error("WoT Copilot generation is disabled in settings.");
    }
    const source = await vscode.workspace.openTextDocument(uri);
    const schema = readSchema(source.getText());
    const stem = path.posix.basename(uri.path, ".json");
    const validate = await loadValidator(context);
    const conversion = convertSchema({ id: `urn:uuid:${randomUUID()}`, name: stem, schema }, validate);
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, title: vscode.l10n.t("Generate Thing Model using Copilot"), cancellable: true,
    }, async (progress, token) => {
        checkCancellation(token);
        let model = conversion.model;
        let issues: ValidationIssue[] = [];
        let attempts = 0;
        let mode = "copilot";
        try {
            const lm = await select(token);
            if (!lm) {
                throw vscode.LanguageModelError.NotFound("No Copilot chat model is available. Sign in to GitHub Copilot and check model access.");
            }
            const result = await enrichModel(conversion, validate, lm, token, (attempt) => {
                progress.report({ message: vscode.l10n.t("Generating and validating (attempt {0} of 3)...", attempt) });
            });
            model = result.model;
            issues = result.issues;
            attempts = result.attempts;
            conversion.report.droppedFields = result.droppedFields;
        } catch (error) {
            checkCancellation(token);
            if (error instanceof GenerationCancelled || error instanceof vscode.CancellationError) {
                throw error;
            }
            if (!(error instanceof vscode.LanguageModelError)) {
                throw error;
            }
            if (!await offerFallback(error)) {
                return;
            }
            mode = "fallback";
        }
        checkCancellation(token);
        const document = await writeAndOpenModel(workspace, stem, model, token);
        if (document) {
            publishIssues(diagnostics, document, issues);
            showReport(output, conversion, issues, model);
            void TelemetryClient.sendEvent("wot.generate", {
                mode, outcome: issues.length ? "needsRepair" : "success", promptVersion,
            }, undefined, { attempts, issues: issues.length });
        }
    });
}
