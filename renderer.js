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
    }
  });

  pseudoDecorations = editor.deltaDecorations(pseudoDecorations, decorations);
}

require.config({
  paths: { vs: "https://unpkg.com/monaco-editor@0.45.0/min/vs" },
});

require(["vs/editor/editor.main"], function () {
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
    value: "for i in range(10):\n  do something\nend",
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
    value: "for i in range(10):\n  do something\nend",
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

      handleSyncScroll(line, 1);
    }
  });

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
    if (file.endsWith(".py")) {
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
  const baseName = filename.replace(".py", "");
  const pyPath = joinPath(getCwd(), "examples", filename);
  const pseudoPath = joinPath(getCwd(), "examples", `${baseName}.txt`);
  const mappingPath = joinPath(getCwd(), "examples", `${baseName}.json`);

  try {
    const pyContent = readFileSync(pyPath);

    let pseudoContent = "No pseudo code found for this file.";
    try {
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

    // Use specific IDs or data attributes to find titles reliably
    // Based on your HTML, we'll look for the text content
    const titles = Array.from(document.querySelectorAll(".title"));
    const t1 = titles.find((t) => t.textContent.includes("(File 1)"));
    const t2 = titles.find((t) => t.textContent.includes("(File 2)"));

    if (currentTarget === 1) {
      editor1.setValue(pyContent);
      pseudo1.setValue(pseudoContent);

      // Safety check before styling
      if (t1) t1.style.color = "#007acc";
      if (t2) t2.style.color = "#666";

      currentTarget = 2; // Move to next pane
      console.log("Pane 1 updated, next is Pane 2");
    } else {
      editor2.setValue(pyContent);
      pseudo2.setValue(pseudoContent);

      if (t2) t2.style.color = "#007acc";
      if (t1) t1.style.color = "#666";

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
  document.getElementById("pdfInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    document.getElementById("pdfViewer").src = url;
  });
});
