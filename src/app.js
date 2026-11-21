const DB = "quantum-local";
const SYSTEM = "You are Quantum, a helpful and thoughtful AI. Be accurate, clear, and honest about uncertainty.";
const $ = (id) => {
    const el = document.getElementById(id);
    if (!el)
        throw new Error("Missing UI element: #" + id);
    return el;
};
const ui = {
    welcome: $("welcome"), chat: $("chat-area"), messages: $("messages"),
    load: $("load-model"), note: $("load-note"), status: $("status-label"),
    dot: $("status-dot"), banner: $("engine-banner"), bannerText: $("engine-message"),
    form: $("chat-form"), prompt: $("prompt"),
    send: $("send-button"), dialog: $("info-dialog"),
    dialogTitle: $("dialog-title"), dialogContent: $("dialog-content"),
};
let worker = null;
let ready = false;
let busy = false;
let pendingPrompt = null;
let backend = "Not initialized";
let conversationId = crypto.randomUUID();
let saved = [];
let history = [{ role: "system", content: SYSTEM }];
let answerNode = null;
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("conversations"))
                db.createObjectStore("conversations", { keyPath: "id" });
            if (!db.objectStoreNames.contains("knowledge"))
                db.createObjectStore("knowledge", { keyPath: "id" });
            if (!db.objectStoreNames.contains("training"))
                db.createObjectStore("training", { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDB unavailable"));
    });
}
async function all(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction(store).objectStore(store).getAll();
        req.onsuccess = () => { const rows = req.result; db.close(); resolve(rows); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}
async function save() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("conversations", "readwrite");
        tx.objectStore("conversations").put({ id: conversationId, updatedAt: Date.now(), messages: saved });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}
