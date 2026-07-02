import * as vscode from 'vscode';
import ApiClient from './apiClient';
import YamlUtils from './libs/yamlUtils';
import {durationOf} from './libs/runHelpers';
import {readSseStream} from './libs/sse';
import RunPanel from './runPanel';
import {FlowInput, LogEntry, RunOutput, RunLog} from './runOutput';

type Flow = {id: string; namespace: string; inputs?: FlowInput[]};
type TaskState = {current?: string; histories?: Array<{date?: string}>};
type Execution = {
    state?: {current?: string};
    taskRunList?: Array<{taskId?: string; state?: TaskState}>;
};

// The log indexer is asynchronous, so trailing lines can land after the execution turns terminal.
// The Kestra UI waits 2s before closing its log stream; mirror that.
const LOG_FLUSH_GRACE_MS = 2000;

export async function runFlowFromEditor(apiClient: ApiClient, extensionUri: vscode.Uri) {
    const flow = activeFlow();
    if (!flow) {
        return;
    }
    const {source, id, namespace, inputs} = flow;

    const mode = vscode.workspace.getConfiguration("kestra.run").get("output") as string;
    const logLevel = (vscode.workspace.getConfiguration("kestra.run").get("logLevel") as string) || "INFO";
    // The panel has its own level dropdown, so fetch everything for it.
    const minLevel = mode === "logs" ? logLevel : "TRACE";
    const panel: RunOutput = mode === "logs" ? RunLog.get() : RunPanel.createOrShow(extensionUri);
    panel.reset(`${namespace}.${id}`);

    await vscode.window.withProgress(
        {location: vscode.ProgressLocation.Notification, title: `Running ${namespace}.${id} on Kestra`, cancellable: false},
        async () => {
            try {
                if (!(await validate(apiClient, source, panel)) || !(await deploy(apiClient, namespace, id, source, panel))) {
                    return;
                }
                const body = await collectInputs(inputs, panel);
                if (body === "cancelled") {
                    return;
                }
                const executionId = await startExecution(apiClient, namespace, id, body, panel);
                if (!executionId) {
                    return;
                }
                panel.setExecution(executionId, await ApiClient.executionUiUrl(namespace, id, executionId));
                panel.setStatus(await followExecution(apiClient, executionId, panel, minLevel));
            } catch (error) {
                panel.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
                panel.setStatus("FAILED");
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
    const source = editor.document.getText();
    if (!YamlUtils.isFlow(source)) {
        vscode.window.showErrorMessage("The active file is not a valid flow: it must define 'id', 'namespace', and 'tasks' or 'triggers'.");
        return undefined;
    }
    const flow = YamlUtils.toObject(source) as Flow | null;
    return flow ? {...flow, source} : undefined;
}

async function validate(apiClient: ApiClient, source: string, panel: RunOutput): Promise<boolean> {
    const response = await apiClient.validateFlow(source);
    if (!response.ok) {
        return true;
    }
    const results = (await response.json()) as Array<{constraints?: string | null}>;
    const constraints = results?.map(r => r.constraints).filter((c): c is string => Boolean(c)) ?? [];
    if (constraints.length > 0) {
        constraints.forEach(c => panel.error(c));
        panel.setStatus("FAILED");
        return false;
    }
    return true;
}

async function deploy(apiClient: ApiClient, namespace: string, id: string, source: string, panel: RunOutput): Promise<boolean> {
    const response = await apiClient.upsertFlow(namespace, id, source);
    if (!response.ok) {
        const message = ((await response.json().catch(() => ({}))) as {message?: string}).message;
        panel.error(`Failed to deploy flow (HTTP ${response.status}): ${message ?? response.statusText}`);
        panel.setStatus("FAILED");
        return false;
    }
    return true;
}

async function collectInputs(inputs: FlowInput[] | undefined, panel: RunOutput): Promise<FormData | undefined | "cancelled"> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
        return undefined;
    }
    const body = await panel.requestInputs(inputs);
    if (body === undefined) {
        panel.setPhase("Run cancelled.");
        return "cancelled";
    }
    return body;
}

async function startExecution(apiClient: ApiClient, namespace: string, id: string, body: FormData | undefined, panel: RunOutput): Promise<string | undefined> {
    const response = await apiClient.executionsApi(`/${namespace}/${id}`, {method: "POST", body});
    if (!response.ok) {
        panel.error(`Failed to start execution (HTTP ${response.status}): ${response.statusText}`);
        panel.setStatus("FAILED");
        return undefined;
    }
    return ((await response.json()) as {id: string}).id;
}

// Always cancel both streams; an open follow leaks memory on the server.
async function followExecution(apiClient: ApiClient, executionId: string, panel: RunOutput, minLevel: string): Promise<string> {
    const logsResponse = await apiClient.logsApi(`/${executionId}/follow?minLevel=${minLevel}`);
    const logsReader = logsResponse.ok && logsResponse.body ? logsResponse.body.getReader() : undefined;
    if (!logsReader) {
        panel.error("Could not stream logs from the instance.");
    }
    const logsStream = logsReader
        ? readSseStream(logsReader, frame => onLogFrame(frame.name, frame.data, panel)).catch(() => undefined)
        : Promise.resolve();

    let finalState = "UNKNOWN";
    let execReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
        const execResponse = await apiClient.executionsApi(`/${executionId}/follow`);
        if (execResponse.ok && execResponse.body) {
            execReader = execResponse.body.getReader();
            await readSseStream(execReader, frame => {
                finalState = onExecutionFrame(frame.data, panel) ?? finalState;
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

function onLogFrame(name: string | undefined, data: string | undefined, panel: RunOutput) {
    if (name === "start" || name === "end" || !data || data === "{}") {
        return;
    }
    try {
        const entries = JSON.parse(data) as LogEntry | LogEntry[];
        (Array.isArray(entries) ? entries : [entries]).forEach(entry => panel.appendLog(entry));
    } catch {
        // Ignore keep-alive comments and non-JSON frames.
    }
}

function onExecutionFrame(data: string | undefined, panel: RunOutput): string | undefined {
    if (!data || data === "{}") {
        return undefined;
    }
    try {
        const execution = JSON.parse(data) as Execution;
        execution.taskRunList?.forEach(taskRun => {
            if (taskRun.taskId) {
                panel.updateTask?.(taskRun.taskId, taskRun.state?.current ?? "", durationOf(taskRun.state));
            }
        });
        return execution.state?.current;
    } catch {
        // Ignore non-JSON frames.
        return undefined;
    }
}

