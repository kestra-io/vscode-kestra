## Viewing Task Documentation

### Load task documentation

Kestra flow's are made of tasks. To view the documentation for a specific task, simply click on the task. The documentation for that task will load in this view.

*Please note that the task documentation is loaded from the Kestra API, so you will need an active internet connection to view it.*

### Common tasks properties

* `id` - A unique identifier for the task.
* `type` - The type of task to be executed.
* `description` - A brief explanation of what the task does.
* `retry` - The number of times the task should be retried in case of failure. More details [here](https://kestra.io/docs/developer-guide/errors-handling#retries).
* `timeout` - The maximum time allowed for the task to complete. More details [here](https://kestra.io/docs/flow-examples/timeout).
* `disabled` - A boolean value indicating whether the task is disabled or not.
* `workerGroup` - The group of workers that are eligible to execute the task.
* `logLevel` - The level of log detail for the task.
