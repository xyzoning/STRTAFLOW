console.log("Renderer loaded!");

// ✅ Correct destructuring from the bridge
const { readdirSync, readFileSync, joinPath, getCwd } = window.electronAPI;

let editor1, editor2, pseudo1, pseudo2;
let currentTarget = 1; // 1 = Source Code (File 1), 2 = Source Code (File 2)

let currentMappings1 = {};
let currentMappings2 = {};

let decorations = [];

function updateDecorations() {
  decorations = editor1.deltaDecorations(
    decorations,
    Array.from(breakpoints).map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        glyphMarginClassName: "breakpoint",
      },
    })),
  );
}

let breakpoints = new Set();

function toggleBreakpoint(line) {
  if (breakpoints.has(line)) {
    breakpoints.delete(line);
  } else {
    breakpoints.add(line);
  }

  updateDecorations();
}

let decorations1 = [];
let decorations2 = [];

function highlightLine(lineNumber, pane) {
  const editor = pane === 1 ? editor1 : editor2;

  if (!editor) return;

  const newDecorations = [
    {
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        className: "current-line-highlight",
        glyphMarginClassName: "current-line-arrow",
      },
    },
  ];

  if (pane === 1) {
    decorations1 = editor.deltaDecorations(decorations1, newDecorations);
  } else {
    decorations2 = editor.deltaDecorations(decorations2, newDecorations);
  }

  editor.revealLineInCenter(lineNumber);
}

let pseudoDecorations = [];

function highlightPseudocode(editor) {
  const model = editor.getModel();
  const lines = model.getLinesContent();

  const decorations = [];

  lines.forEach((line, i) => {
    if (line.includes("##Pseudocode")) {
      decorations.push({
        range: new monaco.Range(i + 1, 1, i + 1, line.length + 1),
        options: {
          isWholeLine: true,
          className: "pseudocode-line",
        },
      });
    } else if (line.includes("##Explanation")) {
      decorations.push({
        range: new monaco.Range(i + 1, 1, i + 1, line.length + 1),
        options: {
          isWholeLine: true,
          className: "explanation-line",
        },
      });
    } else if (line.includes("#Details")) {
      decorations.push({
        range: new monaco.Range(i + 1, 1, i + 1, line.length + 1),
        options: {
          isWholeLine: true,
          className: "details-line",
        },
      });
    }
  });

  pseudoDecorations = editor.deltaDecorations(pseudoDecorations, decorations);
}

require.config({
  paths: { vs: "https://unpkg.com/monaco-editor@0.45.0/min/vs" },
});

