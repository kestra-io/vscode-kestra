# Kestra extension for VSCode

## Features
- Flow autocompletion & validation on .yaml / .yml files by downloading the JSON schema from your Kestra's instance or Kestra's API server as a fallback (meaning you will see all plugins except custom ones, even those which are not yet installed on your instance)

## Requirements
- [Redhat's YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)

## Usage 
After installing the extension, you will get a new command called "Download Kestra schema" which will prompt you for a Kestra's instance URL. By default it will use the Kestra's API server which has the above-described issues.
Once you proceed, you will get a notification asking for a window reload, please save all your changes then proceed.
You now have autocompletion and validation for every .yaml / .yml files. If you have multiple yaml autocompletion helpers, please select the Kestra's one 