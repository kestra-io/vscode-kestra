import cytoscape from 'cytoscape';
import {STATE_BUCKETS} from '../shared/executionState';

// Cytoscape draws to a canvas, so its stylesheet is data, not CSS. Colors still come from tokens.css at render time.

function cssVar(name: string, fallback: string): string {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

export function graphStyle(): cytoscape.StylesheetJson {
    const accent = cssVar('--ks-status-running', '#9869f7');
    const clusterBorder = cssVar('--ks-topology-border-flowable-task', '#1761fd');
    const triggersBorder = cssVar('--ks-topology-border-triggers', '#029e73');
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
        // One live-state border per bucket, colored by the status tokens.
        ...STATE_BUCKETS.map(bucket => ({
            selector: `node.task.run-${bucket}`,
            style: {'border-color': cssVar(`--ks-status-${bucket === 'failed' ? 'error' : bucket}`, '#9797a6'), 'border-opacity': 1, 'border-width': 2}
        })),
        {
            selector: 'node.cluster',
            style: {
                'shape': 'round-rectangle',
                'background-color': clusterBorder,
                'background-opacity': 0.1,
                'border-color': clusterBorder,
                'border-width': 1,
                'border-opacity': 1,
                'label': 'data(label)',
                'color': cssVar('--ks-status-info', '#718bfe'),
                'font-size': 11,
                'font-weight': 600,
                'text-background-color': cssVar('--ks-bg-badge', '#20232d'),
                'text-background-opacity': 1,
                'text-background-shape': 'roundrectangle',
                'text-background-padding': '5',
                // valign top puts the label above the box, the margin pulls it back inside the padding band.
                'text-valign': 'top',
                'text-halign': 'center',
                'text-margin-y': 24,
                'padding': '30'
            }
        },
        {
            selector: 'node.cluster.triggers',
            style: {
                'background-color': triggersBorder,
                'border-color': triggersBorder,
                'color': triggersBorder
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
                // Orthogonal elbow routing.
                'curve-style': 'taxi',
                'taxi-direction': 'auto',
                'taxi-turn': 24,
                'taxi-turn-min-distance': 12
            }
        },
        {selector: 'edge.hl', style: {'line-color': accent, 'target-arrow-color': accent, 'line-opacity': 1, 'width': 2}}
    ];
}
