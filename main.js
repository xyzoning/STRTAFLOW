const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

let mainWindow;

function writeFileInWSL(filePath, content) {
  return new Promise((resolve, reject) => {
    const proc = spawn("wsl", [
      "bash",
      "-c",
      `cat > ${filePath} << 'EOF'\n${content}\nEOF`,
    ]);

    proc.on("close", () => resolve());
    proc.on("error", reject);
  });
}

// =========================
// 🪟 Create Window
// =========================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile("index.html");

  // Optional: open DevTools automatically
  // mainWindow.webContents.openDevTools();
}

// =========================
// 🚀 App Lifecycle
// =========================
app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// =========================
// 🐍 Run Python Code
// =========================

function send(socket, msg) {
  const fullMsg = {
    seq: seq++,
    type: "request",
    ...msg,
  };

  const json = JSON.stringify(fullMsg);

  socket.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

let seq = 1;

function handleDAPMessage(msg) {
  console.log("DAP:", msg);

  // 1️⃣ After initialize → attach
  if (msg.type === "response" && msg.command === "initialize") {
    console.log("Initialize complete → attaching");

    send(socket, {
      command: "attach",
      arguments: {
        connect: { host: "127.0.0.1", port: 5678 },
      },
    });
  }

  // 2️⃣ After attach → wait for initialized event
  if (msg.type === "event" && msg.event === "initialized") {
    console.log("Debugger ready → setting breakpoints");

    send(socket, {
      command: "setBreakpoints",
      arguments: {
        source: { path: tempFile },
        breakpoints: breakpoints.map((l) => ({ line: l })),
      },
    });

    send(socket, {
      command: "configurationDone",
      arguments: {},
    });
  }

  // 3️⃣ After config → start execution
  if (msg.type === "response" && msg.command === "attach") {
    console.log("Config done → running");

    //send(socket, {command: "continue", arguments: { threadId: 1 },});

    console.log("handleDAPMessage attach");
  }

  // 4️⃣ When paused
  if (msg.type === "event" && msg.event === "stopped") {
    console.log("Paused!");

    send(socket, {
      command: "stackTrace",
      arguments: { threadId: 1 },
    });
  }

  // 5️⃣ Get line number → send to UI
  if (msg.type === "response" && msg.command === "stackTrace") {
    console.log("handleDAPMessage response or stackTrace");
    const frame = msg.body.stackFrames[0];
    const line = frame.line;
    currentFrameId = frame.id;

    mainWindow.webContents.send("debug-paused", {
      line,
      pane: 1,
    });

    send(socket, {
      command: "scopes",
      arguments: {
        frameId: frame.id,
      },
    });
  }

  if (msg.type === "response" && msg.command === "scopes") {
    const scopes = msg.body.scopes;

    // Usually "Locals" is what you want
    const localScope = scopes.find((s) => s.name === "Locals");

    if (localScope) {
      send(socket, {
        command: "variables",
        arguments: {
          variablesReference: localScope.variablesReference,
        },
      });
    }
  }

  if (msg.type === "response" && msg.command === "variables") {
    const vars = msg.body.variables;

    console.log("Variables:", vars);

    mainWindow.webContents.send("debug-variables", vars);
  }
}

function connectDebugger(breakpointsInput, filePathInput, socket) {
  breakpoints = breakpointsInput;
  tempFile = filePathInput;

  send(socket, {
    command: "initialize",
    arguments: {
      clientID: "strataflow",
      adapterID: "python",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
    },
  });

  let buffer = "";

  socket.on("data", (data) => {
    buffer += data.toString();

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length: (\d+)/);
      if (!match) break;

      const length = parseInt(match[1], 10);
      const totalLength = headerEnd + 4 + length;

      if (buffer.length < totalLength) break;

      const body = buffer.slice(headerEnd + 4, totalLength);
      buffer = buffer.slice(totalLength);

      const msg = JSON.parse(body);
      handleDAPMessage(msg);

      socket.emit("dap-message", msg);
    }
  });
}

function cleanupDebugger() {
  if (socket) {
    socket.destroy();
    socket = null;
  }

  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
}

function connectDebuggerWithRetry(breakpoints, filePath, retries = 10) {
  socket = new net.Socket();

  socket.connect(5678, "127.0.0.1", () => {
    console.log("Connected to debugpy");
    connectDebugger(breakpoints, filePath, socket);
  });

  socket.on("close", () => {
    console.log("Debugger socket closed");
  });

  socket.on("error", () => {
    if (retries > 0) {
      console.log("Retrying debugger connection...");
      setTimeout(() => {
        connectDebuggerWithRetry(breakpoints, filePath, retries - 1);
      }, 300);
    } else {
      console.error("Failed to connect to debugpy");
    }
  });
}

