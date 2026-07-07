# Contributing to Kestra for VS Code

## Code of Conduct

This project and everyone participating in it is governed by the
[Kestra Code of Conduct](https://github.com/kestra-io/kestra/blob/develop/.github/CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code. Please report unacceptable behavior
to <hello@kestra.io>.

## I Want To Contribute

> ### Legal Notice
> When contributing to this project, you must agree that you have authored 100% of the content, that you have the necessary rights to the content and that the content you contribute may be provided under the project license.

### Reporting bugs

Search the [existing issues](https://github.com/kestra-io/vscode-kestra/issues) before opening a new one to avoid duplicates. A good report includes your VS Code version, the extension version, your Kestra instance version, and the steps to reproduce.

### Reporting security issues

Please do not create a public GitHub issue. If you have found a security issue, email us directly at <hello@kestra.io> instead of raising an issue.

### Requesting new features

Open an issue on this repository describing the problem you want to solve and how the feature would address it. Check the [open issues](https://github.com/kestra-io/vscode-kestra/issues) first for duplicates.

### Your first code contribution

#### Requirements

- Node 20+ and npm
- VS Code
- A running Kestra instance to test against (optional, but most features connect to one)

#### Setup

Fork the repository, clone your fork, and install dependencies:

```shell
git clone git@github.com:{YOUR_USERNAME}/vscode-kestra.git
cd vscode-kestra
npm install
```

- `npm run compile-web` builds the extension bundle (`npm run watch-web` rebuilds on change)
- `npm run lint`
- `npm test` runs the unit tests

Press F5 (Run and Debug) to launch an Extension Development Host with the extension loaded.

#### Design tokens

Webview colors come from Kestra's design system, not from hand-picked values.

- `scripts/tokens.scss` declares the tokens the panels use. Each color points at a palette variable from `@kestra-io/design-system`, with the mapping copied from the package's `ks-theme-dark-2.scss` and `ks-theme-light.scss`. Sizes and code block colors are local values, documented in place.
- `npm run tokens` compiles it to `media/tokens.css`, the file the webviews load. It runs automatically on every build. Never edit `media/tokens.css`, the next build overwrites it.
- In panel stylesheets, use `var(--ks-*)` for anything Kestra-colored and `var(--vscode-*)` only for fonts.
- To pick up a design change from core, bump the `@kestra-io/design-system` version and rebuild. The diff of `media/tokens.css` shows every color that moved.
- To add a token, add one line to `scripts/tokens.scss` pointing at the palette variable the theme file uses for it.

#### Package a local VSIX

`npx @vscode/vsce package` creates a `.vsix` you can install via Extensions: Install from VSIX.

#### Embedding in a local Kestra instance

To build and copy the web extension into a local Kestra checkout for web testing:

```shell
alias extension="OLD_PWD=$(pwd) && \
    npm run package-web && \
    cp dist/web/extension.js {pathToKestraRoot}/ui/public/vscode/extensions/kestra/extension/dist/web/ && \
    cp package.json {pathToKestraRoot}/ui/public/vscode/extensions/kestra/extension/ && \
    cd {pathToKestraRoot} && \
    rm -rf webserver/src/main/resources/ui && \
    ./gradlew assembleFrontend && \
    cd $OLD_PWD"
```

### Improving the documentation

The extension's own docs live in the [README](README.md). The main Kestra documentation is in a separate [repository](https://github.com/kestra-io/kestra.io).

## Release

Push a tag `vX.Y.Z`. The `Release` workflow builds and publishes to the VS Code Marketplace, and the tag defines the published version. Lint, build, and tests run on push and pull requests via the `Main` workflow.
