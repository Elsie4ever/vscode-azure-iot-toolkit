// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import { findNodeAtLocation, getNodeValue, Node, parseTree, ParseError, printParseErrorCode } from "jsonc-parser";
import * as vscode from "vscode";
import { hasWotContext } from "../core/detect";
import { ModelValidator } from "../core/validate";

export function rangeForPointer(document: vscode.TextDocument, tree: Node | undefined, pointer: string): vscode.Range {
    let node = tree;
    for (const segment of pointer.split("/").slice(1)) {
        const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
        node = node && findNodeAtLocation(node, [node.type === "array" ? Number(key) : key]);
    }
    const start = node?.offset ?? tree?.offset ?? 0;
    const length = node?.length ?? Math.min(1, document.getText().length - start);
    return new vscode.Range(document.positionAt(start), document.positionAt(start + length));
}

export class ModelDiagnostics implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection("wot-authoring");
    private readonly subscriptions: vscode.Disposable[];
    private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(private readonly validate: ModelValidator) {
        this.subscriptions = [
            vscode.workspace.onDidOpenTextDocument((document) => this.update(document)),
            vscode.workspace.onDidSaveTextDocument((document) => this.update(document)),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (!event.contentChanges.length) {
                    return;
                }
                this.cancel(event.document.uri);
                const version = event.document.version;
                this.pending.set(event.document.uri.toString(), setTimeout(() => {
                    if (!event.document.isClosed && version === event.document.version) {
                        this.update(event.document);
                    }
                }, 300));
            }),
            vscode.workspace.onDidCloseTextDocument((document) => {
                this.cancel(document.uri);
                this.collection.delete(document.uri);
            }),
        ];
        vscode.workspace.textDocuments.forEach((document) => this.update(document));
    }

    private cancel(uri: vscode.Uri): void {
        const key = uri.toString();
        const timer = this.pending.get(key);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.pending.delete(key);
        }
    }

    private update(document: vscode.TextDocument): void {
        this.cancel(document.uri);
        const namedModel = document.uri.path.endsWith(".tm.json");
        if (!namedModel && !["json", "jsonc"].includes(document.languageId)) {
            this.collection.delete(document.uri);
            return;
        }
        const errors: ParseError[] = [];
        const tree = parseTree(document.getText(), errors, { allowTrailingComma: true });
        const model: unknown = tree && getNodeValue(tree);
        if (!namedModel && !hasWotContext(model)) {
            this.collection.delete(document.uri);
            return;
        }
        const diagnostics = errors.length ? errors.map((error) => {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(document.positionAt(error.offset), document.positionAt(error.offset + Math.max(1, error.length))),
                printParseErrorCode(error.error), vscode.DiagnosticSeverity.Error);
            diagnostic.code = "wot.json.syntax";
            return diagnostic;
        }) : this.validate(model).map((issue) => {
            const diagnostic = new vscode.Diagnostic(rangeForPointer(document, tree, issue.pointer), issue.message, vscode.DiagnosticSeverity.Error);
            diagnostic.code = issue.code || "wot.model.validation";
            return diagnostic;
        });
        diagnostics.forEach((diagnostic) => { diagnostic.source = "WoT"; });
        this.collection.set(document.uri, diagnostics);
    }

    public dispose(): void {
        this.pending.forEach((timer) => clearTimeout(timer));
        this.pending.clear();
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this.collection.dispose();
    }
}
