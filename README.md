# Azure IoT Hub

## Overview

Interact with Azure IoT Hub, IoT Device Management, IoT Edge Management, IoT Hub Device Simulation, IoT Hub Code Generation and IoT Hub Device Provisioning Service.

## Device Explorer
The [Wiki page](https://github.com/Microsoft/vscode-azure-iot-toolkit/wiki) includes a comprehensive getting started guide as well as  detailed usage instructions of the following features:

* IoT Hub management
    * Create IoT Hub
    * Select IoT Hub
    * Copy IoT Hub Connection String
    * Generate SAS Token for IoT Hub
* Device management
    * List devices
    * Get device info
    * Create IoT device
    * Create Edge device
    * Delete device
    * Copy Device Connection String
    * Generate SAS Token for Device
* Module management
    * List Modules
    * Get Module Info
    * Create Module
    * Edit Module Twin
    * Invoke Module Direct Method
    * Copy Module Connection String
    * Delete Module
* Interact with Azure IoT Hub
    * Generate Code for C#, F#, Go, Java, Node.js, PHP, Python, Ruby or REST API
    * Send D2C message to IoT Hub
    * Monitor Built-in Event Endpoint
    * Send C2D message to device
    * Receive C2D message from IoT Hub
    * Invoke Device Direct Method
    * Edit Device Twin
    * Manage Azure IoT distributed tracing
* Interact with Azure IoT Edge (Install [Azure IoT Edge](https://marketplace.visualstudio.com/items?itemName=vsciot-vscode.azure-iot-edge) for more IoT Edge support)
    * List Modules 
    * Edit Module Twin
    * Create deployment for Single Device
    * Create Deployment at Scale
* Endpoints management
    * List Built-in and Custom Endpoints
    * Monitor Custom Event Hub Endpoint

### Prerequisites

1. In Explorer of VS Code, click "Azure IoT Hub" in the bottom left corner.

  ![Click Device Explorer](images/device-explorer-click.png)

2. Click "Set IoT Hub Connection String" in context menu.

  ![Set Connection String](images/set-connection-string.png)

3. An input box will pop up, then enter your IoT Hub Connection String (It is one-time configuration, and please make sure it is **IoT Hub Connection String** not **Device Connection String**. The format is `HostName=<my-hub>.azure-devices.net;SharedAccessKeyName=<my-policy>;SharedAccessKey=<my-policy-key>`).

  ![Enter Connection String](images/enter-connection-string.png)

4. The devices list will be shown.

  ![Device Explorer](images/device-explorer.png)

### Sign in to Azure

Instead of copying and pasting to set IoT Hub Connection String, you could sign in to Azure to select IoT Hub from your Azure Subscription.

1. Click "Select IoT Hub" in context menu.

  ![Select IoT Hub](images/select-iot-hub.png)

2. If you have not signed in to Azure, a pop-up will show to let you sign in to Azure.
3. After you sign in, your Azure Subscription list will be shown, then select an Azure Subscription.
4. Your IoT Hub list will be shown, then select an IoT Hub.
5. The devices and endpoints list will be shown.

  ![IoT Hub Explorer](images/iot-hub-explorer.png)

## Device Provisioning Service Explorer

1. Open "Azure" view on the Activity Bar, and expand "IOT HUB DEVICE PROVISIONING SERVICE".

![DPS Explorer](images/dps-explorer.png)

2. If you're not signed in, click "Sign in to Azure..." to sign in.

3. Expand one subscription to start exploring your device provisioning services.


## Code Generation

![Code Generation](images/code-generation.gif)

## Code Snippets

| Trigger | Content |
| ---- | ---- |
| iotSendD2CMessage | Send D2C message to IoT Hub |
| iotMonitorD2CMessage | Monitor D2C message for IoT Hub |
| iotSendC2DMessage | Send C2D message to device |
| iotMonitorC2DMessage | Monitor C2D message from IoT Hub |
| iotCallDirectMethods | Send direct methods to device |
| iotReceiveDirectMethods | Receive direct methods from IoT Hub |

![Snippet](images/snippet.gif)

> After code snippet is created, you need to install corresponding npm package (e.g. [azure-iot-device-mqtt](https://www.npmjs.com/package/azure-iot-device-mqtt)) to run the code snippet.
> If you want to 'Run Code' directly, you need to install [Code Runner](https://marketplace.visualstudio.com/items?itemName=formulahendry.code-runner).

## Configuration

IoT Hub Consumer Group (default is `"$Default"`):
```json
{
    "azure-iot-toolkit.iotHubConsumerGroup": "$Default"
}
```

The time span (in minutes) of monitoring D2C message before current time (default is `0`):
```json
{
    "azure-iot-toolkit.monitorD2CBeforeNowInMinutes": 0
}
```

Whether to show verbose info when monitoring messages (default is `false`):
```json
{
    "azure-iot-toolkit.showVerboseMessage": false
}
```

Whether to stringify device-to-cloud messages (default is `false`):
```json
{ 
    "azure-iot-toolkit.iotHubD2CMessageStringify": false
}
```

Whether to show IoT Hub info when IoT Hub Connection String is not set (default is `true`):
```json
{ 
    "azure-iot-toolkit.showIoTHubInfo": true
}
```

Whether to enable auto refresh of tree view (default is `false`):
```json
{ 
    "azure-iot-toolkit.treeViewAutoRefreshEnable": false
}
```

Time interval in seconds for tree view auto refresh, auto refresh has to be enabled for it to work. (default is `60`):
```json
{ 
    "azure-iot-toolkit.treeViewAutoRefreshIntervalInSeconds": 60
}
```

## Resources
- [Channel 9 video: Walkthrough of Azure IoT Hub extension](https://channel9.msdn.com/Shows/Internet-of-Things-Show/Azure-IoT-Toolkit-extension-for-Visual-Studio-Code)
- [Channel 9 video: What's new in the IoT Hub extension for VS Code](https://channel9.msdn.com/Shows/Internet-of-Things-Show/Whats-new-in-the-IoT-Toolkit-extension-for-VS-Code)
- [Create an IoT hub using the IoT Hub extension for VS Code](https://docs.microsoft.com/en-us/azure/iot-hub/iot-hub-create-use-iot-toolkit)
- [Use Azure IoT Hub extension to send and receive messages between your device and IoT Hub](https://docs.microsoft.com/en-us/azure/iot-hub/iot-hub-vscode-iot-toolkit-cloud-device-messaging)
- [Use Azure IoT Hub extension for device management](https://docs.microsoft.com/en-us/azure/iot-hub/iot-hub-device-management-iot-toolkit)
- [Quickly build your Azure IoT application with Node.js, Python or REST API](https://devblogs.microsoft.com/iotdev/azure-iot-toolkit-1-2-0-quickly-build-your-azure-iot-application-in-vs-code-with-node-js-python-or-rest-api/)
- [Azure IoT Hub extension supports C#, Go, Java, Node.js, PHP, Python and Ruby to develop Azure IoT application in VS Code](https://devblogs.microsoft.com/iotdev/azure-iot-toolkit-supports-c-go-java-node-js-php-python-and-ruby-to-develop-azure-iot-application-in-vs-code/)
- [Use VS Code as IoT Hub Device Simulator](https://blogs.msdn.microsoft.com/iotdev/2018/07/12/use-vs-code-as-iot-hub-device-simulator-say-hello-to-azure-iot-hub-in-5-minutes/)
- [Use VS Code to call Azure IoT Hub REST APIs](https://blogs.msdn.microsoft.com/iotdev/2018/07/19/call-azure-iot-hub-rest-apis-in-vs-code/)
- [Create and control an IoT device connected to an IoT hub (Node.js)](https://github.com/Microsoft/vscode-azure-iot-toolkit/wiki/Quickstart-Node.js)
- [Create and control an IoT device connected to an IoT hub (.NET)](https://github.com/Microsoft/vscode-azure-iot-toolkit/wiki/Quickstart-.NET)
- [Handy Tool When You Develop With Azure IoT](https://blogs.msdn.microsoft.com/iotdev/2017/09/01/handy-tool-when-you-develop-with-azure-iot/)
- [Azure IoT Hub extension for Visual Studio Code generally available for managing Azure IoT Hub and Devices with ease](https://blogs.msdn.microsoft.com/iotdev/2018/06/30/azure-iot-toolkit-for-visual-studio-code-generally-available-for-managing-azure-iot-hub-and-devices-with-ease/)

## ❤️ Contributors

Thanks to all the [contributors](https://github.com/Microsoft/vscode-azure-iot-toolkit/graphs/contributors)!



## Data/Telemetry
This project collects usage data and sends it to Microsoft to help improve our products and services. Read our [privacy statement](http://go.microsoft.com/fwlink/?LinkId=521839) to learn more. 
If you don’t wish to send usage data to Microsoft, you can set the `telemetry.enableTelemetry` setting to `false`. Learn more in our [FAQ](https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting).
# WoT Thing Model authoring (prototype)

Requires VS Code 1.90 or later. Run **WoT: Create Schema Folder** to create
`wot/schemas` and `wot/models` in the selected workspace folder. These paths
can be changed per workspace folder with `azure-iot-toolkit.wot.schemaFolder`
and `azure-iot-toolkit.wot.modelFolder`; paths must remain workspace-relative.

Thing Models use `*.tm.json`. The bundled official W3C schema provides offline
validation, completion, and hover immediately on open. See
[schema attribution](resources/wot/NOTICE.txt).
This prototype authors Thing Models only, not Thing Descriptions or TM-to-TD output.
Each generation supplies a fresh, unique absolute model ID (`urn:uuid:<UUID>`)
in both Copilot and non-Copilot output. The converter keeps this caller-supplied
ID deterministic, and Copilot must preserve it. Even if repair retries are
exhausted, the saved model retains the baseline ID. Regenerating a model creates
a new ID; retain the previous ID manually when updating an already registered model.
For older generated files without an ID, add a unique absolute `id` (for example
`"id": "urn:example:thermostat"`) or regenerate before uploading.

Thing Models also receive live **WoT** error diagnostics on open, save, and
while editing (debounced by 300 ms). Missing or invalid absolute IDs produce
red squiggles and Problems entries; a missing ID is highlighted at the opening
brace, and an invalid ID is highlighted at its value. This is an uploader
compatibility rule, not a change to the bundled official W3C schema.
The same live pass checks the TM schema, context, and type. Unrelated JSON
files are not checked. Fixes clear the errors without regenerating the model.

Save a draft-07 or 2020-12 JSON Schema in the schema folder. With that file
active, run **WoT: Generate Thing Model (without Copilot)**. The deterministic
converter opens `<modelFolder>/<schema-name>.tm.json` and offers a conversion
report. Existing output prompts for overwrite or a numbered copy.
Known measurements become observable read-only properties, state is read-only,
settings are writable, and `alertActive` becomes an `alert` event. Asset and
message metadata are suggested omissions, recorded in the report. Unknown
fields stay read-only and are flagged for review. Units use plain strings.
Local references are inlined; recursive or remote references and unsupported
keywords are reported for manual review. No remote schema is fetched.

## Generate using Copilot

Creating or saving a JSON Schema in the schema folder offers **Generate Thing
Model using Copilot?** once per file. Choose **Generate Thing Model** to send
the schema and deterministic baseline to Copilot. The same flow is available
from the file's Explorer context menu, editor title menu, and CodeLens.
Only JSON Schemas inside the configured schema folder are eligible.

Generation is cancellable and validates the response against the bundled
schema, source-field coverage, model ID, and baseline types (including nested fields).
Output is self-contained properties and event data; AI-added actions and
referenced definitions are reported as unsupported.
It allows at most two repair retries. If problems remain, the best parseable
attempt is still opened with generation warnings in Problems and a **View
report** action. If every response is malformed, the baseline is opened with
an explicit warning instead. Dropped-field explanations stay in the report,
not in the saved model. Generation warnings clear when the output is edited;
the built-in JSON schema diagnostics continue to work.

Copilot requires model access and consent. When unavailable, the extension
explains the failure and offers the non-Copilot baseline; it does not silently
substitute one. Set `azure-iot-toolkit.wot.ai.enabled` to `false` to hide Copilot
entries. **Don't ask again** disables
`azure-iot-toolkit.wot.promptOnNewSchema` for that workspace folder. **Not now**
or dismissing the prompt suppresses repeat prompts for that file.
No generation runs automatically, and telemetry never includes schema/model
content. Device-type grouping, templates, composition, and reference resolution
are deferred beyond this first end-to-end prototype (M1–M3).

The default schema folder has a narrow `workspaceContains:wot/schemas/*.json`
activation event. Custom schema folders rely on another activation trigger
(including this extension's existing startup activation or a WoT command).
