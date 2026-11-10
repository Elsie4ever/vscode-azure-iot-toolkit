// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import { Conversion, pointerSegment, ReportEntry } from "../converter/convert";
import { isObject, JsonObject, wotContext } from "../detect";
import { Cancellation, checkCancellation } from "../output";
import { ModelValidator, ValidationIssue } from "../validate";
import { buildPrompt } from "./prompt";

export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

export interface LanguageModel {
    request(messages: ChatMessage[], token: Cancellation): Promise<string>;
}

export interface Enrichment {
    model: JsonObject;
    droppedFields: ReportEntry[];
    issues: ValidationIssue[];
    attempts: number;
}

export function parseResponse(text: string): JsonObject {
    const trimmed = text.trim();
    const fence = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(trimmed);
    const value: unknown = JSON.parse(fence ? fence[1] : trimmed);
    if (!isObject(value)) {
        throw new Error("The response must be one JSON object.");
    }
    return value;
}

function droppedFields(model: JsonObject, issues: ValidationIssue[], fields: string[]): ReportEntry[] {
    if (model["x-droppedFields"] === undefined) {
        return [];
    }
    const value = model["x-droppedFields"];
    if (!Array.isArray(value)) {
        issues.push({ pointer: "/x-droppedFields", message: "Expected an array of {field, reason} entries." });
        return [];
    }
    const entries: ReportEntry[] = [];
    for (const [index, item] of value.entries()) {
        if (!isObject(item) || typeof item.field !== "string" || !fields.includes(item.field) ||
            typeof item.reason !== "string" || !item.reason.trim() || entries.some((entry) => entry.field === item.field)) {
            issues.push({ pointer: `/x-droppedFields/${index}`, message: "A unique source field and a non-empty reason are required." });
        } else {
            entries.push({ field: item.field, reason: item.reason });
        }
    }
    return entries;
}

function checkTypes(expected: unknown, actual: unknown, pointer: string, issues: ValidationIssue[]): void {
    if (!isObject(expected)) {
        return;
    }
    if (!isObject(actual)) {
        issues.push({ pointer, message: "A baseline data schema is missing." });
        return;
    }
    if (expected.type !== actual.type) {
        issues.push({ pointer: `${pointer}/type`, message: `Preserve baseline type ${JSON.stringify(expected.type)}.` });
    }
    if (isObject(expected.properties)) {
        for (const [name, schema] of Object.entries(expected.properties)) {
            checkTypes(schema, isObject(actual.properties) ? actual.properties[name] : undefined, `${pointer}/properties/${pointerSegment(name)}`, issues);
        }
    }
    for (const key of ["items", "oneOf"]) {
        const source = expected[key];
        if (Array.isArray(source)) {
            const target = actual[key];
            if (!Array.isArray(target) || source.length !== target.length) {
                issues.push({ pointer: `${pointer}/${key}`, message: "Preserve the baseline tuple or union types." });
            } else {
                source.forEach((schema, index) => checkTypes(schema, target[index], `${pointer}/${key}/${index}`, issues));
            }
        } else if (isObject(source)) {
            checkTypes(source, actual[key], `${pointer}/${key}`, issues);
        }
    }
}

