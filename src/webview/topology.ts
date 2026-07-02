import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import {stateBucket, StateBucket} from '../shared/executionState';
import {FlowGraph, TopologyHostMessage, TopologyWebviewMessage} from './messages';

cytoscape.use(dagre);

interface VsCodeApi {
    postMessage(message: TopologyWebviewMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

const message = el('div', 'message', 'Loading topology...');
const graphEl = el('div', 'graph');
const fit = el('button', 'fit', 'Fit');
document.body.append(message, graphEl, fit);

// Reused across updates so live edits swap elements instead of rebuilding the whole graph each time.
let cy: cytoscape.Core | undefined;
const LAYOUT = {name: 'dagre', rankDir: 'LR', nodeSep: 25, rankSep: 50, padding: 24, fit: true} as cytoscape.LayoutOptions;

const RUN_CLASSES = 'run-success run-running run-warning run-failed';
const RUN_CLASS: Record<StateBucket, string> = {
    success: 'run-success',
    running: 'run-running',
    info: 'run-running',
    warning: 'run-warning',
    pending: 'run-warning',
    failed: 'run-failed',
    neutral: ''
};

function cssVar(name: string, fallback: string): string {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function showMessage(text: string) {
    graphEl.style.display = 'none';
    fit.style.display = 'none';
    message.style.display = 'block';
    message.textContent = text;
}

function toElements(graph: FlowGraph, icons: Record<string, string>): cytoscape.ElementDefinition[] {
    const elements: cytoscape.ElementDefinition[] = [];

    // Clusters become compound parent nodes wrapping all their members, including the flowable task itself.
    const parentOf: Record<string, string> = {};
    for (const cluster of graph.clusters ?? []) {
        elements.push({data: {id: cluster.cluster.uid, label: cluster.cluster.taskNode?.task?.id ?? ''}, classes: 'cluster'});
        for (const child of cluster.nodes ?? []) {
            parentOf[child] = cluster.cluster.uid;
        }
    }

    for (const node of graph.nodes) {
        const isTask = node.type.endsWith('GraphTask');
        elements.push({
            data: {
                id: node.uid,
                label: isTask ? node.task?.id ?? '' : '',
                parent: parentOf[node.uid],
                taskId: node.task?.id ?? '',
                icon: (isTask && node.task?.type ? icons[node.task.type] : undefined) ?? 'none'
            },
            classes: isTask ? 'task' : 'boundary'
        });
    }
    for (const edge of graph.edges ?? []) {
        elements.push({data: {id: `${edge.source}->${edge.target}`, source: edge.source, target: edge.target}});
    }
    return elements;
}

function graphStyle(): cytoscape.StylesheetJson {
    const accent = cssVar('--ks-status-running', '#9869f7');
    const foreground = cssVar('--vscode-foreground', '#cccccc');
    const cardBackground = cssVar('--vscode-editorWidget-background', '#252526');
    const edgeColor = cssVar('--vscode-foreground', '#ffffff');

    return [
        {
            selector: 'node.task',
            style: {
                'shape': 'round-rectangle',
                'background-color': cardBackground,
                'background-image': 'data(icon)',
                'background-width': '22px',
                'background-height': '22px',
                'background-position-x': '12px',
                'background-position-y': '50%',
                'background-clip': 'none',
                'border-color': foreground,
                'border-opacity': 0.35,
                'border-width': 1,
                'width': 200,
                'height': 48,
                'label': 'data(label)',
                'color': foreground,
                'font-size': 14,
                'font-weight': 600,
                'text-valign': 'center',
                'text-halign': 'center',
                'text-margin-x': 16,
                'text-wrap': 'ellipsis',
                'text-max-width': '130'
            }
        },
        {selector: 'node.boundary', style: {'width': 1, 'height': 1, 'opacity': 0}},
        {selector: 'node.task.run-success', style: {'border-color': cssVar('--ks-status-success', '#43f6b6'), 'border-opacity': 1, 'border-width': 2}},
        {selector: 'node.task.run-running', style: {'border-color': accent, 'border-opacity': 1, 'border-width': 2}},
        {selector: 'node.task.run-warning', style: {'border-color': cssVar('--ks-status-warning', '#ff8b61'), 'border-opacity': 1, 'border-width': 2}},
        {selector: 'node.task.run-failed', style: {'border-color': cssVar('--ks-status-error', '#ff6a6c'), 'border-opacity': 1, 'border-width': 2}},
        {
            selector: 'node.cluster',
            style: {
                'shape': 'round-rectangle',
                'background-color': accent,
                'background-opacity': 0.07,
                'border-color': accent,
                'border-width': 1,
                'border-opacity': 0.4,
                'label': 'data(label)',
                'color': accent,
                'font-size': 11,
                'font-weight': 600,
                'text-valign': 'top',
                'text-halign': 'left',
                'padding': '18'
            }
        },
        {
            selector: 'edge',
            style: {
                'width': 1.5,
                'line-color': edgeColor,
                'line-style': 'dashed',
                'line-cap': 'round',
                'line-dash-pattern': [1, 5],
                'line-opacity': 0.7,
                'source-arrow-color': edgeColor,
                'source-arrow-shape': 'circle',
                'source-distance-from-node': 6,
                'target-arrow-color': edgeColor,
                'target-arrow-shape': 'triangle',
                'target-distance-from-node': 2,
                'arrow-scale': 0.4,
                'curve-style': 'bezier'
            }
        },
        {selector: 'edge.hl', style: {'line-color': accent, 'target-arrow-color': accent, 'line-opacity': 1, 'width': 2}}
    ];
}

function render(graph: FlowGraph | undefined, icons: Record<string, string>) {
    if (!graph?.nodes) {
        showMessage('No graph returned.');
        return;
    }
    message.style.display = 'none';
    graphEl.style.display = 'block';
    fit.style.display = 'block';

    const elements = toElements(graph, icons);
    if (cy) {
        cy.batch(() => {
            cy!.elements().remove();
            cy!.add(elements);
        });
        cy.layout(LAYOUT).run();
        return;
    }

    cy = cytoscape({container: graphEl, elements, style: graphStyle(), layout: LAYOUT});
    // Wire interactions once (cy is reused across updates, selector-delegated handlers persist).
    cy.on('tap', 'node.task', event => vscode.postMessage({type: 'reveal', taskId: event.target.data('taskId')}));
    cy.on('mouseover', 'node.task', event => event.target.connectedEdges().addClass('hl'));
    cy.on('mouseout', 'node.task', event => event.target.connectedEdges().removeClass('hl'));
}

function setTaskState(taskId: string, state: string) {
    const bucket = stateBucket(state);
    const runClass = bucket ? RUN_CLASS[bucket] : '';
    cy?.nodes('.task').forEach(node => {
        if (node.data('taskId') === taskId) {
            node.removeClass(RUN_CLASSES);
            if (runClass) {
                node.addClass(runClass);
            }
        }
    });
}

fit.addEventListener('click', () => cy?.fit(undefined, 24));

window.addEventListener('message', event => {
    const m = event.data as TopologyHostMessage;
    switch (m.type) {
        case 'graph':
            render(m.graph, m.icons);
            break;
        case 'message':
            showMessage(m.text);
            break;
        case 'taskState':
            setTaskState(m.taskId, m.state);
            break;
        case 'resetStates':
            cy?.nodes('.task').removeClass(RUN_CLASSES);
            break;
    }
});

vscode.postMessage({type: 'ready'});
