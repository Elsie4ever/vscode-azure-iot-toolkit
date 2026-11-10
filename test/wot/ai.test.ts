// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as assert from "assert";
import { ChatMessage, checkAiOutput, enrichModel, LanguageModel, parseResponse } from "../../src/wot/core/ai/enrich";
import { buildPrompt, promptVersion } from "../../src/wot/core/ai/prompt";
import { convertSchema, Conversion } from "../../src/wot/core/converter/convert";
import { JsonObject } from "../../src/wot/core/detect";
import { GenerationCancelled, OutputStore, saveModel } from "../../src/wot/core/output";
import { sampleInput } from "./converter.test";
import { validateModel } from "./foundation.test";

const active = { isCancellationRequested: false };

function baseline(): Conversion {
    return convertSchema(sampleInput, validateModel);
}

function valid(conversion: Conversion): JsonObject {
    return JSON.parse(JSON.stringify({ ...conversion.model, "x-droppedFields": conversion.report.droppedFields }));
}

function fakeModel(replies: string[], calls: ChatMessage[][] = []): LanguageModel {
    return {
        request: async (messages) => {
            calls.push(messages.map((message) => ({ ...message })));
            return replies[Math.min(calls.length - 1, replies.length - 1)];
        },
    };
}

suite("WoT Copilot core", () => {
    test("versioned prompt includes group name, baseline and source, without deployment instructions", () => {
        const conversion = baseline();
        const prompt = buildPrompt(conversion);
        assert.strictEqual(promptVersion, "2");
        assert.ok(prompt.includes(`"id": "${conversion.model.id}"`));
        for (const text of ["DEVICE TYPE: Observed device", "SOURCE FIELDS:", "BASELINE THING MODEL:", "{{PLACEHOLDER}}"]) {
            assert.ok(prompt.includes(text));
        }
    });

    test("accepts valid first response, tolerates fences, and strips dropped-field extension", async () => {
        const conversion = baseline();
        const reply = "```json\n" + JSON.stringify(valid(conversion)) + "\n```";
        const result = await enrichModel(conversion, validateModel, fakeModel([reply]), active);
        assert.strictEqual(result.attempts, 1);
        assert.deepStrictEqual(result.issues, []);
        assert.ok(!("x-droppedFields" in result.model));
        assert.strictEqual(result.droppedFields.length, 11);
        assert.strictEqual(result.model.id, conversion.model.id);
        assert.throws(() => parseResponse("[]"), /one JSON object/);
    });

    test("repairs changed types and missing coverage with errors in the next request", async () => {
        const conversion = baseline();
        const wrong = valid(conversion);
        const properties = wrong.properties as Record<string, JsonObject>;
        properties.temperature.type = "string";
        delete properties.humidity;
        const calls: ChatMessage[][] = [];
        const result = await enrichModel(conversion, validateModel,
            fakeModel([JSON.stringify(wrong), JSON.stringify(valid(conversion))], calls), active);
        assert.strictEqual(result.attempts, 2);
        assert.deepStrictEqual(result.issues, []);
        assert.ok(calls[1][2].content.includes("Preserve baseline type"));
        assert.ok(calls[1][2].content.includes("humidity"));
    });

    test("checks nested object and array types, event data, missing reasons and forbidden keys", () => {
        const conversion = baseline();
        const wrong = valid(conversion);
        const properties = wrong.properties as Record<string, JsonObject>;
        const gps = properties.gpsLocation.properties as Record<string, JsonObject>;
        gps.lat.type = "string";
        wrong.events = { alert: { data: { type: "integer" } } };
        wrong.forms = [];
        wrong["x-droppedFields"] = [{ field: "assetTag", reason: "" }];
        const result = checkAiOutput(wrong, conversion, validateModel);
        assert.ok(result.issues.some((issue) => issue.pointer === "/properties/gpsLocation/properties/lat/type"));
        assert.ok(result.issues.some((issue) => issue.pointer === "/events/alert/data/type"));
        assert.ok(result.issues.some((issue) => issue.pointer === "/forms"));
        assert.ok(result.issues.some((issue) => issue.pointer === "/x-droppedFields/0"));
        const array = convertSchema({ id: "urn:example:array", name: "Array", schema: {
            type: "object", properties: { list: { type: "array", items: { type: "number" } } },
        } }, validateModel);
        const changed = valid(array);
        (changed.properties as Record<string, JsonObject>).list.items = { type: "string" };
        assert.ok(checkAiOutput(changed, array, validateModel).issues.some((issue) => issue.pointer.endsWith("/items/type")));
    });

    test("rejects altered links and treats an event alias as coverage of its original source field", () => {
        const conversion = convertSchema(sampleInput, validateModel, {
            id: "urn:example:alerts", name: "Alerts", fields: ["alertActive"], links: [{ rel: "tm:extends", href: "./base.tm.json" }],
        });

        const response = valid(conversion);
        assert.deepStrictEqual(checkAiOutput(response, conversion, validateModel).issues, []);
        response.links = [];
        assert.ok(checkAiOutput(response, conversion, validateModel).issues.some((issue) => issue.pointer === "/links"));
    });

    test("repairs omitted or changed IDs and restores the baseline ID even when retries are exhausted", async () => {
        const conversion = baseline();
        for (const id of [undefined, "relative.tm.json", "urn:example:changed"]) {
            const wrong = valid(conversion);
            if (id === undefined) {
                delete wrong.id;
            } else {
                wrong.id = id;
            }
            const calls: ChatMessage[][] = [];
            const repaired = await enrichModel(conversion, validateModel,
                fakeModel([JSON.stringify(wrong), JSON.stringify(valid(conversion))], calls), active);
            assert.strictEqual(repaired.attempts, 2);
            assert.strictEqual(repaired.model.id, conversion.model.id);
            assert.ok(calls[1][2].content.includes(String(conversion.model.id)));
            const exhausted = await enrichModel(conversion, validateModel, fakeModel([JSON.stringify(wrong)]), active);
            assert.strictEqual(exhausted.attempts, 3);
            assert.strictEqual(exhausted.model.id, conversion.model.id);
            assert.ok(exhausted.issues.some((issue) => issue.pointer === "/id"));
        }
    });

    test("rejects actions and referenced definitions in uploader-bound AI output", () => {
        const conversion = baseline();
        const response = valid(conversion);
        response.actions = {};
        (response.properties as Record<string, JsonObject>).temperature["tm:ref"] = "https://example.com/remote.tm.json#/properties/temperature";
        const issues = checkAiOutput(response, conversion, validateModel).issues;
        assert.ok(issues.some((issue) => issue.pointer === "/actions"));
        assert.ok(issues.some((issue) => issue.pointer === "/properties/temperature/tm:ref"));
    });

    test("exhausts exactly two repairs and still persists the best parseable attempt", async () => {
        const conversion = baseline();
        const wrong = valid(conversion);
        delete (wrong.properties as JsonObject).humidity;
        const calls: ChatMessage[][] = [];
        const result = await enrichModel(conversion, validateModel, fakeModel([JSON.stringify(wrong), "not json", "null"], calls), active);
        assert.strictEqual(calls.length, 3);
        assert.strictEqual(result.attempts, 3);
        assert.ok(result.issues.some((issue) => issue.message.includes("humidity")));
        const writes: string[] = [];
        const name = await saveModel("observed", JSON.stringify(result.model), {
            exists: async () => false, confirm: async () => "cancel",
            write: async (_name, text) => { writes.push(text); },
        }, active);
        assert.strictEqual(name, "observed.tm.json");
        assert.strictEqual(writes.length, 1);
        assert.deepStrictEqual(JSON.parse(writes[0]), result.model);
    });

    test("keeps a valid baseline and reports malformed JSON if every attempt is unparsable", async () => {
        const conversion = baseline();
        const result = await enrichModel(conversion, validateModel, fakeModel(["not json"]), active);
        assert.deepStrictEqual(result.model, conversion.model);
        assert.deepStrictEqual(validateModel(result.model), []);
        assert.ok(result.issues[0].message.includes("Invalid JSON response"));
        assert.strictEqual(result.attempts, 3);
    });

    test("propagates LM failures rather than silently accepting a baseline", async () => {
        const failure = new Error("quota exceeded");
        await assert.rejects(enrichModel(baseline(), validateModel, { request: async () => { throw failure; } }, active), /quota exceeded/);
    });

    test("cancels before requesting and after receiving a response", async () => {
        const conversion = baseline();
        let called = false;
        await assert.rejects(enrichModel(conversion, validateModel, {
            request: async () => { called = true; return "{}"; },
        }, { isCancellationRequested: true }), GenerationCancelled);
        assert.strictEqual(called, false);
        const token = { isCancellationRequested: false };
        await assert.rejects(enrichModel(conversion, validateModel, {
            request: async (_messages, suppliedToken) => {
                assert.strictEqual(suppliedToken, token);
                token.isCancellationRequested = true;
                return JSON.stringify(valid(conversion));
            },
        }, token), GenerationCancelled);
    });
});

