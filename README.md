<p align="center">
  <a href="https://www.kestra.io">
    <img src="https://kestra.io/banner.png" alt="Kestra workflow orchestrator" />
  </a>
</p>

<h1 align="center" style="border-bottom: none">
    Kestra for VS Code
</h1>

<h3 align="center" style="border-bottom: none">
    Event-Driven Declarative Orchestrator
</h3>

<div align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=kestra-io.kestra"><img src="https://img.shields.io/visual-studio-marketplace/v/kestra-io.kestra?color=blueviolet&label=VS%20Marketplace" alt="VS Marketplace version" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=kestra-io.kestra"><img src="https://img.shields.io/visual-studio-marketplace/i/kestra-io.kestra?color=blueviolet&label=installs" alt="Installs" /></a>
  <a href="https://kestra.io"><img src="https://img.shields.io/badge/Website-kestra.io-192A4E?color=blueviolet" alt="Kestra"></a>
  <a href="https://kestra.io/slack"><img src="https://img.shields.io/badge/Slack-Join%20Community-blueviolet?logo=slack" alt="Slack"></a>
</div>

<br />

<p align="center">
  <a href="https://twitter.com/kestra_io" style="margin: 0 10px;">
        <img src="https://kestra.io/twitter.svg" alt="twitter" width="35" height="25" /></a>
  <a href="https://www.linkedin.com/company/kestra/" style="margin: 0 10px;">
        <img src="https://kestra.io/linkedin.svg" alt="linkedin" width="35" height="25" /></a>
  <a href="https://www.youtube.com/@kestra-io" style="margin: 0 10px;">
        <img src="https://kestra.io/youtube.svg" alt="youtube" width="35" height="25" /></a>
</p>

<br />

<p align="center">
    <a href="https://go.kestra.io/video/product-overview" target="_blank">
        <img src="https://kestra.io/startvideo.png" alt="Get started in 4 minutes with Kestra" width="640px" />
    </a>
</p>
<p align="center" style="color:grey;"><i>Get started with Kestra in 4 minutes.</i></p>

<br />

Author Kestra flows in VS Code with live validation, `{{ }}` autocompletion, and per-task documentation, all backed by the schema and validation of the Kestra instance you connect to.

<!-- Capture a short demo GIF, commit it under docs/, then uncomment:
![Kestra extension demo](https://raw.githubusercontent.com/kestra-io/vscode-kestra/main/docs/demo.gif)
-->

## Features

- **Live validation** as you type: the connected instance's validate endpoint runs on each edit and surfaces the same errors as `flow validate`.
- **`{{ }}` autocompletion** for Pebble expressions: context variables, functions, filters, and the flow's own input and task ids.
- **Instance-aware schema**: task and property autocompletion plus structural validation from your instance's installed plugin versions, not a generic all-plugins schema.
- **Missing required fields**: inline suggestions for the required properties a task still needs.
- **Task documentation**: open a task's documentation in a side panel.

## Requirements

- [Red Hat YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)

## Setup

Set the URL of your Kestra instance, and a tenant if it is multi-tenant:

```json
"kestra.api.url": "http://localhost:8080/api/v1",
"kestra.api.tenant": "main"
```

On a secured instance you are prompted for credentials on the first request. It supports basic auth (username and password), an Enterprise Edition API token (sent as a Bearer token), and a legacy JWT session token. Use the `Kestra: Sign in` command to set or change credentials, and `Kestra: Sign out` to clear them.

## Usage

### Schema and autocompletion

The flow schema is downloaded from the instance set in `kestra.api.url`, so it matches that instance's installed plugin versions. It is cached per instance and re-downloaded when the URL or tenant changes. A property valid in `latest` but missing on your instance is therefore flagged. The `Download Kestra schema` command forces a refresh, for example after installing a plugin.

The schema attaches to any open YAML detected as a flow (it declares `id`, `namespace`, and `tasks` or `triggers`). To restrict it to a specific folder instead, [set up a file mapping](https://code.visualstudio.com/docs/languages/json#_mapping-in-the-user-settings).

### Documentation

On a flow file, the `Open Kestra Documentation` action opens a panel with the flow and task documentation. Clicking a task in your code shows that task's documentation.

## Configuration

- `kestra.api.url`: URL of your Kestra instance.
- `kestra.api.tenant`: Tenant id for multi-tenant instances. Leave empty for instances that do not use tenant-scoped API routes.
- `kestra.schema.match-path`: Restrict the schema to files under a path, for example `_flows`.

## Screenshots

<!-- Capture short GIFs (VS Code screen recordings), commit them under docs/, then uncomment:

### Live validation
![Live validation](https://raw.githubusercontent.com/kestra-io/vscode-kestra/main/docs/validation.gif)

### Expression autocompletion
![Expression autocompletion](https://raw.githubusercontent.com/kestra-io/vscode-kestra/main/docs/autocomplete.gif)

### Missing required fields
![Missing required fields](https://raw.githubusercontent.com/kestra-io/vscode-kestra/main/docs/required-fields.gif)
-->

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for building, packaging, and releasing the extension.
