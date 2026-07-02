import {FlowInput, LogEntry} from '../shared/flow';

export type HostMessage =
    | {type: 'reset'; flow: string}
    | {type: 'phase'; text: string}
    | {type: 'execution'; id: string; url: string}
    | ({type: 'log'} & LogEntry)
    | {type: 'task'; taskId: string; state: string; duration?: number}
    | {type: 'status'; state: string}
    | {type: 'error'; text: string}
    | {type: 'inputs'; inputs: FlowInput[]}
    | {type: 'fileChosen'; inputId: string; name: string};

export type WebviewMessage =
    | {type: 'ready'}
    | {command: 'openExternal'; url: string}
    | {command: 'copy'; text: string}
    | {command: 'submitInputs'; values: Record<string, string>}
    | {command: 'cancelInputs'}
    | {command: 'pickFile'; inputId: string};
