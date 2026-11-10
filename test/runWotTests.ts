// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.

import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
    const temporary = await mkdtemp(path.join(tmpdir(), "vscode-wot-tests-"));
    try {
        const workspace = path.join(temporary, "workspace");
        await mkdir(workspace);
        const second = path.join(temporary, "second");
        await mkdir(second);
        const workspaceFile = path.join(temporary, "test.code-workspace");
        await writeFile(workspaceFile, JSON.stringify({ folders: [{ path: workspace }, { path: second }] }));
        await runTests({
            vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || undefined,
            extensionDevelopmentPath: path.resolve(__dirname, "../.."),
            extensionTestsPath: path.resolve(__dirname, "wot-host"),
            launchArgs: [workspaceFile, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes",
                "--user-data-dir", path.join(temporary, "profile")],
        });
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
