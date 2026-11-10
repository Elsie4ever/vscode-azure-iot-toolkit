// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

export interface OutputStore {
    exists(name: string): Promise<boolean>;
    confirm(): Promise<"overwrite" | "keepBoth" | "cancel">;
    write(name: string, text: string, overwrite: boolean): Promise<void>;
}

export interface Cancellation {
    readonly isCancellationRequested: boolean;
}

export class GenerationCancelled extends Error {
    constructor() {
        super("Thing Model generation cancelled.");
    }
}

export function checkCancellation(token: Cancellation): void {
    if (token.isCancellationRequested) {
        throw new GenerationCancelled();
    }
}

export async function saveModel(stem: string, text: string, store: OutputStore, token: Cancellation): Promise<string | undefined> {
    checkCancellation(token);
    let name = `${stem}.tm.json`;
    let overwrite = false;
    if (await store.exists(name)) {
        const answer = await store.confirm();
        if (answer === "cancel") {
            return undefined;
        }
        overwrite = answer === "overwrite";
        if (!overwrite) {
            let index = 2;
            do {
                name = `${stem}-${index++}.tm.json`;
            } while (await store.exists(name));
        }
    }
    checkCancellation(token);
    await store.write(name, text, overwrite);
    return name;
}
