import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import {stateBucket, STATE_BUCKETS} from '../shared/executionState';
import {FlowGraph, graphNodeId, graphNodePluginType} from '../shared/flow';
import {TopologyHostMessage, TopologyWebviewMessage} from './messages';
import {acquireApi, el} from './dom';
import {graphStyle} from './topologyStyle';

cytoscape.use(dagre);

const vscode = acquireApi<TopologyWebviewMessage>();

const message = el('div', 'message', 'Loading topology...');
const graphEl = el('div', 'graph');
const rotate = el('button', 'rotate', '⟳');
rotate.title = 'Rotate layout';
document.body.append(message, graphEl, rotate);

// Reused across updates so live edits swap elements instead of recreating the view each time.
let cy: cytoscape.Core | undefined;
let rankDir: 'LR' | 'TB' = 'TB';

function layoutOptions(): cytoscape.LayoutOptions {
    return {name: 'dagre', rankDir, nodeSep: 25, rankSep: 50, padding: 24, fit: true} as cytoscape.LayoutOptions;
}

// Icons arrive as deltas with each graph, so keep the accumulated map for re-renders.
const iconMap: Record<string, string> = {};

const RUN_CLASSES = STATE_BUCKETS.map(bucket => `run-${bucket}`).join(' ');

function showMessage(text: string) {
    graphEl.style.display = 'none';
    rotate.style.display = 'none';
    message.style.display = 'block';
    message.textContent = text;
}

function toElements(graph: FlowGraph): cytoscape.ElementDefinition[] {
    const elements: cytoscape.ElementDefinition[] = [];

    // Clusters become compound parent nodes wrapping all their members, including the flowable task
    // itself and any nested cluster, so branch boxes render inside their parent box.
    const parentOf: Record<string, string> = {};
    for (const cluster of graph.clusters ?? []) {
        for (const child of cluster.nodes ?? []) {
            parentOf[child] = cluster.cluster.uid;
        }
    }
    for (const cluster of graph.clusters ?? []) {
        // The triggers cluster has no task node; the API identifies it by its fixed uid.
        const isTriggers = cluster.cluster.uid.endsWith('.Triggers');
        elements.push({
            data: {
                id: cluster.cluster.uid,
                label: isTriggers ? 'Triggers' : cluster.cluster.taskNode?.task?.id ?? '',
                parent: parentOf[cluster.cluster.uid]
            },
            classes: isTriggers ? 'cluster triggers' : 'cluster'
        });
    }

    for (const node of graph.nodes) {
        // Nodes without a declared id (cluster entries and exits) are invisible waypoints;
        // tasks and triggers render as cards.
        const id = graphNodeId(node);
        const pluginType = graphNodePluginType(node);
        elements.push({
            data: {
                id: node.uid,
                label: id,
                parent: parentOf[node.uid],
                taskId: id,
                icon: (pluginType ? iconMap[pluginType] : undefined) ?? 'none'
            },
            classes: id ? 'task' : 'boundary'
        });
    }
    for (const edge of graph.edges ?? []) {
        elements.push({data: {id: `${edge.source}->${edge.target}`, source: edge.source, target: edge.target}});
    }
    return elements;
}

function render(graph: FlowGraph, icons: Record<string, string>) {
    if (!graph.nodes) {
        showMessage('No graph returned.');
        return;
    }
    Object.assign(iconMap, icons);
    message.style.display = 'none';
    graphEl.style.display = 'block';
    rotate.style.display = 'block';

    const elements = toElements(graph);
    if (cy) {
        const core = cy;
        core.batch(() => {
            core.elements().remove();
            core.add(elements);
        });
        core.layout(layoutOptions()).run();
        return;
    }

    cy = cytoscape({container: graphEl, elements, style: graphStyle(), layout: layoutOptions()});
    // Wire interactions once (cy is reused across updates, selector-delegated handlers persist).
    cy.on('tap', 'node.task', event => vscode.postMessage({type: 'reveal', taskId: event.target.data('taskId')}));
    cy.on('mouseover', 'node.task', event => event.target.connectedEdges().addClass('hl'));
    cy.on('mouseout', 'node.task', event => event.target.connectedEdges().removeClass('hl'));
}

function setTaskState(taskId: string, state: string) {
    const bucket = stateBucket(state);
    const runClass = bucket ? `run-${bucket}` : '';
    cy?.nodes('.task').forEach(node => {
        if (node.data('taskId') === taskId) {
            node.removeClass(RUN_CLASSES);
            if (runClass) {
                node.addClass(runClass);
            }
        }
    });
}

rotate.addEventListener('click', () => {
    rankDir = rankDir === 'LR' ? 'TB' : 'LR';
    cy?.layout(layoutOptions()).run();
});

window.addEventListener('message', event => {
    const m = event.data as TopologyHostMessage;
    switch (m.type) {
        case 'graph':
            render(m.graph, m.icons);
            break;
        case 'notice':
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