require(["vs/editor/editor.main"], function () {
  // ================================
  // 🧠 LLM Interaction (ADD HERE)
  // ================================
  function attachLLMInteraction(editor) {
    editor.onMouseUp((e) => {
      if (!e.event.shiftKey) return;

      const selection = editor.getSelection();
      if (!selection) return;

      const selectedText = editor.getModel().getValueInRange(selection).trim();
      if (!selectedText) return;

      console.log("LLM Trigger:", selectedText);

      // Optional highlight (if you already have it)
      if (typeof highlightSelection === "function") {
        highlightSelection(editor, selection);
      }
      console.log("LLM handleLLMQuery before", typeof handleLLMQuery);
      if (typeof window.handleLLMQuery === "function") {
        window.handleLLMQuery(selectedText);
      }
    });
  }

  // ✅ 1. Register pseudo language
  monaco.languages.register({ id: "pseudo" });

  monaco.languages.setMonarchTokensProvider("pseudo", {
    tokenizer: {
      root: [
        [/\b(for|do|end|if|else|while|return)\b/, "keyword"],
        [/[a-zA-Z_][a-zA-Z0-9_]*/, "identifier"],
        [/\d+/, "number"],
        [/".*?"/, "string"],
      ],
    },
  });

  monaco.languages.setMonarchTokensProvider("verilog", {
    keywords: [
      "module",
      "endmodule",
      "input",
      "output",
      "wire",
      "reg",
      "always",
      "begin",
      "end",
      "if",
      "else",
      "case",
      "endcase",
      "assign",
      "posedge",
      "negedge",
    ],

    operators: [
      "=",
      "==",
      "!=",
      "<",
      ">",
      "<=",
      ">=",
      "+",
      "-",
      "*",
      "/",
      "%",
      "&",
      "|",
      "^",
      "~",
      "<<",
      ">>",
    ],

    symbols: /[=><!~?:&|+\-*\/\^%]+/,

    tokenizer: {
      root: [
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@default": "identifier",
            },
          },
        ],

        { include: "@whitespace" },

        [/[{}()\[\]]/, "@brackets"],

        [
          /@symbols/,
          {
            cases: {
              "@operators": "operator",
              "@default": "",
            },
          },
        ],

        [/\d+/, "number"],

        [/".*?"/, "string"],
      ],

      whitespace: [
        [/[ \t\r\n]+/, ""],
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
      ],

      comment: [
        [/[^/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/./, "comment"],
      ],
    },
  });

  // ✅ 2. Define theme
  monaco.editor.defineTheme("pseudoTheme", {
    base: "vs",
    inherit: false,
    rules: [
      { token: "keyword", foreground: "00FFFF", fontStyle: "bold italic" },
      { token: "identifier", foreground: "000000" },
      { token: "number", foreground: "008800" },
      { token: "string", foreground: "AA0000" },
    ],
    colors: {
      "editor.foreground": "#000000",
      "editor.background": "#FFFFFF",
    },
  });

  pseudo1 = monaco.editor.create(document.getElementById("pseudo1"), {
    value: "",
    language: "pseudo",
    theme: "pseudoTheme",
    readOnly: true,
    automaticLayout: true,

    // 🎯 Final styling (single source of truth)
    fontFamily: "Georgia, serif",
    fontSize: 16,
    lineNumbers: "on",

    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: "bounded",
    glyphMargin: false,
    folding: false,
  });

  pseudo2 = monaco.editor.create(document.getElementById("pseudo2"), {
    value: "",
    language: "pseudo",
    theme: "pseudoTheme",
    readOnly: true,
    automaticLayout: true,

    // 🎯 Final styling (single source of truth)
    fontFamily: "Segoe UI, sans-serif",
    fontSize: 16,
    lineNumbers: "on",

    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: "bounded",
    glyphMargin: false,
    folding: false,
  });

  monaco.editor.defineTheme("strataTheme", {
    base: "vs-dark",
    inherit: true,
    rules: [{ token: "keyword", foreground: "0000FF", fontStyle: "bold" }],
    colors: {
      "editor.background": "#808080",
      "editor.foreground": "#000000",
    },
  });

  // ✅ Initialize Editor 1
  editor1 = monaco.editor.create(document.getElementById("editor1"), {
    value: "# Source Code (File 1)\n# Click a file to load it here",
    language: "python",
    theme: "vs-dark",
    automaticLayout: true,
    glyphMargin: true,
  });

  editor1.onDidChangeModelContent(() => {
    highlightPseudocode(editor1);
  });

  editor1.onMouseDown((e) => {
    console.log("CLICK EVENT:", e.target.type);
    if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
      const line = e.target.position.lineNumber;
      console.log("BREAKPOINT CLICKED LINE:", line);
      toggleBreakpoint(line);
    }
  });

  // ✅ Initialize Editor 2
  editor2 = monaco.editor.create(document.getElementById("editor2"), {
    value: "# Source Code (File 2)\n# Click a file to load it here",
    language: "python",
    theme: "vs-dark",
    automaticLayout: true,
  });

  editor2.onDidChangeModelContent(() => {
    highlightPseudocode(editor2);
  });

  editor2.onMouseDown((e) => {
    console.log("CLICK EVENT:", e.target.type);
    if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
      const line = e.target.position.lineNumber;
      console.log("BREAKPOINT CLICKED LINE:", line);
      toggleBreakpoint(line);
    }
  });

  pseudo1.onMouseDown((e) => {
    // Only care about real positions
    if (!e.target.position) return;

    // Ignore gutter clicks (reserve for breakpoints later)
    if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
      return;
    }

    // Detect double click
    if (e.event.detail === 2) {
      const line = e.target.position.lineNumber;
      console.log("Double-click line:", line);

      handleSyncScroll(line, 1);
    }
  });

  pseudo2.onMouseDown((e) => {
    // Only care about real positions
    if (!e.target.position) return;

    // Ignore gutter clicks (reserve for breakpoints later)
    if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
      return;
    }

    // Detect double click
    if (e.event.detail === 2) {
      const line = e.target.position.lineNumber;
      console.log("Double-click line:", line);

      handleSyncScroll(line, 2);
    }
  });

  attachLLMInteraction(editor1);
  attachLLMInteraction(editor2);
  attachLLMInteraction(pseudo1);
  attachLLMInteraction(pseudo2);

  window.electronAPI.onDebugPaused((data) => {
    console.log("Paused at:", data);

    highlightLine(data.line, data.pane);
  });

  window.electronAPI.onDebugVariables((vars) => {
    const outputDiv = document.getElementById("output1");
    outputDiv.innerText += "vvvvvvvvvvvvvvvvvvvvvv\n";
    outputDiv.innerText += vars.map((v) => `${v.name} = ${v.value}`).join("\n");
    outputDiv.innerText += "\n^^^^^^^^^^^^^^^^^^^^^^\n";
  });

  window.electronAPI.onPythonOutput((data) => {
    const outputDiv = document.getElementById("output1");

    // ✅ append instead of replace
    outputDiv.innerText += `[OUTPUT] ${data.replace(/\n$/, "")}\n`;

    // auto-scroll
    outputDiv.scrollTop = outputDiv.scrollHeight;
  });

  monaco.languages.registerHoverProvider("python", {
    provideHover: async (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return;

      const expression = word.word;

      try {
        // ✅ THIS is the missing call
        const result = await window.electronAPI.evaluate(expression);

        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          ),
          contents: [
            { value: `**${expression}**` },
            { value: `\`\`\`\n${result}\n\`\`\`` },
          ],
        };
      } catch (err) {
        return {
          contents: [{ value: "Error evaluating expression" }],
        };
      }
    },
  });

  document.getElementById("runBtn1").onclick = async () => {
    const runBtn = document.getElementById("runBtn1");
    runBtn.disabled = true;

    document.getElementById("output1").innerText = "";

    const code = editor1.getValue(); // get Python code

    const payload = {
      code: code,
      breakpoints: Array.from(breakpoints), // 👈 ADD THIS
    };

    await window.electronAPI.runPython(payload);

    runBtn.disabled = false;
  };

  document.getElementById("annotateBtn1").onclick = async () => {
    const btn = document.getElementById("annotateBtn1");
    btn.disabled = true;

    pseudo_text = pseudo1.getValue();
    code_text = editor1.getValue();

    const payload = {
      pseudo: pseudo_text,
      code: code_text,
    };

    const result = await window.electronAPI.runAnnotate(payload);

    console.log(result);

    // ✅ show output text
    document.getElementById("output1").innerText = result.output;

    // ✅ NEW: reload updated file into editor
    if (result.filePath) {
      const updatedCode = await window.electronAPI.readFile(result.filePath);
      editor1.setValue(updatedCode);
    }

    btn.disabled = false;
  };

  document.getElementById("continueBtn1").onclick = () => {
    window.electronAPI.continueDebug();
  };

  document.getElementById("runBtn2").onclick = async () => {
    const code = editor2.getValue(); // get Python code

    const result = await window.electronAPI.runPython(code);

    console.log("Output:", result);

    // show in output pane
    document.getElementById("output2").innerText = result;
  };

  document.getElementById("continueBtn2").onclick = () => {
    window.electronAPI.continueDebug();
  };

  loadFileList();
});

