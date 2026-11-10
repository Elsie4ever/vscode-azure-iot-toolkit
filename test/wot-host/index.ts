// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import glob from "glob";
import Mocha from "mocha";
import * as path from "path";

export async function run(): Promise<void> {
    const mocha = new Mocha({ ui: "tdd", color: true, timeout: 15000 });
    for (const file of glob.sync("{wot,wot-host}/**/*.test.js", { cwd: path.resolve(__dirname, "..") })) {
        mocha.addFile(path.resolve(__dirname, "..", file));
    }
    await new Promise<void>((resolve, reject) => {
        mocha.run((failures) => failures ? reject(new Error(`${failures} WoT tests failed.`)) : resolve());
    });
}