let pythonProcess = null;
let socket = null; // ✅ global debugpy connection
let currentFrameId = null; // ✅ current paused frame

const net = require("net");

ipcMain.handle("run-python", async (event, payload) => {
  const { code, breakpoints = [] } = payload;

  cleanupDebugger();

  try {
    const tempFile = "/home/hwj/git/edu/cs/prj/SLM-Lab/temp.py";

    // =========================
    // 1. Write file
    // =========================
    await writeFileInWSL(tempFile, code);

    console.log("Running with debugpy. Breakpoints:", breakpoints);

    // =========================
    // 2. Start Python + debugpy
    // =========================

    pythonProcess = spawn("wsl", [
      "bash",
      "-l",
      "-c",
      //"cd /home/hwj/git/edu/cs/prj/SLM-Lab && source .venv/bin/activate && /home/hwj/.local/bin/uv run python3 -u -m debugpy --listen 5678 temp.py",
      "cd /home/hwj/git/edu/cs/prj/SLM-Lab && source .venv/bin/activate && python3 -u -m debugpy --listen 5678 temp.py",
    ]);

    // =========================
    // 3. Stream output
    // =========================
    pythonProcess.stdout.on("data", (data) => {
      event.sender.send("python-output", data.toString());
    });

    pythonProcess.stderr.on("data", (data) => {
      event.sender.send("python-output", data.toString());
    });

    // =========================
    // 4. Connect debugger (better retry)
    // =========================
    connectDebuggerWithRetry(breakpoints, tempFile);

    // =========================
    // 5. Finish
    // =========================
    return new Promise((resolve) => {
      pythonProcess.on("close", () => {
        console.log("Python finished");
        if (socket) {
          try {
            send(socket, { command: "disconnect", arguments: {} });
          } catch (e) {}

          socket.end(); // graceful close
          socket.destroy(); // force close if needed
          socket = null;
        }

        resolve("DONE");
      });

      pythonProcess.on("error", (err) => {
        console.error("Spawn error:", err);
        resolve("Spawn error:\n" + err.message);
      });
    });
  } catch (err) {
    console.error(err);
    return "Execution error:\n" + err.message;
  }
});

ipcMain.handle("run-annotate", async (event, payload) => {
  const { pseudo, code } = payload;

  return new Promise((resolve) => {
    try {
      fs.writeFileSync(path.join(__dirname, "temp_pesudo.txt"), pseudo);

      fs.writeFileSync(path.join(__dirname, "temp.py"), code);

      const pythonProcess = spawn("python", [
        "llm_annotator.py",
        "--pseudo",
        "temp_pesudo.txt",
        "--source",
        "temp.py",
      ]);

      let output = "";
      let error = "";

      pythonProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        error += data.toString();
      });

      pythonProcess.on("close", () => {
        if (error) resolve("ERROR:\n" + error);
        else
          resolve({
            output: output,
            filePath: path.join(__dirname, "temp_annotated.py"),
          });
      });

      pythonProcess.on("error", (err) => {
        resolve("Spawn error:\n" + err.message);
      });
    } catch (err) {
      resolve("Execution error:\n" + err.message);
    }
  });
});

ipcMain.handle("debug-evaluate", async (event, expression) => {
  return new Promise((resolve) => {
    if (!socket) {
      return resolve("No debug session");
    }

    if (!currentFrameId) {
      return resolve("Not paused");
    }

    send(socket, {
      command: "evaluate",
      arguments: {
        expression,
        frameId: currentFrameId,
        context: "hover",
      },
    });

    const handler = (msg) => {
      if (
        msg.type === "response" &&
        msg.command === "evaluate" &&
        msg.success === true
      ) {
        socket.off("dap-message", handler);
        resolve(msg.body.result);
      }
    };

    socket.on("dap-message", handler);
  });
});

ipcMain.handle("debug-continue", async () => {
  if (!socket) {
    console.log("No active debug session");
    return;
  }

  console.log("Continuing execution...");

  send(socket, {
    command: "continue",
    arguments: {
      threadId: 1, // ⚠️ usually 1 for Python
    },
  });
});

ipcMain.handle("read-file", async (event, filePath) => {
  return fs.readFileSync(filePath, "utf-8");
});