function banner(text) { ui.banner.classList.add("visible"); ui.bannerText.textContent = text; }
function status(text, active = false) { ui.status.textContent = text; ui.dot.classList.toggle("ready", active); }
function busyState(value, text = "") {
    busy = value;
    ui.prompt.disabled = value || !ready;
    ui.send.disabled = value || !ready;
    ui.load.disabled = value || ready;
    ui.banner.classList.toggle("visible", value || !!text);
    if (text)
        ui.bannerText.textContent = text;
    else if (!value)
        ui.banner.classList.remove("visible");
}
function dialog(title, html) {
    ui.dialogTitle.textContent = title;
    ui.dialogContent.replaceChildren();
    const content = document.createElement("div");
    content.innerHTML = html;
    ui.dialogContent.append(content);
    if (!ui.dialog.open)
        ui.dialog.showModal();
}
function addMessage(role, content, persist = true) {
    const article = document.createElement("article");
    article.className = "message " + role;
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
    article.append(avatar, body);
    ui.messages.append(article);
    ui.chat.classList.remove("hidden");
    ui.welcome.classList.add("hidden");
    ui.messages.scrollTop = ui.messages.scrollHeight;
    if (persist) {
        saved.push({ role, content });
        void save().catch(e => banner("Save failed: " + e.message));
    }
    return text;
}
function initialize() {
    if (ready || busy)
        return;
    busyState(true, "Starting local model runtime…");
    status("Preparing model");
    try {
        worker = new Worker(new URL("./engine.worker.js?v=cpu-wasm-ts1", import.meta.url), { type: "module" });
        worker.onmessage = (event) => {
            const m = event.data;
            if (m.type === "progress")
                banner(m.text || "Downloading model files…");
            if (m.type === "ready") {
                ready = true;
                backend = m.backend || "CPU · WASM";
                status("Ready · " + backend, true);
                ui.note.textContent = "Model cached by your browser after download.";
                busyState(false);
                banner("Quantum is ready. Local inference: " + backend + ".");
                const queued = pendingPrompt;
                pendingPrompt = null;
                if (queued)
                    void send(queued);
                else
                    window.setTimeout(() => ui.banner.classList.remove("visible"), 4500);
            }
            if (m.type === "token" && answerNode) {
                answerNode.textContent += m.content || "";
                ui.messages.scrollTop = ui.messages.scrollHeight;
            }
            if (m.type === "complete") {
                const answer = m.content || answerNode?.textContent || "";
                history.push({ role: "assistant", content: answer });
                saved.push({ role: "assistant", content: answer });
                void save().catch(e => banner("Save failed: " + e.message));
                answerNode = null;
                busyState(false);
            }
            if (m.type === "error") {
                if (!ready) {
                    status("Model unavailable");
                    pendingPrompt = null;
                    ui.load.disabled = false;
                }
                else if (answerNode)
                    answerNode.textContent = "Generation failed: " + (m.error || "Unknown error");
                answerNode = null;
                busyState(false);
                banner("Quantum error: " + (m.error || "Unknown error"));
            }
        };
        worker.onerror = e => { ready = false; busyState(false); status("Worker error"); ui.load.disabled = false; banner(e.message || "Inference worker failed to start."); };
        worker.postMessage({ type: "initialize" });
    }
    catch (e) {
        busyState(false);
        status("Model unavailable");
        ui.load.disabled = false;
        banner("Initialization failed: " + e.message);
    }
}
async function send(raw) {
    const content = raw.trim();
    if (!content || !ready || busy)
        return;
    addMessage("user", content);
    ui.prompt.value = "";
    ui.prompt.style.height = "auto";
    history.push({ role: "user", content });
    answerNode = addMessage("assistant", "", false);
    busyState(true, "Thinking locally with " + backend + "…");
    try {
        worker?.postMessage({ type: "generate", messages: history });
    }
    catch (e) {
        history.pop();
        if (answerNode)
            answerNode.textContent = e.message;
        answerNode = null;
        busyState(false);
    }
}
function newChat() {
    conversationId = crypto.randomUUID();
    saved = [];
    history = [{ role: "system", content: SYSTEM }];
    ui.messages.replaceChildren();
    ui.chat.classList.add("hidden");
    ui.welcome.classList.remove("hidden");
    ui.prompt.value = "";
    ui.prompt.disabled = !ready;
    ui.send.disabled = !ready;
}
async function restore() {
    try {
        const rows = await all("conversations");
        rows.sort((a, b) => b.updatedAt - a.updatedAt);
        const last = rows[0];
        if (!last)
            return;
        conversationId = last.id;
        saved = last.messages || [];
        for (const m of saved)
            addMessage(m.role, m.content, false);
        history = [{ role: "system", content: SYSTEM }, ...saved];
    }
    catch (e) {
        banner("Could not restore chats: " + e.message);
    }
}
async function memory() {
    const rows = await all("conversations");
    const knowledge = await all("knowledge");
    const count = rows.reduce((n, r) => n + (r.messages?.length || 0), 0);
    dialog("Local memory", "<p><b>" + rows.length + "</b> conversations · <b>" + count + "</b> messages</p><p><b>" + knowledge.length + "</b> knowledge records</p><p>All records are stored in this browser. Automatic web learning and fine-tuning are not implemented.</p><button class='dialog-action' id='export-memory'>Export conversations</button> <button class='dialog-action danger' id='clear-memory'>Clear conversations</button>");
    $("export-memory").addEventListener("click", async () => {
        const blob = new Blob([JSON.stringify(await all("conversations"), null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "quantum-conversations.json";
        a.click();
        URL.revokeObjectURL(url);
    });
    $("clear-memory").addEventListener("click", async () => {
        if (!confirm("Delete all saved conversations from this browser?"))
            return;
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction("conversations", "readwrite");
            tx.objectStore("conversations").clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
        newChat();
        ui.dialog.close();
        banner("Local conversations cleared.");
    });
}
async function detect() {
    const nav = navigator;
    $("ram-value").textContent = nav.deviceMemory ? "~" + nav.deviceMemory + " GB" : "Not exposed";
    let gpu = false;
    try {
        gpu = !!(await nav.gpu?.requestAdapter());
    }
    catch {
        gpu = false;
    }
    $("gpu-value").textContent = gpu ? "WebGPU available" : "CPU fallback";
    $("gpu-sub").textContent = gpu ? "GPU adapter detected; runtime will test it." : "No adapter detected. Local WASM CPU inference is available.";
    try {
        const e = await navigator.storage?.estimate?.();
        $("storage-value").textContent = e?.quota ? (((e.usage || 0) / 1e9).toFixed(2) + " / " + (e.quota / 1e9).toFixed(1) + " GB") : "Not exposed";
    }
    catch {
        $("storage-value").textContent = "Unavailable";
    }
    $("storage-sub").textContent = "Browser-reported origin storage";
}
ui.load.addEventListener("click", initialize);
ui.form.addEventListener("submit", e => { e.preventDefault(); void send(ui.prompt.value); });
ui.prompt.addEventListener("input", () => { ui.prompt.style.height = "auto"; ui.prompt.style.height = Math.min(ui.prompt.scrollHeight, 150) + "px"; });
ui.prompt.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    ui.form.requestSubmit();
} });
$("new-chat").addEventListener("click", newChat);
$("dialog-close").addEventListener("click", () => ui.dialog.close());
$("settings-button").addEventListener("click", () => dialog("Quantum settings", "<p><b>Runtime</b><br>Transformers.js · ONNX Runtime Web</p><p><b>Model</b><br>Qwen2.5 0.5B Instruct · 4-bit</p><p><b>Compute</b><br>WebGPU when supported, otherwise CPU/WASM. Inference stays in this browser.</p><p><b>Privacy</b><br>Chats are stored in this browser. Model files download from Hugging Face.</p>"));
$("open-memory").addEventListener("click", () => void memory().catch(e => banner(e.message)));
$("open-system").addEventListener("click", () => dialog("System monitor", "<p>Compute: <b>" + $("gpu-value").textContent + "</b></p><p>" + $("gpu-sub").textContent + "</p><p>Memory: <b>" + $("ram-value").textContent + "</b></p><p>Storage: <b>" + $("storage-value").textContent + "</b></p><p>Active backend: <b>" + backend + "</b></p><p>Browsers do not expose reliable free VRAM or temperature.</p>"));
$("open-chat").addEventListener("click", () => { if (saved.length) {
    ui.welcome.classList.add("hidden");
    ui.chat.classList.remove("hidden");
}
else
    newChat(); });
document.querySelectorAll(".suggestion").forEach(button => button.addEventListener("click", () => {
    const prompt = button.dataset.prompt || "";
    if (busy) {
        banner("Quantum is busy. Please wait.");
        return;
    }
    if (!ready) {
        pendingPrompt = prompt;
        initialize();
    }
    else
        void send(prompt);
}));
void (async () => { await detect(); await restore(); try {
    const db = await openDB();
    db.close();
}
catch (e) {
    banner("Local storage unavailable: " + e.message);
} })();
export {};
