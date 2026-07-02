import {FlowInput, LogEntry} from '../shared/flow';

export type HostMessage =
    | {type: 'reset'; flow: string; level: string}
    | {type: 'phase'; text: string}
    | {type: 'execution'; id: string; url: string}
    | {type: 'logs'; entries: LogEntry[]}
    | {type: 'task'; taskId: string; state: string; duration?: number}
    | {type: 'status'; state: string}
    | {type: 'error'; text: string}
    | {type: 'inputs'; inputs: FlowInput[]}
    | {type: 'fileChosen'; inputId: string; name: string};

export type WebviewMessage =
    | {type: 'ready'}
    | {type: 'copy'; text: string}
    | {type: 'submitInputs'; values: Record<string, string>}
    | {type: 'cancelInputs'}
    | {type: 'pickFile'; inputId: string};

export type GraphNode = {uid: string; type: string; task?: {id?: string; type?: string}; triggerDeclaration?: {id?: string; type?: string}};
export type FlowGraph = {
    nodes: GraphNode[];
    edges: Array<{source: string; target: string}>;
    clusters?: Array<{cluster: {uid: string; taskNode?: GraphNode}; nodes: string[]}>;
};

export type TopologyHostMessage =
    | {type: 'graph'; graph: FlowGraph | undefined; icons: Record<string, string>}
    | {type: 'message'; text: string}
    | {type: 'taskState'; taskId: string; state: string}
    | {type: 'resetStates'};

export type TopologyWebviewMessage =
    | {type: 'ready'}
    | {type: 'reveal'; taskId: string};
