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
