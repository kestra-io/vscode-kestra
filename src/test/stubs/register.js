// Routes require("vscode") to the stub, so provider code can be loaded outside the editor.
const path = require("path");
const Module = require("module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    if (request === "vscode") {
        return path.join(__dirname, "vscode.ts");
    }
    return resolve.call(this, request, ...rest);
};
