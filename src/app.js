import { CreateWebWorkerMLCEngine } from "https://esm.sh/@mlc-ai/web-llm";

const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const DB_NAME = "quantum-local";
const DB_VERSION = 1;
let engine = null;
let busy = false;
let history = [{ role: "system", content: "You are Quantum, a helpful, thoughtful AI assistant. Be clear, accurate, and honest about uncertainty. Do not claim to access information or perform actions you cannot." }];

const $ = (id) => document.getElementById(id);
const ui = {
  welcome: $("welcome"), chat: $("chat-area"), messages: $("messages"),
  load: $("load-model"), note: $("load-note"), status: $("status-label"),
  dot: $("status-dot"), banner: $("engine-banner"), bannerText: $("engine-message"),
  form: $("chat-form"), prompt: $("prompt"), send: $("send-button"),
  dialog: $("info-dialog"), dialogTitle: $("dialog-title"), dialogContent: $("dialog-content")
};

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("conversations")) db.createObjectStore("conversations", { keyPath: "id" });
      if (!db.objectStoreNames.contains("knowledge")) db.createObjectStore("knowledge", { keyPath: "id" });
      if (!db.objectStoreNames.contains("training")) db.createObjectStore("training", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function dbAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
let conversationId = crypto.randomUUID();
let savedMessages = [];
async function persistConversation() {
  await dbPut("conversations", { id: conversationId, updatedAt: Date.now(), messages: savedMessages });
}
function setStatus(label, ready = false) {
  ui.status.textContent = label;
  ui.dot.classList.toggle("ready", ready);
}
function setBusy(value, message = "") {
  busy = value;
  ui.prompt.disabled = value || !engine;
  ui.send.disabled = value || !engine;
  ui.load.disabled = value || !!engine;
  ui.banner.classList.toggle("visible", value || !!message);
  if (message) ui.bannerText.textContent = message;
  else if (!value) ui.banner.classList.remove("visible");
}
function addMessage(role, content, persist = true) {
  const wrap = document.createElement("article");
  wrap.className = `message ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "Y" : "Q";
  const body = document.createElement("div");
  body.className = "message-body";
  const label = document.createElement("div");
  label.className = "message-role";
  label.textContent = role === "user" ? "YOU" : "QUANTUM";
  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = content;
  body.append(label, text);
  wrap.append(avatar, body);
  ui.messages.append(wrap);
  ui.chat.classList.remove("hidden");
  ui.welcome.classList.add("hidden");
  ui.messages.scrollTop = ui.messages.scrollHeight;
  if (persist) {
    savedMessages.push({ role, content });
    persistConversation().catch(err => showBanner("Could not save this conversation: " + err.message));
  }
  return text;
}
function showBanner(message) {
  ui.banner.classList.add("visible");
  ui.bannerText.textContent = message;
}
function showDialog(title, html) {
  ui.dialogTitle.textContent = title;
  ui.dialogContent.innerHTML = html;
  ui.dialog.showModal();
}

async function detectSystem() {
  const memory = navigator.deviceMemory;
  $("ram-value").textContent = memory ? `~${memory} GB` : "Not exposed";
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        $("gpu-value").textContent = "WebGPU available";
        $("gpu-sub").textContent = "Adapter detected · limits queried";
        const max = adapter.limits?.maxBufferSize;
        if (max) $("gpu-sub").textContent += ` · max buffer ${Math.round(max / 1048576)} MB`;
      } else {
        $("gpu-value").textContent = "No adapter";
        $("gpu-sub").textContent = "Browser exposed WebGPU, but no adapter was returned";
      }
    } catch (error) {
      $("gpu-value").textContent = "Unavailable";
      $("gpu-sub").textContent = error.message;
    }
  } else {
    $("gpu-value").textContent = "Not available";
    $("gpu-sub").textContent = "This browser does not expose WebGPU";
  }
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate) {
      const used = estimate.usage || 0, quota = estimate.quota || 0;
      $("storage-value").textContent = quota ? `${(used / 1e9).toFixed(2)} / ${(quota / 1e9).toFixed(1)} GB` : "Available";
      $("storage-sub").textContent = "Browser-reported origin storage";
      if (navigator.storage.persist) {
        const persisted = await navigator.storage.persist();
        $("storage-sub").textContent += persisted ? " · persistence granted" : " · persistence not granted";
      }
    } else {
      $("storage-value").textContent = "Not exposed";
    }
  } catch (error) {
    $("storage-value").textContent = "Unavailable";
    $("storage-sub").textContent = error.message;
  }
}

async function initializeEngine() {
  if (engine || busy) return;
  setBusy(true, "Checking WebGPU and initializing the local model…");
  setStatus("Initializing");
  try {
    if (!navigator.gpu) throw new Error("WebGPU is not available in this browser. Quantum cannot run this model here yet; try a current Chromium-based browser with WebGPU enabled.");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No compatible GPU adapter was returned by the browser.");
    const worker = new Worker(new URL("./engine.worker.js", import.meta.url), { type: "module" });
    engine = await CreateWebWorkerMLCEngine(worker, MODEL_ID, {
      initProgressCallback: (report) => {
        const text = report.text || "Downloading model…";
        const progress = typeof report.progress === "number" ? ` ${Math.round(report.progress * 100)}%` : "";
        setBusy(true, text + progress);
      }
    });
    setStatus("Local model ready", true);
    ui.note.textContent = "Model cached by the browser after download";
    setBusy(false);
    ui.prompt.disabled = false;
    ui.send.disabled = false;
    ui.prompt.focus();
    showBanner("Quantum is ready. Inference runs locally on your GPU.");
    setTimeout(() => ui.banner.classList.remove("visible"), 3500);
  } catch (error) {
    engine = null;
    setStatus("Engine unavailable");
    setBusy(false);
    showBanner("Initialization failed: " + (error?.message || String(error)));
    ui.load.disabled = false;
  }
}

async function sendMessage(content) {
  const text = content.trim();
  if (!text || !engine || busy) return;
  addMessage("user", text);
  ui.prompt.value = "";
  ui.prompt.style.height = "auto";
  history.push({ role: "user", content: text });
  const output = addMessage("assistant", "", false);
  setBusy(true, "Quantum is thinking on your device…");
  try {
    const stream = await engine.chat.completions.create({
      messages: history,
      temperature: 0.7,
      max_tokens: 512,
      stream: true
    });
    let answer = "";
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      answer += delta;
      output.textContent = answer;
      ui.messages.scrollTop = ui.messages.scrollHeight;
    }
    history.push({ role: "assistant", content: answer });
    savedMessages.push({ role: "assistant", content: answer });
    await persistConversation();
    setBusy(false);
    ui.banner.classList.remove("visible");
  } catch (error) {
    output.textContent = "Generation failed: " + (error?.message || String(error));
    history.pop();
    setBusy(false);
    setStatus("Model loaded · generation error", true);
  }
}

async function newConversation() {
  conversationId = crypto.randomUUID();
  savedMessages = [];
  history = [history[0]];
  ui.messages.replaceChildren();
  ui.chat.classList.add("hidden");
  ui.welcome.classList.remove("hidden");
  if (engine) {
    ui.prompt.disabled = false;
    ui.send.disabled = false;
  }
}
async function loadLatestConversation() {
  try {
    const rows = await dbAll("conversations");
    rows.sort((a,b) => b.updatedAt - a.updatedAt);
    const latest = rows[0];
    if (!latest) return;
    conversationId = latest.id;
    savedMessages = latest.messages || [];
    for (const message of savedMessages) addMessage(message.role, message.content, false);
    history = [history[0], ...savedMessages];
  } catch (error) {
    showBanner("Local conversation storage is unavailable: " + error.message);
  }
}

ui.load.addEventListener("click", initializeEngine);
ui.form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(ui.prompt.value);
});
ui.prompt.addEventListener("input", () => {
  ui.prompt.style.height = "auto";
  ui.prompt.style.height = Math.min(ui.prompt.scrollHeight, 150) + "px";
});
ui.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    ui.form.requestSubmit();
  }
});
$("new-chat").addEventListener("click", newConversation);
$("dialog-close").addEventListener("click", () => ui.dialog.close());
$("settings-button").addEventListener("click", () => showDialog("Quantum settings", "<b>Runtime</b><br>WebLLM · WebGPU · local inference<br><br><b>Model</b><br>Llama 3.2 1B Instruct · q4f16_1<br><br><b>Storage</b><br>Conversations in IndexedDB. Model artifacts use the browser cache. This site does not send your chat messages to a server."));
$("open-memory").addEventListener("click", async () => {
  const rows = await dbAll("conversations");
  const knowledge = await dbAll("knowledge");
  showDialog("Local memory", `Saved conversations: <b>${rows.length}</b><br>Knowledge records: <b>${knowledge.length}</b><br><br>Conversation records are stored in this browser's IndexedDB. No sync or cloud backup is configured.`);
});
$("open-system").addEventListener("click", () => showDialog("System monitor", `GPU: <b>${$("gpu-value").textContent}</b><br>GPU details: ${$("gpu-sub").textContent}<br>Memory: <b>${$("ram-value").textContent}</b><br>Storage: <b>${$("storage-value").textContent}</b><br><br>Browsers do not expose reliable total/free VRAM or device temperature. Quantum will not invent those measurements.`));
document.querySelectorAll(".suggestion").forEach(button => button.addEventListener("click", () => {
  if (!engine) { showBanner("Initialize Quantum first, then choose a prompt."); ui.load.focus(); return; }
  sendMessage(button.dataset.prompt);
}));

await detectSystem();
await loadLatestConversation();
try {
  const db = await openDB();
  db.close();
} catch (error) {
  showBanner("IndexedDB unavailable: conversations cannot be saved in this browser.");
}