function handleSyncScroll(lineNum, paneIndex) {
  console.log("handleSyncScroll");
  const targetEditor = paneIndex === 1 ? editor1 : editor2;
  const mapping = paneIndex === 1 ? currentMappings1 : currentMappings2;

  if (!targetEditor || !mapping) return;

  const targetSourceLine = mapping[lineNum] || mapping[lineNum - 1];

  if (!targetSourceLine) return;

  targetEditor.revealLineInCenter(targetSourceLine);

  targetEditor.setSelection({
    startLineNumber: targetSourceLine,
    startColumn: 1,
    endLineNumber: targetSourceLine,
    endColumn: targetEditor.getModel().getLineMaxColumn(targetSourceLine),
  });
}

function getLanguageFromFilename(filename) {
  const ext = filename.split(".").pop().toLowerCase();

  switch (ext) {
    case "py":
      return "python";
    case "js":
      return "javascript";
    case "ts":
      return "typescript";
    case "html":
      return "html";
    case "css":
      return "css";
    case "json":
      return "json";
    case "v":
      return "verilog"; // your custom one
    case "sv":
      return "verilog"; // SystemVerilog (same tokenizer if you want)
    default:
      return "plaintext";
  }
}

function loadFileList() {
  // Use the destructured joinPath and getCwd
  const dir = joinPath(getCwd(), "examples");

  let files = [];
  try {
    files = readdirSync(dir);
  } catch (err) {
    console.error("Error reading folder:", err);
    return;
  }

  const list = document.getElementById("fileList");
  list.innerHTML = "";

  files.forEach((file) => {
    if (file.endsWith(".py") || file.endsWith(".v")) {
      const li = document.createElement("li");
      li.textContent = file;
      li.style.padding = "4px 8px";
      li.style.cursor = "pointer";

      // Toggle logic on click
      li.onclick = () => loadFile(file);

      list.appendChild(li);
    }
  });
}

