// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import { isJsonSchema, isObject, JsonObject, wotContext } from "../detect";
import { isAbsoluteModelId, ModelValidator } from "../validate";

export interface SchemaInput {
    id: string;
    name: string;
    schema: JsonObject;
}

export interface FieldGroup {
    id: string;
    name: string;
    fields: string[];
    links?: JsonObject[];
}

export interface ReportEntry {
    field: string;
    reason: string;
}

export interface ConversionReport {
    droppedFields: ReportEntry[];
    unsupported: ReportEntry[];
    needsInput: ReportEntry[];
}

export interface FieldMapping {
    field: string;
    section: "properties" | "events";
    name: string;
}

export interface Conversion {
    model: JsonObject;
    report: ConversionReport;
    mappings: FieldMapping[];
    fields: string[];
    source: JsonObject;
}

type Category = "measurement" | "state" | "setting" | "event" | "drop";

const categories: { category: Category; names: string[] }[] = [
    { category: "measurement", names: ["temperature", "humidity", "co2Level", "pressure", "noiseLevel", "vibration", "airQualityIndex"] },
    { category: "state", names: ["isOnline", "status", "uptime", "signalStrength", "batteryVoltage", "firmwareVersion", "serialNumber", "gpsLocation", "lastCalibrated"] },
    { category: "setting", names: ["operatingMode", "maintenanceSchedule"] },
    { category: "event", names: ["alertActive"] },
    { category: "drop", names: ["customerName", "assetTag", "location", "warrantyExpiry", "installYear", "tags",
        "lastKnownStatus", "lastKnownTemperature", "lastReportedAt", "timestamp", "totalMessagesSent"] },
];

// TD 1.1 DataSchema vocabulary: https://www.w3.org/TR/wot-thing-description11/#data-schema-vocabulary
const scalarKeywords = new Set(["title", "description", "const", "default", "enum", "unit", "format", "contentEncoding", "contentMediaType",
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "minItems", "maxItems", "minLength", "maxLength", "required", "readOnly", "writeOnly"]);
const types = new Set(["boolean", "integer", "number", "string", "object", "array", "null"]);