suite("WoT output conflicts", () => {
    test("overwrite, keep both with -2 suffix, cancel, and cancellation before write", async () => {
        for (const answer of ["overwrite", "keepBoth", "cancel"] as const) {
            const writes: { name: string; overwrite: boolean }[] = [];
            const store: OutputStore = {
                exists: async (name) => name === "sensor.tm.json",
                confirm: async () => answer,
                write: async (name, _text, overwrite) => { writes.push({ name, overwrite }); },
            };
            const name = await saveModel("sensor", "{}", store, active);
            assert.strictEqual(name, answer === "cancel" ? undefined : answer === "overwrite" ? "sensor.tm.json" : "sensor-2.tm.json");
            assert.strictEqual(writes.length, answer === "cancel" ? 0 : 1);
            if (writes.length) {
                assert.strictEqual(writes[0].overwrite, answer === "overwrite");
            }
        }
        const names: string[] = [];
        await saveModel("sensor", "{}", {
            exists: async (name) => ["sensor.tm.json", "sensor-2.tm.json"].includes(name),
            confirm: async () => "keepBoth", write: async (name) => { names.push(name); },
        }, active);
        assert.deepStrictEqual(names, ["sensor-3.tm.json"]);
        const token = { isCancellationRequested: false };
        await assert.rejects(saveModel("sensor", "{}", {
            exists: async () => true,
            confirm: async () => { token.isCancellationRequested = true; return "overwrite"; },
            write: async () => { assert.fail("Cancelled output must not be written."); },
        }, token), GenerationCancelled);
    });
});
