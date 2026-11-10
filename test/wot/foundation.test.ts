// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as assert from "assert";
import { readFileSync } from "fs";
import * as path from "path";
import { hasWotContext, isJsonSchema, isThingModel, wotContext } from "../../src/wot/core/detect";
import { createModelValidator } from "../../src/wot/core/validate";

export const validateModel = createModelValidator(JSON.parse(readFileSync(
    path.resolve(__dirname, "../../../resources/wot/tm-json-schema-validation.json"), "utf8")));

suite("WoT foundation", () => {
    test("detects string and array contexts and types, not TDs", () => {
        assert.ok(isThingModel({ "@context": wotContext, "@type": "tm:ThingModel" }));
        assert.ok(isThingModel({ "@context": [wotContext, {}], "@type": ["tm:ThingModel", "Sensor"] }));
        assert.ok(hasWotContext({ "@context": wotContext }));
        assert.ok(!isThingModel({ "@context": wotContext }));
        assert.ok(!isThingModel(null));
    });

    test("detects JSON Schema without accepting spoofed schema hosts or Thing Models", () => {
        assert.ok(isJsonSchema({ $schema: "https://json-schema.org/draft/2020-12/schema" }));
        assert.ok(isJsonSchema({ type: "object", properties: {} }));
        assert.ok(!isJsonSchema({ $schema: "https://json-schema.org.example/schema" }));
        assert.ok(!isJsonSchema({ "@context": wotContext, type: "object" }));
    });

    test("validates offline and returns JSON pointers", () => {
        assert.deepStrictEqual(validateModel({
            id: "urn:example:sensor", "@context": wotContext, "@type": "tm:ThingModel", title: "Sensor", version: { model: "1.0.0" },
        }), []);
        const errors = validateModel({ title: 23 });
        assert.ok(errors.some((error) => error.pointer === "/title"));
        assert.ok(errors.some((error) => error.pointer === "/@type"));
        assert.ok(errors.some((error) => error.pointer === "/@context"));
    });

    test("requires a concrete absolute ID for uploader-compatible authoring", () => {
        const model = { "@context": wotContext, "@type": "tm:ThingModel", title: "Sensor" };
        assert.ok(validateModel(model).some((issue) => issue.code === "wot.id.required" && issue.pointer === "/id"));
        for (const id of ["", "sensor", "./sensor.tm.json", "http://", "urn:example:{{MODEL_ID}}", null, 123]) {
            assert.ok(validateModel({ ...model, id }).some((issue) => issue.pointer === "/id"));
        }
        for (const id of ["urn:example:sensor", "urn:uuid:b2cef8a1-0d68-46fe-b914-c4a7311fef29", "https://example.com/models/sensor"]) {
            assert.deepStrictEqual(validateModel({ ...model, id }), []);
        }
    });
});
