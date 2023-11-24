# Documentation

## Introduction

Welcome to our Kestra documentation! Kestra is a powerful open-source orchestration tool that allows you to automate and manage complex workflows with ease.

This guide will walk you through the process of creating flows in Kestra providing you the basics.

**You can also click on a task in your code to get more details about it**

## Basics

> Flows are used to implement your workload. They define all the tasks you want to perform and the order in which they will be run.

You define a flow thanks to a declarative model in YAML.

A flow must have an identifier (id), a namespace, and a list of tasks.

A flow can also have [inputs](./04.inputs.md), [error handlers](./07.errors-handling.md), and [triggers](./08.triggers/index.md).

## Flow Properties

The following flow properties can be set.

| Field | Description                                                                                                                                                                                  |
| ---------- |----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|`id`| The flow identifier, must be unique inside a namespace.                                                                                                                                      |
|`namespace`| Each flow lives in one namespace, this is useful for flow organization and is mandatory.                                                                                                     |
|`revision`| The flow version, handled internally by Kestra, and incremented for each modification. You should not manually set it.                                                                       |
|`description`| The description of the flow, more details [here](#document-your-flow).                                                                                                                       |
|`labels`| The list of labels which are string key/value pairs.                                                                                                                                         |
|`inputs`| The list of inputs, more details [here](./04.inputs.md).                                                                                                                                     |
|`variables`| The list of variables (such as api key, table name, URL, etc) that can be reached inside tasks with `{{ vars.name }}`.                                                                       |
|`tasks`| The list of tasks, all tasks will be run sequentially.                                                                                                                                       |
|`errors`| The list of error tasks, all listed tasks will be run sequentially only if there is an error on the current execution. More details [here](./07.errors-handling.md).                         |
|`listeners`| The list of listeners, more details [here](./13.listeners.md).                                                                                                                               |
|`triggers`| The list of triggers which are external events (such as date schedule or message presence in a broker, for example) that will launch this flow, more details [here](./08.triggers/index.md). |
|[`taskDefaults`](#taskdefaults)| The list of default task values, this avoid repeating the same properties on each tasks.                                                                                                     |
|`taskDefaults.[].type`| The task type is a full qualified Java class name.                                                                                                                                           |
|`taskDefaults.[].forced`| If set to `forced: true`, the taskDefault will take precedence over properties defined in the task (default `false`).                                                                        |
|`taskDefaults.[].values.xxx`| The task property that you want to be set as default.                                                                                                                                        |
|`disabled`| Set it to `true` to disable execution of the flow.

## Flow sample

Here is a sample flow definition. It uses tasks available in Kestra core for testing purposes.

```yaml
id: samples
namespace: io.kestra.tests
description: "Some flo w **documentation** in *Markdown*"

labels:
  env: prd
  country: FR

inputs:
  - name: my-value
    type: STRING
    required: false
    defaults: "default value"
    description: This is a not required my-value

variables:
  first: "1"
  second: "{{vars.first}} > 2"

tasks:
  - id: date
    type: io.kestra.core.tasks.debugs.Return
    description: "Some tasks **documentation** in *Markdown*"
    format: "A log line content with a contextual date variable {{taskrun.startDate}}"

taskDefaults:
  - type: io.kestra.core.tasks.log.Log
    values:
      level: ERROR
```
                     |

## Links

* [Tutorial](https://kestra.io/docs/tutorial)

* [Complete documentation](https://kestra.io/docs)

* [Need help? Join the community!](https://kestra.io/slack)