export function checkAiOutput(model: JsonObject, conversion: Conversion, validate: ModelValidator): Enrichment {
    const issues = validate(model);
    const dropped = droppedFields(model, issues, conversion.fields);
    if (model["@context"] !== wotContext) {
        issues.push({ pointer: "/@context", message: "Use exactly the TD 1.1 context string." });
    }
    if (model.id !== conversion.model.id) {
        issues.push({ pointer: "/id", message: `Keep the supplied model ID unchanged: ${conversion.model.id}. The baseline ID has been restored.` });
    }
    if (Object.prototype.hasOwnProperty.call(model, "actions")) {
        issues.push({ pointer: "/actions", message: "Only properties and event data are supported; do not add actions." });
    }
    if (typeof model.title !== "string" || !model.title.trim() || !isObject(model.version) || model.version.model !== "1.0.0") {
        issues.push({ pointer: "/version", message: "Include a title and version.model: 1.0.0." });
    }
    if (JSON.stringify(model.links) !== JSON.stringify(conversion.model.links)) {
        issues.push({ pointer: "/links", message: "Keep baseline links unchanged." });
    }
    function checkForbidden(value: unknown, pointer: string): void {
        if (!isObject(value)) {
            if (Array.isArray(value)) {
                value.forEach((item, index) => checkForbidden(item, `${pointer}/${index}`));
            }
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            const location = `${pointer}/${pointerSegment(key)}`;
            if (["forms", "security", "securityDefinitions"].includes(key)) {
                issues.push({ pointer: location, message: "Do not add deployment-specific forms or security." });
            }
            if (!/\/(?:properties|events|actions)$/.test(pointer) && ["$ref", "tm:ref", "$defs", "definitions"].includes(key)) {
                issues.push({ pointer: location, message: "Use self-contained data schemas without references or external definitions." });
            }
            checkForbidden(child, location);
        }
    }
    checkForbidden(model, "");
    for (const field of conversion.fields) {
        const mapping = conversion.mappings.find((item) => item.field === field);
        const names = [...new Set([field, mapping?.name].filter((name): name is string => !!name))];
        let actual: unknown;
        let location = `/properties/${pointerSegment(field)}`;
        for (const name of names) {
            if (isObject(model.properties) && Object.prototype.hasOwnProperty.call(model.properties, name)) {
                actual = model.properties[name];
                location = `/properties/${pointerSegment(name)}`;
                break;
            }
            if (isObject(model.events) && isObject(model.events[name])) {
                actual = model.events[name].data;
                location = `/events/${pointerSegment(name)}/data`;
                break;
            }
        }
        const omitted = dropped.some((entry) => entry.field === field);
        if (actual === undefined && !omitted) {
            issues.push({ pointer: location, message: `Source field '${field}' is missing; keep it or supply a drop reason.` });
        } else if (actual !== undefined && omitted) {
            issues.push({ pointer: location, message: `Field '${field}' cannot be both kept and dropped.` });
        } else if (actual !== undefined) {
            const section = mapping && conversion.model[mapping.section];
            const baseline = isObject(section) ? section[mapping.name] : undefined;
            const expected = mapping?.section === "events" && isObject(baseline) ? baseline.data : baseline;
            checkTypes(expected, actual, location, issues);
        }
    }
    const clean = { ...model };
    clean.id = conversion.model.id;
    delete clean["x-droppedFields"];
    return { model: clean, droppedFields: dropped, issues, attempts: 0 };
}

export async function enrichModel(
    conversion: Conversion, validate: ModelValidator, lm: LanguageModel, token: Cancellation,
    progress: (attempt: number) => void = () => undefined,
): Promise<Enrichment> {
    const messages: ChatMessage[] = [{ role: "user", content: buildPrompt(conversion) }];
    let best: Enrichment | undefined;
    let lastIssues: ValidationIssue[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
        checkCancellation(token);
        progress(attempt);
        const text = await lm.request(messages, token);
        checkCancellation(token);
        let result: Enrichment | undefined;
        try {
            result = checkAiOutput(parseResponse(text), conversion, validate);
            result.attempts = attempt;
            if (!best || result.issues.length < best.issues.length) {
                best = result;
            }
            lastIssues = result.issues;
        } catch (error) {
            if (!(error instanceof SyntaxError) && !(error instanceof Error && error.message === "The response must be one JSON object.")) {
                throw error;
            }
            lastIssues = [{ pointer: "", message: `Invalid JSON response: ${error.message}` }];
        }
        if (result && !result.issues.length) {
            return result;
        }
        messages.push({ role: "assistant", content: text },
            { role: "user", content: `Repair the JSON object. Return only JSON. Errors:\n${JSON.stringify(lastIssues)}` });
    }
    return best ? { ...best, attempts: 3 } : {
        model: conversion.model, droppedFields: conversion.report.droppedFields, issues: lastIssues, attempts: 3,
    };
}
