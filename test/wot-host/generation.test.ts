// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { ChatMessage, parseResponse } from "../../src/wot/core/ai/enrich";
import { isJsonSchema, JsonObject, wotContext } from "../../src/wot/core/detect";
import { generateWithCopilot } from "../../src/wot/vscode/copilot";
import { configurationSection, configuredFolder, createSchemaFolder } from "../../src/wot/vscode/folders";
import { generateWithoutCopilot, loadValidator, schemaWorkspace } from "../../src/wot/vscode/generation";
import { SchemaEntries } from "../../src/wot/vscode/schemas";

suite("WoT extension-host flow", () => {
    const context = { extensionUri: vscode.Uri.file(path.resolve(__dirname, "../../..")) };
    const schema = { type: "object", properties: { temperature: { type: "number" } } };
    let workspace: vscode.WorkspaceFolder;
    let output: vscode.OutputChannel;
    let diagnostics: vscode.DiagnosticCollection;
    let count = 0;
    const created: vscode.Uri[] = [];
    const modelIds = new Set<string>();

    function promptBaseline(messages: ChatMessage[]): JsonObject {
        const marker = "\n\nBASELINE THING MODEL:\n";
        const start = messages[0].content.indexOf(marker);
        assert.ok(start >= 0);
        return parseResponse(messages[0].content.slice(start + marker.length));
    }

    async function eventually(predicate: () => boolean | Promise<boolean>, describe = () => ""): Promise<void> {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            if (await predicate()) {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.fail(`Timed out waiting for VS Code. ${describe()}`);
    }

    async function source(): Promise<vscode.Uri> {
        const uri = vscode.Uri.joinPath(configuredFolder(workspace, "schemaFolder"), `host-${++count}.json`);
        created.push(uri);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(schema)));
        return uri;
    }

    async function generated(uri: vscode.Uri): Promise<JsonObject> {
        const stem = path.posix.basename(uri.path, ".json");
        const modelUri = vscode.Uri.joinPath(configuredFolder(workspace, "modelFolder"), `${stem}.tm.json`);
        created.push(modelUri);
        assert.strictEqual(vscode.window.activeTextEditor.document.uri.toString(), modelUri.toString());
        const model: JsonObject = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(modelUri)).toString("utf8"));
        assert.ok(typeof model.id === "string");
        assert.match(model.id, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.ok(!modelIds.has(model.id), "Each generated model needs its own ID.");
        modelIds.add(model.id);
        return model;
    }

    suiteSetup(async function () {
        workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            this.skip();
            return;
        }
        output = vscode.window.createOutputChannel("WoT test report");
        diagnostics = vscode.languages.createDiagnosticCollection("wot-test");
        await vscode.workspace.getConfiguration(configurationSection, workspace.uri).update("promptOnNewSchema", false, vscode.ConfigurationTarget.Workspace);
        await createSchemaFolder(workspace.uri);
    });

    suiteTeardown(async () => {
        output?.dispose();
        diagnostics?.dispose();
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        for (const uri of created) {
            await vscode.workspace.fs.delete(uri);
        }
    });

    test("non-AI command writes and opens a valid Thing Model on disk", async () => {
        const uri = await source();
        await generateWithoutCopilot(context, output, uri);
        const model = await generated(uri);
        assert.deepStrictEqual((await loadValidator(context))(model), []);
        assert.strictEqual(vscode.window.activeTextEditor.document.languageId, "json");
    });

    test("Copilot result is validated, saved and opened without x-droppedFields", async () => {
        const uri = await source();
        let requests = 0;
        let suppliedId: unknown;
        await generateWithCopilot(context, output, diagnostics, uri, async () => ({
            request: async (messages) => {
                requests++;
                const model = promptBaseline(messages);
                suppliedId = model.id;
                return JSON.stringify({ ...model, "x-droppedFields": [] });
            },
        }));
        const model = await generated(uri);
        assert.strictEqual(requests, 1);
        assert.strictEqual(model.id, suppliedId);
        assert.ok(!("x-droppedFields" in model));
        assert.deepStrictEqual((await loadValidator(context))(model), []);
    });

    test("retry exhaustion still writes the best attempt and publishes Problems diagnostics", async () => {
        const uri = await source();
        let requests = 0;
        await generateWithCopilot(context, output, diagnostics, uri, async () => ({
            request: async (messages) => {
                requests++;
                const model = promptBaseline(messages);
                (model.properties as Record<string, JsonObject>).temperature.type = "string";
                return JSON.stringify(model);
            },
        }));
        await generated(uri);
        assert.strictEqual(requests, 3);
        const target = vscode.window.activeTextEditor.document.uri;
        assert.ok(diagnostics.get(target).some((diagnostic) => diagnostic.message.includes("Preserve baseline type")));
    });

    test("saved output retains its supplied ID even when Copilot omits it on every attempt", async () => {
        const uri = await source();
        let suppliedId: unknown;
        await generateWithCopilot(context, output, diagnostics, uri, async () => ({
            request: async (messages) => {
                const model = promptBaseline(messages);
                suppliedId = model.id;
                delete model.id;
                return JSON.stringify(model);
            },
        }));
        const model = await generated(uri);
        assert.strictEqual(model.id, suppliedId);
        assert.ok(diagnostics.get(vscode.window.activeTextEditor.document.uri).some((item) => item.message.includes("baseline ID has been restored")));
    });

    test("unavailable Copilot offers a baseline only with explicit fallback acceptance", async () => {
        const uri = await source();
        let offered = false;
        await generateWithCopilot(context, output, diagnostics, uri, async () => undefined, async (error) => {
            offered = true;
            assert.ok(error instanceof vscode.LanguageModelError);
            return true;
        });
        assert.ok(offered);
        const model = await generated(uri);
        assert.deepStrictEqual((await loadValidator(context))(model), []);
    });

    test("configuration scopes CodeLens and schema eligibility to the right workspace folder", async () => {
        const uri = await source();
        const state: vscode.Memento = {
            keys: () => [], get: <T>(_key: string, defaultValue?: T) => defaultValue,
            update: async () => undefined,
        };
        const entries = new SchemaEntries({ workspaceState: state });
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            assert.ok(schemaWorkspace(doc.uri), `Schema outside configured folder: ${doc.uri.toString()}`);
            assert.ok(isJsonSchema(JSON.parse(doc.getText())), `Unexpected source content: ${doc.getText()}`);
            assert.strictEqual(entries.provideCodeLenses(doc).length, 2);
            const config = vscode.workspace.getConfiguration(configurationSection, uri);
            await config.update("ai.enabled", false, vscode.ConfigurationTarget.Workspace);
            assert.strictEqual(entries.provideCodeLenses(doc).length, 1);
            assert.strictEqual(schemaWorkspace(vscode.Uri.joinPath(workspace.uri, "unrelated.json")), undefined);
            await config.update("schemaFolder", "custom/schemas", vscode.ConfigurationTarget.Workspace);
            assert.strictEqual(schemaWorkspace(uri), undefined);
            const custom = vscode.Uri.joinPath(workspace.uri, "custom", "schemas", "sensor.json");
            assert.strictEqual(schemaWorkspace(custom).uri.toString(), workspace.uri.toString());
        } finally {
            entries.dispose();
            const config = vscode.workspace.getConfiguration(configurationSection, workspace.uri);
            await config.update("schemaFolder", undefined, vscode.ConfigurationTarget.Workspace);
            await config.update("ai.enabled", undefined, vscode.ConfigurationTarget.Workspace);
        }
    });

    test("JSON completion and validation use the bundled schema when a Thing Model opens", async () => {
        await vscode.extensions.getExtension("vscode.json-language-features").activate();
        const uri = vscode.Uri.joinPath(configuredFolder(workspace, "modelFolder"), "completion.tm.json");
        created.push(uri);
        await vscode.workspace.fs.writeFile(uri, Buffer.from('{\n"title": 23,\n  \n}\n'));
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        let labels: string[] = [];
        await eventually(async () => {
            const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
                "vscode.executeCompletionItemProvider", uri, new vscode.Position(2, 2));
            labels = completions?.items.map((item) => typeof item.label === "string" ? item.label : item.label.label) || [];
            return labels.some((label) => label.includes("properties"));
        }, () => `Completion labels: ${JSON.stringify(labels)}`);
        await eventually(() => vscode.languages.getDiagnostics(uri).some((diagnostic) =>
            diagnostic.message.includes('Expected "string"')),
        () => `Diagnostics: ${JSON.stringify(vscode.languages.getDiagnostics(uri).map((item) => ({ source: item.source, message: item.message })))}`);
    });

    test("live validation underlines missing and invalid IDs and clears errors on unsaved edits", async () => {
        await vscode.extensions.getExtension("vsciot-vscode.azure-iot-toolkit").activate();
        const uri = vscode.Uri.joinPath(configuredFolder(workspace, "modelFolder"), "live-validation.tm.json");
        created.push(uri);
        const model: JsonObject = { "@context": wotContext, "@type": "tm:ThingModel", title: "Live sensor" };
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(model, null, 2)));
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        const issues = () => vscode.languages.getDiagnostics(document.uri).filter((item) => item.source === "WoT");
        await eventually(() => issues().some((item) => item.code === "wot.id.required"));
        const missing = issues().find((item) => item.code === "wot.id.required");
        assert.strictEqual(missing.severity, vscode.DiagnosticSeverity.Error);
        assert.strictEqual(document.getText(missing.range), "{");

        async function replace(value: JsonObject): Promise<void> {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
                JSON.stringify(value, null, 2));
            assert.ok(await vscode.workspace.applyEdit(edit));
        }

        await replace({ ...model, id: "urn:example:live-sensor" });
        await eventually(() => issues().length === 0);
        assert.ok(document.isDirty, "The correction must be validated before saving.");
        await replace({ ...model, id: "relative.tm.json" });
        await eventually(() => issues().some((item) => item.code === "wot.id.absolute"));
        const invalid = issues().find((item) => item.code === "wot.id.absolute");
        assert.strictEqual(invalid.severity, vscode.DiagnosticSeverity.Error);
        assert.strictEqual(document.getText(invalid.range), '"relative.tm.json"');

        await replace({ ...model, id: "urn:example:live-sensor", title: 23 });
        await eventually(() => issues().some((item) => item.code === "wot.schema.type"));
        await replace({ ...model, id: "urn:example:live-sensor" });
        await eventually(() => issues().length === 0);
        assert.ok(await document.save());
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        await eventually(() => issues().length === 0);
    });

    test("live validation reports syntax errors but does not apply model rules to unrelated JSON", async () => {
        await vscode.extensions.getExtension("vsciot-vscode.azure-iot-toolkit").activate();
        const invalidUri = vscode.Uri.joinPath(configuredFolder(workspace, "modelFolder"), "live-syntax.tm.json");
        const unrelatedUri = vscode.Uri.joinPath(workspace.uri, "unrelated-authoring.json");
        created.push(invalidUri, unrelatedUri);
        await vscode.workspace.fs.writeFile(invalidUri, Buffer.from('{"id":'));
        const invalid = await vscode.workspace.openTextDocument(invalidUri);
        await vscode.window.showTextDocument(invalid);
        await eventually(() => vscode.languages.getDiagnostics(invalid.uri).some((item) => item.source === "WoT" && item.code === "wot.json.syntax"));
        await vscode.workspace.fs.writeFile(unrelatedUri, Buffer.from('{"title":"Not a Thing Model"}'));
        const unrelated = await vscode.workspace.openTextDocument(unrelatedUri);
        await vscode.window.showTextDocument(unrelated);
        const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>("vscode.executeCodeLensProvider", unrelated.uri);
        assert.ok(!lenses?.some((lens) => lens.command?.command.startsWith("azure-iot-toolkit.wot.")));
        assert.ok(!vscode.languages.getDiagnostics(unrelated.uri).some((item) => item.source === "WoT"));
    });

    test("multi-root folders use independent settings and output locations", async function () {
        const second = vscode.workspace.workspaceFolders?.[1];
        if (!second) {
            this.skip();
            return;
        }
        const config = vscode.workspace.getConfiguration(configurationSection, second.uri);
        await config.update("schemaFolder", "device/schemas", vscode.ConfigurationTarget.WorkspaceFolder);
        await config.update("modelFolder", "device/models", vscode.ConfigurationTarget.WorkspaceFolder);
        await createSchemaFolder(second.uri);
        const uri = vscode.Uri.joinPath(configuredFolder(second, "schemaFolder"), "second.json");
        created.push(uri);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(schema)));
        assert.strictEqual(schemaWorkspace(uri).uri.toString(), second.uri.toString());
        await generateWithoutCopilot(context, output, uri);
        const modelUri = vscode.Uri.joinPath(configuredFolder(second, "modelFolder"), "second.tm.json");
        created.push(modelUri);
        assert.strictEqual(vscode.window.activeTextEditor.document.uri.fsPath, modelUri.fsPath);
        assert.strictEqual(configuredFolder(workspace, "schemaFolder").fsPath, vscode.Uri.joinPath(workspace.uri, "wot", "schemas").fsPath);
        await config.update("schemaFolder", "../outside", vscode.ConfigurationTarget.WorkspaceFolder);
        assert.throws(() => configuredFolder(second, "schemaFolder"), /workspace-relative/);
        await config.update("schemaFolder", "device/schemas", vscode.ConfigurationTarget.WorkspaceFolder);
    });

    test("schema notifications remember per-file answers and Don't ask again disables prompts", async () => {
        const uri = await source();
        const config = vscode.workspace.getConfiguration(configurationSection, workspace.uri);
        await config.update("promptOnNewSchema", true, vscode.ConfigurationTarget.Workspace);
        const values = new Map<string, unknown>();
        const state: vscode.Memento = {
            keys: () => [...values.keys()],
            get: <T>(key: string, defaultValue?: T) => values.has(key) ? values.get(key) as T : defaultValue,
            update: async (key, value) => { values.set(key, value); },
        };
        let prompts = 0;
        let entries = new SchemaEntries({ workspaceState: state }, async () => { prompts++; return "notNow"; });
        async function save(uri: vscode.Uri): Promise<void> {
            const document = await vscode.workspace.openTextDocument(uri);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, document.positionAt(document.getText().length), "\n");
            assert.ok(await vscode.workspace.applyEdit(edit));
            assert.ok(await document.save());
        }
        try {
            await entries.refresh();
            assert.strictEqual(prompts, 0, "Opening/scanning a schema must not prompt.");
            await save(uri);
            await eventually(() => prompts === 1, () => `First save: prompts=${prompts}, state=${JSON.stringify([...values])}`);
            entries.dispose();
            entries = new SchemaEntries({ workspaceState: state }, async () => {
                prompts++;
                return "never";
            });
            await entries.refresh();
            await save(uri);
            const other = await source();
            await save(other);
            await eventually(() => !vscode.workspace.getConfiguration(configurationSection, workspace.uri).get<boolean>("promptOnNewSchema"),
                () => `Don't ask again: prompts=${prompts}, state=${JSON.stringify([...values])}`);
            assert.strictEqual(prompts, 2, "Only the new file should prompt again.");
            await save(other);
            assert.strictEqual(prompts, 2);
        } finally {
            entries.dispose();
            await config.update("promptOnNewSchema", false, vscode.ConfigurationTarget.Workspace);
        }
    });
});
