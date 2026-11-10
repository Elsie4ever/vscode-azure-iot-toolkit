// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

export const wotContext = "https://www.w3.org/2022/wot/td/v1.1";

export type JsonObject = { [key: string]: unknown };

export function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function includes(value: unknown, expected: string): boolean {
    return value === expected || (Array.isArray(value) && value.includes(expected));
}

export function hasWotContext(value: unknown): boolean {
    return isObject(value) && includes(value["@context"], wotContext);
}

export function isThingModel(value: unknown): boolean {
    return hasWotContext(value) && isObject(value) && includes(value["@type"], "tm:ThingModel");
}

export function isJsonSchema(value: unknown): value is JsonObject {
    if (!isObject(value) || hasWotContext(value)) {
        return false;
    }
    if (typeof value.$schema === "string") {
        return /^https?:\/\/json-schema\.org(?:\/|#|$)/i.test(value.$schema);
    }
    return typeof value.type === "string" || Array.isArray(value.type) || isObject(value.properties);
}