function loadFile(filename) {
  const baseName = filename.replace(/\.(py|v)$/, "");
  const sourcePath = joinPath(getCwd(), "examples", filename);
  const pseudoPath = joinPath(getCwd(), "examples", `${baseName}.txt`);
  const mappingPath = joinPath(getCwd(), "examples", `${baseName}.json`);

  try {
    const sourceContent = readFileSync(sourcePath);

    let pseudoContent = "No pseudo code found for this file.";
    try {
      console.log("pseudoPath", pseudoPath);
      pseudoContent = readFileSync(pseudoPath);
    } catch (e) {
      /* ignore missing pseudo file */
    }

    try {
      const mappingData = window.electronAPI.readJson(mappingPath);
      if (currentTarget === 1) {
        currentMappings1 = mappingData;
      } else {
        currentMappings2 = mappingData;
      }
    } catch (e) {
      // Reset to empty if no json found
      if (currentTarget === 1) currentMappings1 = {};
      else currentMappings2 = {};
    }

    const displayName = filename;

    if (currentTarget === 1) {
      editor1.setValue(sourceContent);
      pseudo1.setValue(pseudoContent);

      const language = getLanguageFromFilename(filename);
      const model = monaco.editor.createModel(sourceContent, language);
      monaco.editor.setModelLanguage(model, language);
      const pseudo_title = document.getElementById("pseudo_title1");
      const source_title = document.getElementById("source_title1");

      if (pseudo_title)
        pseudo_title.textContent = `Pseudo Code (${displayName})`;
      if (source_title)
        source_title.textContent = `Source Code (${displayName})`;

      // Safety check before styling
      if (pseudo_title) pseudo_title.style.color = "#007acc";
      if (source_title) source_title.style.color = "#007acc";

      const pseudo_title_other = document.getElementById("pseudo_title2");
      const source_title_other = document.getElementById("source_title2");
      if (pseudo_title_other) pseudo_title_other.style.color = "#808080";
      if (source_title_other) source_title_other.style.color = "#808080";

      currentTarget = 2; // Move to next pane
      console.log("Pane 1 updated, next is Pane 2");
    } else {
      editor2.setValue(sourceContent);
      pseudo2.setValue(pseudoContent);
      const pseudo_title = document.getElementById("pseudo_title2");
      const source_title = document.getElementById("source_title2");

      if (pseudo_title)
        pseudo_title.textContent = `Pseudo Code (${displayName})`;
      if (source_title)
        source_title.textContent = `Source Code (${displayName})`;

      // Safety check before styling
      if (pseudo_title) pseudo_title.style.color = "#007acc";
      if (source_title) source_title.style.color = "#007acc";

      const pseudo_title_other = document.getElementById("pseudo_title1");
      const source_title_other = document.getElementById("source_title1");
      if (pseudo_title_other) pseudo_title_other.style.color = "#808080";
      if (source_title_other) source_title_other.style.color = "#808080";

      currentTarget = 1; // Move back to first pane
      console.log("Pane 2 updated, next is Pane 1");
    }
  } catch (err) {
    console.error("Critical Error in loadFile:", err);
  }
}

