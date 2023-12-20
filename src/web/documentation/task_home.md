## Task documentation

Flows consist of **tasks**.

To inspect the properties of a **specific task**, click anywhere in that task code. The task documentation will load in this view.

Note that you need *an active Internet connection* to view that documentation, as it's served via API.

## Task properties

All tasks have the following core properties:

* `id` - a unique identifier for the task
* `type` - a full Java class name that represents the type of task
* `description` - your custom documentation of what the task does
* `retry` - how often should the task be retried in case of a failure, and the [type of retry strategy](https://kestra.io/docs/developer-guide/errors-handling#retries) 
* `timeout` - the [maximum time allowed](https://kestra.io/docs/flow-examples/timeout) for the task to complete. 
* `disabled` - a boolean flag indicating whether the task is disabled or not; if set to `true`, the task will be skipped during execution
* `workerGroup` - the [group of workers](https://kestra.io/blogs/2023-07-10-release-0-10-blueprints-worker-groups-scripts#worker-group) that are eligible to execute the task; you can specify a `workerGroup.key`
* `logLevel` - the level of log detail to be stored.
