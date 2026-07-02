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

    const {output, fetchLevel, logLevel} = createRunOutput(extensionUri);
    output.reset(`${namespace}.${id}`, logLevel);

    await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, title: `Running ${namespace}.${id} on Kestra`, cancellable: false},
        async () => {
            try {
                if (!(await validate(apiClient, source, output)) || !(await deploy(apiClient, namespace, id, source, output))) {
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
                output.setStatus(await followExecution(apiClient, executionId, output, fetchLevel));
            } catch (error) {
                output.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
                output.setStatus("FAILED");
            }
        }
    );
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

async function validate(apiClient: ApiClient, source: string, output: RunOutput): Promise<boolean> {
    const response = await apiClient.validateFlow(source);
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

async function deploy(apiClient: ApiClient, namespace: string, id: string, source: string, output: RunOutput): Promise<boolean> {
    const response = await apiClient.upsertFlow(namespace, id, source);
    if (!response.ok) {
        const message = ((await response.json().catch(() => ({}))) as {message?: string}).message;
        output.error(`Failed to deploy flow (HTTP ${response.status}): ${message ?? response.statusText}`);
        output.setStatus("FAILED");
        return false;
    }
    return true;
}

async function startExecution(apiClient: ApiClient, namespace: string, id: string, body: FormData | undefined, output: RunOutput): Promise<string | undefined> {
    const response = await apiClient.executionsApi(`/${namespace}/${id}`, {method: "POST", body});
    if (!response.ok) {
        output.error(`Failed to start execution (HTTP ${response.status}): ${response.statusText}`);
        output.setStatus("FAILED");
        return undefined;
    }
    return ((await response.json()) as {id: string}).id;
}

// Always cancel both streams; an open follow leaks memory on the server.
async function followExecution(apiClient: ApiClient, executionId: string, output: RunOutput, fetchLevel: string): Promise<string> {
    const logsResponse = await apiClient.logsApi(`/${executionId}/follow?minLevel=${fetchLevel}`);
    const logsReader = logsResponse.ok && logsResponse.body ? logsResponse.body.getReader() : undefined;
    if (!logsReader) {
        output.error("Could not stream logs from the instance.");
    }
    const logsStream = logsReader
        ? readSseStream(logsReader, frame => onLogFrame(frame.name, frame.data, output)).catch(() => undefined)
        : Promise.resolve();

    let finalState = "UNKNOWN";
    let execReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
        const execResponse = await apiClient.executionsApi(`/${executionId}/follow`);
        if (execResponse.ok && execResponse.body) {
            execReader = execResponse.body.getReader();
            const sentTaskStates = new Map<string, string>();
            await readSseStream(execReader, frame => {
                finalState = onExecutionFrame(frame.data, output, sentTaskStates) ?? finalState;
            });
        }
    } finally {
        await execReader?.cancel().catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, LOG_FLUSH_GRACE_MS));
        await logsReader?.cancel().catch(() => undefined);
        await logsStream;
    }

    if (finalState === "UNKNOWN") {
        const finalResponse = await apiClient.executionsApi(`/${executionId}`);
        if (finalResponse.ok) {
            finalState = ((await finalResponse.json()) as {state?: {current?: string}}).state?.current ?? "UNKNOWN";
        }
    }
    return finalState;
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
                output.updateTask(taskRun.taskId, state, duration);
            }
        });
        return execution.state?.current;
    } catch {
        // Ignore non-JSON frames.
        return undefined;
    }
}
