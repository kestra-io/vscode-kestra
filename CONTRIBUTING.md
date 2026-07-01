# Contributing

## Build and test

- `npm install`
- `npm run compile-web` builds the extension bundle (`npm run watch-web` rebuilds on change)
- `npm run lint`
- `npm test` runs the unit tests

Press F5 (Run and Debug) to launch an Extension Development Host with the extension loaded.

## Package a local VSIX

`npx @vscode/vsce package` creates a `.vsix` you can install via Extensions: Install from VSIX.

## Embedding in a local Kestra instance

To build and copy the web extension into a local Kestra checkout for web testing:

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

## Release

Push a tag `vX.Y.Z`. The `Release` workflow builds and publishes to the VS Code Marketplace, and the tag defines the published version. Lint, build, and tests run on push and pull requests via the `Main` workflow.
