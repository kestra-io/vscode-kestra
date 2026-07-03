import * as vscode from 'vscode';
import ApiClient from './apiClient';
import YamlUtils from './libs/yamlUtils';
import {durationOf} from './libs/runHelpers';
import {readSseStream} from './libs/sse';
import {isFlowDocument, splitConstraints, ValidateResult} from './flowValidation';
import {RunOutput, createRunOutput} from './runOutput';
import {FlowInput, LogEntry, flattenInputs} from '../shared/flow';

type Flow = {id: string; namespace: string; inputs?: FlowInput[]};
type TaskState = {current?: string; histories?: Array<{date?: string}>};
type Execution = {
    state?: {current?: string};
    taskRunList?: Array<{taskId?: string; state?: TaskState}>;
};

// The log indexer is asynchronous, so trailing lines can land after the execution turns terminal.
const LOG_FLUSH_GRACE_MS = 2000;

export async function runFlowFromEditor(apiClient: ApiClient, extensionUri: vscode.Uri) {
    const flow = activeFlow();
    if (!flow) {
        return;
    }
    const {source, id, namespace, inputs} = flow;
    const flowUid = `${namespace}.${id}`;

    const {output, fetchLevel, logLevel} = createRunOutput(extensionUri, flowUid);
    output.reset(flowUid, logLevel);

    await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, title: `Running ${flowUid} on Kestra`, cancellable: false},
        async () => {
            try {
                if (!(await passesValidation(apiClient, source, output)) || !(await deploy(apiClient, namespace, id, source, output))) {
                    return;
                }

                const leaves = flattenInputs(inputs);
                let body: FormData | undefined;
                if (leaves.length > 0) {
                    body = await output.requestInputs(leaves);
                    if (body === undefined) {
                        output.setPhase("Run cancelled.");
                        return;
                    }
                }

                const executionId = await startExecution(apiClient, namespace, id, body, output);
                if (!executionId) {
                    return;
                }
                output.setExecution(executionId, await ApiClient.executionUiUrl(namespace, id, executionId));
                await followExecution(apiClient, executionId, output, fetchLevel);
            } catch (error) {
                output.error(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
                output.setStatus("FAILED");
            }
        }
    );
}

export async function saveFlowFromEditor(apiClient: ApiClient) {
    const flow = activeFlow();
    if (!flow) {
        return;
    }
    let response: Response;
    try {
        response = await apiClient.upsertFlow(flow.namespace, flow.id, flow.source);
    } catch {
        // apiCall already surfaced the connection error
        return;
    }
    if (!response.ok) {
        vscode.window.showErrorMessage(`Failed to save flow (HTTP ${response.status}): ${await responseMessage(response)}`);
        return;
    }
    const revision = ((await response.json().catch(() => ({}))) as {revision?: number}).revision;
    vscode.window.showInformationMessage(`Saved ${flow.namespace}.${flow.id} to Kestra${revision ? ` (revision ${revision})` : ''}.`);
}

function activeFlow(): (Flow & {source: string}) | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("Open a flow YAML file to run it on Kestra.");
        return undefined;
    }
    if (!isFlowDocument(editor.document)) {
        vscode.window.showErrorMessage("The active file is not a valid flow: it must define 'id', 'namespace', and 'tasks' or 'triggers'.");
        return undefined;
    }
    const source = editor.document.getText();
    const flow = YamlUtils.toObject(source) as Flow | null;
    return flow ? {...flow, source} : undefined;
}

async function passesValidation(apiClient: ApiClient, source: string, output: RunOutput): Promise<boolean> {
    const response = await apiClient.validateFlow(source);
    // A failed validation call is not a verdict, so proceed and let deploy surface the real error.
    if (!response.ok) {
        return true;
    }
    const results = (await response.json()) as ValidateResult[];
    const constraints = (results ?? []).flatMap(result => splitConstraints(result.constraints));
    if (constraints.length > 0) {
        constraints.forEach(constraint => output.error(constraint));
        output.setStatus("FAILED");
        return false;
    }
    return true;
}

// The server's error body carries the actual reason, statusText is empty on HTTP/2.
async function responseMessage(response: Response): Promise<string> {
    const body = (await response.json().catch(() => ({}))) as {message?: string};
    return body.message ?? response.statusText;
}

