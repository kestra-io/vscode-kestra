import {FlowGraph, FlowInput, LogEntry} from '../shared/flow';

export type HostMessage =
    | {type: 'reset'; flow: string; level: string}
    | {type: 'phase'; text: string}
    | {type: 'execution'; id: string; url: string}
    | {type: 'logs'; entries: LogEntry[]}
    | {type: 'taskState'; taskId: string; state: string; duration?: number}
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

export type TopologyHostMessage =
    | {type: 'graph'; graph: FlowGraph | undefined; icons: Record<string, string>}
    | {type: 'message'; text: string}
    | {type: 'taskState'; taskId: string; state: string}
    | {type: 'resetStates'};

export type TopologyWebviewMessage =
    | {type: 'ready'}
    | {type: 'reveal'; taskId: string};
