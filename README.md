# Kestra extension for VSCode

## Features

- Flow autocompletion & validation on `.yaml` / `.yml` files by downloading the JSON schema.
- Dynamic documentation depending on tasks your flow includes.

## Requirements

- [Redhat's YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)

## Usage 

### Kestra Schema - Enabling autocompletion

After installing the extension, you will get a new command called "Download Kestra schema".
You can use this command to download the schema that will enable autocompletion in YAML files.

To avoid having the schema apply on every YAML file, you can [set up the mapping in your settings file](https://code.visualstudio.com/docs/languages/json#_mapping-in-the-user-settings).

**Using the extension on the Kestra VSCode Kestra will automatically download the Schema.**

### Kestra Documentation - enabling live documentation

Kestra VSCode extension embeds the documentation. When on a YAML file, a new action called `Open Kestra Documentation` will appear and will open a new Webview. This webview contains the default properties of a flow and its tasks, but clicking on a specific task in your code will show its documentation.

## Configure

When using the extension on your local instance of VSCode, you will be prompted to enter a URL.
The default URL is the Kestra API that includes all plugins, but if you want to only display available plugins in your instance, use your Kestra Instance URL 

**If you have a JWT-based authentication (EE), please copy your token from the "Copy JWT token" button available in the same menu as the Logout button on the UI.**

## Development

You can use the following alias to quickly install your extension to local Kestra instance for web extension testing:
```
alias extension="OLD_PWD=$(pwd) && \
    npm run package-web && \
    cp dist/web/extension.js {pathToKestraRoot}/ui/public/vscode/extensions/kestra/extension/dist/web/ && \
    cp package.json {pathToKestraRoot}/ui/public/vscode/extensions/kestra/extension/ && \
    cd {pathToKestraRoot} && \
    rm -rf webserver/src/main/resources/ui && \
    ./gradlew assembleFrontend && \
    cd $OLD_PWD"
```

## Package for local VSIX installation
`npm run vsix` will create a VSIX of your extension which you can use for local extension installation

## Publish
̀`npm run publish` will increment the patch version and publish the package to VSCode extension marketplace.
However you should use `vsce login kestra-io` before to be able to do so.