// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import * as assert from "assert";
import { convertSchema, SchemaInput } from "../../src/wot/core/converter/convert";
import { JsonObject } from "../../src/wot/core/detect";
import { validateModel } from "./foundation.test";

export const sampleInput: SchemaInput = {
    id: "urn:example:observed-device",
    name: "Observed device",
    schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
            airQualityIndex: { type: "number" }, alertActive: { type: "boolean" }, assetTag: { type: "string" },
            batteryVoltage: { type: "number" }, co2Level: { type: "number" }, customerName: { type: "string" },
            firmwareVersion: { type: "string" },
            gpsLocation: { type: "object", properties: { floor: { type: "integer" }, lat: { type: "number" }, lon: { type: "number" } } },
            humidity: { type: "number" }, installYear: { type: "integer" }, isOnline: { type: "boolean" },
            lastCalibrated: { type: "string" }, lastKnownStatus: { type: "string" }, lastKnownTemperature: { type: "number" },
            lastReportedAt: { type: "string" }, location: { type: "string" },
            maintenanceSchedule: { type: "object", properties: { intervalDays: { type: "integer" }, lastServiceDate: { type: "string" } } },
            noiseLevel: { type: "number" }, operatingMode: { type: "string" }, pressure: { type: "number" },
            serialNumber: { type: "string" }, signalStrength: { type: "integer" }, status: { type: "string" },
            tags: { type: "array", items: { type: "string" } }, temperature: { type: "number" }, timestamp: { type: "string" },
            totalMessagesSent: { type: "integer" }, uptime: { type: "integer" }, vibration: { type: "number" }, warrantyExpiry: { type: "string" },
        },
    },
};

function field(model: JsonObject, name: string): JsonObject {
    return (model.properties as Record<string, JsonObject>)[name];
}

suite("WoT converter", () => {
    test("converts the complete fixture into a valid baseline with expected categories", () => {
        const result = convertSchema(sampleInput, validateModel);
        assert.deepStrictEqual(validateModel(result.model), []);
        assert.strictEqual(result.fields.length, 30);
        assert.strictEqual(result.report.droppedFields.length, 11);
        assert.strictEqual(result.mappings.length, 19);
        for (const name of ["temperature", "humidity", "co2Level", "pressure", "noiseLevel", "vibration", "airQualityIndex"]) {
            assert.strictEqual(field(result.model, name).observable, true);
            assert.strictEqual(field(result.model, name).readOnly, true);
        }
        for (const name of ["operatingMode", "maintenanceSchedule"]) {
            assert.strictEqual(field(result.model, name).readOnly, false);
        }
        assert.strictEqual(field(result.model, "lastCalibrated").format, "date-time");
        const nested = field(result.model, "maintenanceSchedule").properties as Record<string, JsonObject>;
        assert.strictEqual(nested.lastServiceDate.format, "date");
        assert.deepStrictEqual(result.model.events, { alert: { data: { type: "boolean" } } });
        assert.strictEqual(result.model.id, sampleInput.id);
    });

    test("converts a field group and preserves supplied base links", () => {
        const links = [{ rel: "tm:extends", href: "./base.tm.json" }];
        const result = convertSchema(sampleInput, validateModel, { id: "urn:example:air", name: "Air", fields: ["temperature", "co2Level"], links });
        assert.deepStrictEqual(Object.keys(result.model.properties), ["temperature", "co2Level"]);
        assert.deepStrictEqual(result.model.links, links);
        assert.strictEqual(result.model.title, "Air");
        assert.strictEqual(result.model.id, "urn:example:air");
        assert.throws(() => convertSchema(sampleInput, validateModel, { id: "urn:example:bad", name: "Bad", fields: ["unknown"] }), /unknown/);
    });

    test("normalizes draft-07 definitions and 2020-12 defs, reporting recursive and remote refs", () => {
        for (const draft of ["http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft/2020-12/schema"]) {
            const result = convertSchema({ id: "urn:example:refs", name: "Refs", schema: {
                $schema: draft, type: "object",
                definitions: { value: { type: "integer" } }, $defs: { loop: { $ref: "#/$defs/loop" } },
                properties: { count: { $ref: "#/definitions/value" }, loop: { $ref: "#/$defs/loop" }, remote: { $ref: "https://example.com/schema" } },
            } }, validateModel);
            assert.strictEqual(field(result.model, "count").type, "integer");
            assert.ok(result.report.unsupported.some((entry) => entry.reason.includes("Recursive")));
            assert.ok(result.report.unsupported.some((entry) => entry.reason.includes("Unsupported reference")));
            assert.deepStrictEqual(validateModel(result.model), []);
        }
    });

    test("maps disjoint unions but reports overlapping anyOf and unsupported keywords", () => {
        const result = convertSchema({ id: "urn:example:unions", name: "Unions", schema: { type: "object", properties: {
            disjoint: { anyOf: [{ type: "string" }, { type: "number" }] },
            overlap: { anyOf: [{ type: "integer" }, { type: "number" }] },
            union: { type: ["number", "integer", "null"] },
            nested: { type: "array", items: { type: "string" }, uniqueItems: true },
        } } }, validateModel);
        assert.deepStrictEqual(field(result.model, "disjoint").oneOf, [{ type: "string" }, { type: "number" }]);
        assert.ok(!("oneOf" in field(result.model, "overlap")));
        assert.deepStrictEqual(field(result.model, "union").oneOf, [{ type: "number" }, { type: "null" }]);
        assert.strictEqual(result.report.unsupported.length, 2);
    });

    test("rejects unsupported drafts, missing properties, and invalid constraints explicitly", () => {
        assert.throws(() => convertSchema({ ...sampleInput, schema: { $schema: "https://json-schema.org/draft-04/schema", properties: {} } }, validateModel), /draft-07/);
        assert.throws(() => convertSchema({ ...sampleInput, schema: { type: "object" } }, validateModel), /named properties/);
        assert.throws(() => convertSchema({ ...sampleInput, schema: { type: "object", properties: { x: { type: "string", minLength: -1 } } } }, validateModel),
            /valid baseline/);
    });

    test("preserves arbitrary field names and reports unsupported root and string constraints", () => {
        const schema = JSON.parse('{"type":"object","additionalProperties":false,"properties":{"__proto__":{"type":"number"},"a/b":{"type":"string","pattern":"x"}}}');
        const result = convertSchema({ id: "urn:example:names", name: "Names", schema }, validateModel);
        assert.ok(Object.prototype.hasOwnProperty.call(result.model.properties, "__proto__"));
        assert.strictEqual(result.report.unsupported.length, 2);
        assert.ok(result.report.unsupported.some((entry) => entry.field === "/properties/a~1b"));
        assert.deepStrictEqual(validateModel(result.model), []);
    });

    test("requires supplied absolute IDs and stays deterministic for the same input", () => {
        for (const id of ["", "relative.tm.json", "urn:example:{{MODEL_ID}}", "urn:example:invalid id"]) {
            assert.throws(() => convertSchema({ ...sampleInput, id }, validateModel), /absolute Thing Model ID/);
        }
        assert.deepStrictEqual(convertSchema(sampleInput, validateModel), convertSchema(sampleInput, validateModel));
    });
});
