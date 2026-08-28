export const kestraBaseUrl = "https://api.kestra.io/v1";

// URI scheme of a mounted namespace folder.
export const kestraScheme = "kestra";

export const yamlContentType = "application/x-yaml";

export const flowSchemaUri = "kestra:/flow-schema.json";

export interface PebbleFunctionDef {
    name: string;
    arguments: Array<{name: string; defaultValue: string | null}>;
}

// Instances the user has opened a namespace on, which a folder URI may pin to without asking.
export const knownInstancesKey = "kestra.instances.known";

export const schemaStateKey = {
    schema: "kestra.yaml.schema",
    source: "kestra.yaml.schema.source"
};

export const secretStorageKey = {
    username: "kestra.username",
    password: "kestra.password",
    token: "kestra.token",
    apiToken: "kestra.apiToken"
};