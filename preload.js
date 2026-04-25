const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

contextBridge.exposeInMainWorld("electronAPI", {
  readdirSync: (dir) => fs.readdirSync(dir),
  readFileSync: (filePath) => fs.readFileSync(filePath, "utf-8"),
  joinPath: (...args) => path.join(...args),
  getCwd: () => process.cwd(),
  readJson: (path) => JSON.parse(fs.readFileSync(path, "utf-8")),
  runPython: (payload) => ipcRenderer.invoke("run-python", payload),
  onDebugPaused: (callback) =>
    ipcRenderer.on("debug-paused", (_, data) => callback(data)),

  onDebugVariables: (callback) =>
    ipcRenderer.on("debug-variables", (_, data) => callback(data)),

  evaluate: (expr) => ipcRenderer.invoke("debug-evaluate", expr),
  continueDebug: () => ipcRenderer.invoke("debug-continue"),

  onPythonOutput: (callback) =>
    ipcRenderer.on("python-output", (_, data) => callback(data)),

  runAnnotate: (payload) => ipcRenderer.invoke("run-annotate", payload),

  readFile: (filePath) => ipcRenderer.invoke("read-file", filePath),
});