export function pointerSegment(value: string): string {
    return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function categoryOf(name: string): Category | undefined {
    return categories.find((rule) => rule.names.includes(name))?.category;
}

export function convertSchema(input: SchemaInput, validate: ModelValidator, group?: FieldGroup): Conversion {
    const id = group ? group.id : input.id;
    if (!isAbsoluteModelId(id)) {
        throw new Error("Supply a concrete absolute Thing Model ID.");
    }
    if (!isJsonSchema(input.schema)) {
        throw new Error("The input is not a JSON Schema.");
    }
    const report: ConversionReport = { droppedFields: [], unsupported: [], needsInput: [] };
    const note = (field: string, reason: string) => report.unsupported.push({ field, reason });
    const modern = typeof input.schema.$schema === "string" && input.schema.$schema.includes("2020-12");
    if (input.schema.$schema && !modern && !String(input.schema.$schema).includes("draft-07")) {
        throw new Error("Only JSON Schema draft-07 and 2020-12 are supported.");
    }

    function normalize(value: unknown, location: string, refs: string[] = []): unknown {
        if (!isObject(value)) {
            return value;
        }
        let schema = value;
        if (typeof schema.$ref === "string") {
            const ref = schema.$ref;
            if (!ref.startsWith("#/") || refs.includes(ref)) {
                note(location, refs.includes(ref) ? `Recursive reference: ${ref}` : `Unsupported reference: ${ref}`);
                return {};
            }
            let target: unknown = input.schema;
            let segments: string[];
            try {
                segments = decodeURIComponent(ref.slice(2)).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
            } catch {
                note(location, `Invalid reference: ${ref}`);
                return {};
            }
            for (const part of segments) {
                target = isObject(target) && Object.prototype.hasOwnProperty.call(target, part) ? target[part] : undefined;
            }
            if (!isObject(target) && typeof target !== "boolean") {
                note(location, `Unresolved reference: ${ref}`);
                return {};
            }
            const resolved = normalize(target, location, [...refs, ref]);
            const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$ref"));
            if (!modern) {
                if (Object.keys(siblings).length) {
                    note(location, "draft-07 ignores $ref siblings.");
                }
                return resolved;
            }
            if (!isObject(resolved)) {
                note(location, "Boolean reference with siblings needs manual conversion.");
                return {};
            }
            schema = { ...resolved };
            for (const [key, sibling] of Object.entries(siblings)) {
                if (key in schema && JSON.stringify(schema[key]) !== JSON.stringify(sibling)) {
                    note(location, `Conflicting $ref sibling '${key}' needs manual intersection.`);
                } else {
                    schema[key] = sibling;
                }
            }
        }
        const result: JsonObject = {};
        for (const [key, child] of Object.entries(schema)) {
            if (key === "$defs" || key === "definitions") {
                continue;
            }
            if (key === "properties" && isObject(child)) {
                result[key] = Object.fromEntries(Object.entries(child).map(([name, item]) =>
                    [name, normalize(item, `${location}/properties/${pointerSegment(name)}`, refs)]));
            } else if (["items", "oneOf", "anyOf"].includes(key)) {
                result[key] = Array.isArray(child) ? child.map((item, index) => normalize(item, `${location}/${key}/${index}`, refs))
                    : normalize(child, `${location}/${key}`, refs);
            } else {
                result[key] = child;
            }
        }
        return result;
    }

    function map(value: unknown, location: string, name: string): JsonObject {
        if (value === true) {
            return {};
        }
        if (!isObject(value)) {
            note(location, "Unsupported or false schema; review this unconstrained field.");
            return {};
        }
        const output: JsonObject = {};
        for (const [key, child] of Object.entries(value)) {
            if (scalarKeywords.has(key)) {
                output[key] = child;
            } else if (key === "type") {
                if (typeof child === "string" && types.has(child)) {
                    output.type = child;
                } else if (Array.isArray(child) && child.length && child.every((item) => typeof item === "string" && types.has(item))) {
                    const unique = [...new Set(child)].filter((type) => type !== "integer" || !child.includes("number"));
                    output.oneOf = unique.map((type) => ({ type }));
                } else {
                    note(location, "Unsupported data type.");
                }
            } else if (key === "properties" && isObject(child)) {
                output.properties = Object.fromEntries(Object.entries(child).map(([field, item]) =>
                    [field, map(item, `${location}/properties/${pointerSegment(field)}`, field)]));
            } else if (key === "items") {
                output.items = Array.isArray(child) ? child.map((item, index) => map(item, `${location}/items/${index}`, name))
                    : map(child, `${location}/items`, name);
            } else if ((key === "oneOf" || key === "anyOf") && Array.isArray(child) && child.length) {
                const branchTypes = child.map((branch) => isObject(branch) ? branch.type : undefined);
                const safe = branchTypes.every((type) => typeof type === "string" && types.has(type)) &&
                    new Set(branchTypes).size === child.length && !(branchTypes.includes("number") && branchTypes.includes("integer"));
                if (key === "anyOf" && !safe) {
                    note(location, "Overlapping anyOf cannot safely become oneOf.");
                } else if (output.oneOf || Array.isArray(value.type)) {
                    note(location, "Combined union constraints need manual conversion.");
                } else {
                    output.oneOf = child.map((item, index) => map(item, `${location}/${key}/${index}`, name));
                }
            } else if (!["$schema", "$id", "$comment"].includes(key)) {
                note(location, `Unsupported keyword: ${key}`);
            }
        }
        if (output.type === "string" && !output.format) {
            if (/Date$|warrantyExpiry/i.test(name)) {
                output.format = "date";
            } else if (/At$|^timestamp$|^lastCalibrated$/.test(name)) {
                output.format = "date-time";
            }
        }
        return output;
    }

    const normalized = normalize(input.schema, "");
    if (!isObject(normalized) || !isObject(normalized.properties)) {
        throw new Error("The JSON Schema must describe an object with named properties.");
    }
    const fields = group ? [...new Set(group.fields)] : Object.keys(normalized.properties);
    if (fields.some((field) => !Object.prototype.hasOwnProperty.call(normalized.properties, field))) {
        throw new Error("The field group contains an unknown source field.");
    }
    for (const key of Object.keys(normalized)) {
        if (!["$schema", "$id", "$comment", "title", "description", "type", "properties", "required"].includes(key)) {
            note("", `Unsupported root keyword: ${key}`);
        }
    }
    const properties: JsonObject = Object.create(null);
    const events: JsonObject = {};
    const mappings: FieldMapping[] = [];
    for (const field of fields) {
        const category = categoryOf(field);
        if (category === "drop") {
            report.droppedFields.push({ field, reason: "Suggested omission: asset, derived, or message metadata." });
            continue;
        }
        const data = map(normalized.properties[field], `/properties/${pointerSegment(field)}`, field);
        if (category === "event") {
            events.alert = { data };
            mappings.push({ field, section: "events", name: "alert" });
        } else {
            properties[field] = { ...data, readOnly: category !== "setting", ...(category === "measurement" ? { observable: true } : {}) };
            mappings.push({ field, section: "properties", name: field });
            if (!category) {
                report.needsInput.push({ field, reason: "Unrecognized field; confirm the default read-only classification." });
            }
            if (category === "measurement" && !data.unit) {
                report.needsInput.push({ field, reason: "Confirm the measurement unit." });
            }
        }
    }
    const model: JsonObject = { id, "@context": wotContext, "@type": "tm:ThingModel",
        title: group?.name || input.name, version: { model: "1.0.0" }, properties, events };
    if (group?.links) {
        model.links = group.links;
    }
    const errors = validate(model);
    if (errors.length) {
        throw new Error(`Cannot create a valid baseline: ${errors.map((error) => `${error.pointer}: ${error.message}`).join("; ")}`);
    }
    const source: JsonObject = group ? {
        ...(input.schema.$schema ? { $schema: input.schema.$schema } : {}),
        type: "object", properties: Object.fromEntries(fields.map((field) => [field, normalized.properties[field]])),
    } : input.schema;
    return { model, report, mappings, fields, source };
}
