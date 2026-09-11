
export interface VariableSource {
    tabId: string;
    requestId?: string;
    requestName?: string;
    requestUrl?: string;
    type: 'header' | 'param' | 'body' | 'response';
    propertyKey?: string;
}

export interface IGlobalVariable {
    id: string;
    key: string;
    value: string;
    enabled: boolean;
    source?: VariableSource;
}
