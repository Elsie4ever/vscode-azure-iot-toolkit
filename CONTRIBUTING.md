## Prerequisites
* Latest [Visual Studio Code](https://code.visualstudio.com/)
* [Node.js](https://nodejs.org/) 20.x
* VS Code 1.90 or later (required for the stable language model API)

## Setup
1. Fork and clone the repository
2. `cd vscode-azure-iot-toolkit`
3. Install the dependencies: `npm install`
4. Open the folder in VS Code
5. Install the ESLint extension (recommended)
6. Press `F5`. Go!

## Test
Run `npm run compile`, `npm run lint`, and `npm test` before submitting Pull Requests.
WoT core tests also run without an extension host:
`npx mocha --ui tdd "out/test/wot/**/*.test.js"`.
Run `npm run webpack` then `npm run test:wot` for the focused WoT extension-host
suite (uses a temporary workspace/profile and an injected LM, not real Copilot).
Set `VSCODE_EXECUTABLE_PATH` to an installed VS Code executable to test offline;
otherwise the runner downloads VS Code via `@vscode/test-electron`.
The WoT core in `src/wot/core` must not import `vscode`.

## Debugger startup diagnostics
The **Launch Extension** F5 configuration writes a local JavaScript debugger
trace to `%TEMP%\vscode-azure-iot-toolkit-f5.json`. If F5 fails before extension
logs appear, keep this trace and compare with **Ctrl+F5** (without debugging).
Traces can contain runtime values; do not commit them or share them unredacted.