function loadPDF(filePath) {
  const viewer = document.getElementById("pdfViewer");

  // For Electron (local file)
  viewer.src = `file://${filePath}`;
}

window.addEventListener("resize", () => {
  // This tells Monaco to measure its parent container and redraw itself
  if (editor1) editor1.layout();
  if (editor2) editor2.layout();
  if (pseudo1) pseudo1.layout();
  if (pseudo2) pseudo2.layout();
});

window.addEventListener("DOMContentLoaded", () => {
  let currentPDF = null;

  const chatHistory = document.getElementById("chat-history");
  const input = document.getElementById("chat-input");
  const button = document.getElementById("chat-send");

  // ================================
  // 📄 Load PDF + build RAG
  // ================================
  document.getElementById("pdfInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    currentPDF = file.name;

    const url = URL.createObjectURL(file);
    document.getElementById("pdfViewer").src = url;

    await fetch("http://127.0.0.1:8000/rag/build", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_name: file.name,
      }),
    });
  });

  // ================================
  // 💬 Chat helpers
  // ================================
  function addUserMessage(text) {
    const div = document.createElement("div");
    div.className = "chat-user";
    div.textContent = "You:\n" + text;
    chatHistory.appendChild(div);
  }

  function addBotMessage() {
    const div = document.createElement("div");
    div.className = "chat-bot";
    div.textContent = "";
    chatHistory.appendChild(div);
    return div;
  }

  function scrollToBottom() {
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  // ================================
  // 🌊 Streaming LLM call
  // ================================
  async function streamLLM(question, onToken) {
    const response = await fetch("http://127.0.0.1:8000/query_stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question,
        db_name: currentPDF,
      }),
    });

    if (!response.body) {
      console.error("No response body");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      onToken(chunk);
    }
  }

  // ================================
  // 🎨 Highlight (per editor)
  // ================================
  const decorationMap = new WeakMap();

  function highlightSelection(editor, selection) {
    const prev = decorationMap.get(editor) || [];

    const next = editor.deltaDecorations(prev, [
      {
        range: selection,
        options: {
          inlineClassName: "highlighted-selection",
        },
      },
    ]);

    decorationMap.set(editor, next);
  }

  // ================================
  // 🧠 LLM query handler (selection)
  // ================================
  window.handleLLMQuery = async function (selectedText) {
    if (!selectedText || selectedText.length < 3) return;

    addUserMessage(selectedText);

    const botDiv = addBotMessage();
    scrollToBottom();

    const question = selectedText;

    await streamLLM(question, (chunk) => {
      botDiv.textContent += chunk;
      scrollToBottom();
    });
  };

  // ================================
  // 🚀 Chat input send
  // ================================
  button.onclick = async () => {
    const question = input.value.trim();
    if (!question) return;

    input.value = "";

    addUserMessage(question);
    const botDiv = addBotMessage();

    await streamLLM(question, (chunk) => {
      botDiv.textContent += chunk;
      scrollToBottom();
    });
  };

  // Enter key support
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      button.click();
    }
  });
});
