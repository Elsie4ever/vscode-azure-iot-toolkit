// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import Ajv, { AnySchema } from "ajv";
import { hasWotContext, isObject, isThingModel } from "./detect";

export interface ValidationIssue {
    pointer: string;
    message: string;
    code?: string;
}

export type ModelValidator = (model: unknown) => ValidationIssue[];

export function isAbsoluteModelId(value: unknown): value is string {
    if (typeof value !== "string" || !/^[a-z][a-z0-9+.-]*:[^\s{}]+$/i.test(value)) {
        return false;
    }
    try {
        new URL(value);
        return true;
    } catch (error) {
        if (error instanceof TypeError) {
            return false;
        }
        throw error;
    }
}

export function createModelValidator(schema: AnySchema): ModelValidator {
    // The W3C schema includes annotation keywords and intentionally permits TM placeholders.
    const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
    return (model) => {
        const issues: ValidationIssue[] = [];
        if (!validate(model)) {
            for (const error of validate.errors || []) {
                issues.push({ pointer: error.instancePath, message: error.message || error.keyword, code: `wot.schema.${error.keyword}` });
            }
        }
        if (!hasWotContext(model)) {
            issues.push({ pointer: "/@context", message: "Include the WoT TD 1.1 context.", code: "wot.context.required" });
        }
        if (!isObject(model) || !isThingModel(model)) {
            issues.push({ pointer: "/@type", message: 'Include "@type": "tm:ThingModel".', code: "wot.type.required" });
        }
        // The uploader requires a concrete absolute ID even though the W3C TM schema makes id optional.
        if (!isObject(model) || model.id === undefined || model.id === "") {
            issues.push({ pointer: "/id", message: "A Thing Model ID is required for upload. Add an absolute ID such as urn:example:thermostat.",
                code: "wot.id.required" });
        } else if (!isAbsoluteModelId(model.id)) {
            issues.push({ pointer: "/id", message: "The Thing Model ID must be an absolute URI without placeholders, such as urn:example:thermostat.",
                code: "wot.id.absolute" });
        }
        return issues;
    };
}