async function deploy(apiClient: ApiClient, namespace: string, id: string, source: string, output: RunOutput): Promise<boolean> {
    const response = await apiClient.upsertFlow(namespace, id, source);
    if (!response.ok) {
        output.error(`Failed to deploy flow (HTTP ${response.status}): ${await responseMessage(response)}`);
        output.setStatus("FAILED");
        return false;
    }
    return true;
}

async function startExecution(apiClient: ApiClient, namespace: string, id: string, body: FormData | undefined, output: RunOutput): Promise<string | undefined> {
    const response = await apiClient.executionsApi(`/${namespace}/${id}`, {method: "POST", body});
    if (!response.ok) {
        output.error(`Failed to start execution (HTTP ${response.status}): ${await responseMessage(response)}`);
        output.setStatus("FAILED");
        return undefined;
    }
    return ((await response.json()) as {id: string}).id;
}

// Streams are always cancelled on exit, an open follow leaks memory on the server.
async function followExecution(apiClient: ApiClient, executionId: string, output: RunOutput, fetchLevel: string): Promise<void> {
    const logsResponse = await apiClient.logsApi(`/${executionId}/follow?minLevel=${fetchLevel}`);
    const logsReader = logsResponse.ok && logsResponse.body ? logsResponse.body.getReader() : undefined;
    if (!logsReader) {
        output.error("Failed to stream logs from the instance.");
    }
    const logsStream = logsReader
        ? readSseStream(logsReader, frame => onLogFrame(frame.name, frame.data, output)).catch(() => output.setPhase("Log stream disconnected."))
        : Promise.resolve();

    let lastState = "";
    let execReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
        const execResponse = await apiClient.executionsApi(`/${executionId}/follow`);
        if (execResponse.ok && execResponse.body) {
            execReader = execResponse.body.getReader();
            const sentTaskStates = new Map<string, string>();
            await readSseStream(execReader, frame => {
                const state = onExecutionFrame(frame.data, output, sentTaskStates);
                if (state && state !== lastState) {
                    lastState = state;
                    output.setStatus(state);
                }
            });
        }
    } catch {
        // A dropped follow stream is not a run verdict, the final-state fetch below decides.
        lastState = "";
    } finally {
        await execReader?.cancel().catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, LOG_FLUSH_GRACE_MS));
        await logsReader?.cancel().catch(() => undefined);
        await logsStream;
    }

    // The stream can close without a terminal frame, so confirm the final state once.
    if (!lastState) {
        const finalResponse = await apiClient.executionsApi(`/${executionId}`);
        if (finalResponse.ok) {
            const state = ((await finalResponse.json()) as {state?: {current?: string}}).state?.current;
            output.setStatus(state ?? "UNKNOWN");
        }
    }
}

function onLogFrame(name: string | undefined, data: string | undefined, output: RunOutput) {
    if (name === "start" || name === "end" || !data || data === "{}") {
        return;
    }
    try {
        const entries = JSON.parse(data) as LogEntry | LogEntry[];
        output.appendLogs(Array.isArray(entries) ? entries : [entries]);
    } catch {
        // Ignore keep-alive comments and non-JSON frames.
    }
}

// The follow stream re-sends the full task list on every frame, so only forward actual changes.
function onExecutionFrame(data: string | undefined, output: RunOutput, sentTaskStates: Map<string, string>): string | undefined {
    if (!data || data === "{}") {
        return undefined;
    }
    try {
        const execution = JSON.parse(data) as Execution;
        execution.taskRunList?.forEach(taskRun => {
            if (!taskRun.taskId) {
                return;
            }
            const state = taskRun.state?.current ?? "";
            const duration = durationOf(taskRun.state);
            const snapshot = `${state}|${duration ?? ""}`;
            if (sentTaskStates.get(taskRun.taskId) !== snapshot) {
                sentTaskStates.set(taskRun.taskId, snapshot);
                output.setTaskState(taskRun.taskId, state, duration);
            }
        });
        return execution.state?.current;
    } catch {
        // Ignore non-JSON frames.
        return undefined;
    }
}
