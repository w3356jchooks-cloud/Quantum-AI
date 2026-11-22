type Role = "user" | "assistant";
type Message = { role: Role; content: string };
type Conversation = { id: string; title: string; updated_at: number };
type ApiError = { error?: string };
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error("Missing UI element: #" + id);
  return el as T;
};
const ui = {
  gate: $("auth-gate"), authForm: $("auth-form") as HTMLFormElement,
  accessCode: $("access-code") as HTMLInputElement, authError: $("auth-error"),
  authSubmit: $("auth-submit") as HTMLButtonElement,
  welcome: $("welcome"), chat: $("chat-area"), messages: $("messages"),
  status: $("status-label"), dot: $("status-dot"),
  banner: $("engine-banner"), bannerText: $("engine-message"),
  form: $("chat-form") as HTMLFormElement, prompt: $("prompt") as HTMLTextAreaElement,
  send: $("send-button") as HTMLButtonElement, historyList: $("history-list"),
  dialog: $("info-dialog") as HTMLDialogElement, dialogTitle: $("dialog-title"),
  dialogContent: $("dialog-content")
};
let token = sessionStorage.getItem("quantum-session") || "";
let conversationId: string = crypto.randomUUID();
let messages: Message[] = [];
let busy = false;

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", "Bearer " + token);
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) {
    if (response.status === 401 && token) signOut();
    throw new Error(data.error || "Quantum API request failed (" + response.status + ").");
  }
  return data;
}
function banner(text: string, visible = true): void {
  ui.bannerText.textContent = text;
  ui.banner.classList.toggle("visible", visible);
}
function setStatus(text: string, online = false): void {
  ui.status.textContent = text;
  ui.dot.classList.toggle("ready", online);
}
function setBusy(value: boolean, text = ""): void {
  busy = value;
  ui.prompt.disabled = value || !token;
  ui.send.disabled = value || !token;
  ui.authSubmit.disabled = value;
  if (text) banner(text);
  else if (!value) banner("", false);
}
function showDialog(title: string, lines: string[]): void {
  ui.dialogTitle.textContent = title;
  ui.dialogContent.replaceChildren();
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    ui.dialogContent.append(p);
  }
  if (!ui.dialog.open) ui.dialog.showModal();
}
function renderMessages(): void {
  ui.messages.replaceChildren();
  for (const message of messages) {
    const article = document.createElement("article");
    article.className = "message " + message.role;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = message.role === "user" ? "Y" : "Q";
    const body = document.createElement("div");
    body.className = "message-body";
    const label = document.createElement("div");
    label.className = "message-role";
    label.textContent = message.role === "user" ? "YOU" : "QUANTUM";
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.content;
    body.append(label, text);
    article.append(avatar, body);
    ui.messages.append(article);
  }
  ui.chat.classList.toggle("hidden", messages.length === 0);
  ui.welcome.classList.toggle("hidden", messages.length > 0);
  ui.messages.scrollTop = ui.messages.scrollHeight;
}
function signOut(): void {
  token = "";
  sessionStorage.removeItem("quantum-session");
  ui.gate.classList.remove("hidden");
  ui.accessCode.value = "";
  ui.prompt.disabled = true;
  ui.send.disabled = true;
  setStatus("Signed out");
}
async function checkHealth(): Promise<void> {
  try {
    const health = await api<{ status: string; database: string; model: string; inference: string; githubConfigured: boolean }>("/api/health");
    const ready = health.status === "ok" && health.githubConfigured;
    setStatus(ready ? "Gateway online · Model ready to queue" : "Gateway setup incomplete", ready);
    $("gpu-value").textContent = "GitHub Actions";
    $("gpu-sub").textContent = health.githubConfigured ? "Workflow dispatch connected" : "GitHub App credentials missing";
    $("storage-value").textContent = health.database;
    $("storage-sub").textContent = "Cloud conversation and task records";
    if (!ready) banner("Quantum cloud setup is incomplete. Finish the deployment configuration before sending prompts.");
    return;
  } catch (error) {
    setStatus("Gateway unavailable");
    banner((error as Error).message);
  }
}
async function loadConversations(): Promise<void> {
  const result = await api<{ conversations: Conversation[] }>("/api/conversations");
  ui.historyList.replaceChildren();
  for (const item of result.conversations) {
    const button = document.createElement("button");
    button.className = "history-item";
    button.textContent = item.title || "Conversation";
    button.title = item.title || "Conversation";
    button.addEventListener("click", () => void restoreConversation(item.id));
    ui.historyList.append(button);
  }
  if (result.conversations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No saved conversations yet";
    ui.historyList.append(empty);
  }
  return;
}
async function restoreConversation(id: string): Promise<void> {
  if (busy) return;
  try {
    const result = await api<{ id: string; messages: Message[] }>("/api/conversations/" + encodeURIComponent(id));
    conversationId = result.id;
    messages = result.messages || [];
    renderMessages();
    setStatus("Conversation restored", true);
  } catch (error) { banner((error as Error).message); }
}
function newChat(): void {
  if (busy) return;
  conversationId = crypto.randomUUID();
  messages = [];
  renderMessages();
  ui.prompt.value = "";
  ui.prompt.focus();
}
async function pollTask(taskId: string): Promise<string> {
  for (let attempt = 0; attempt < 900; attempt++) {
    await new Promise(resolve => window.setTimeout(resolve, 2000));
    const task = await api<{ status: string; answer?: string; error?: string }>("/api/tasks/" + encodeURIComponent(taskId));
    if (task.status === "complete") return task.answer || "";
    if (task.status === "failed") throw new Error(task.error || "The inference job failed.");
    banner(task.status === "running" ? "SmolLM2 is generating a response on the remote CPU runner…" : "Waiting for a GitHub Actions runner…");
  }
  throw new Error("This job is taking longer than expected. Check System Status before retrying.");
}
async function send(raw: string): Promise<void> {
  const content = raw.trim();
  if (!content || busy || !token) return;
  messages.push({ role: "user", content });
  if (messages.length > 50) messages = messages.slice(-50);
  renderMessages();
  ui.prompt.value = "";
  setBusy(true, "Sending your prompt to Quantum…");
  try {
    const queued = await api<{ taskId: string; status: string }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ conversationId, messages })
    });
    const answer = await pollTask(queued.taskId);
    messages.push({ role: "assistant", content: answer });
    renderMessages();
    setStatus("Response received · SmolLM2-135M", true);
    await loadConversations();
    banner("Quantum replied. Your conversation is saved in the cloud.");
    window.setTimeout(() => { if (!busy) banner("", false); }, 5000);
  } catch (error) {
    const message = (error as Error).message;
    banner(message);
    showDialog("Quantum could not finish", [message, "Your previous messages remain in this conversation. You can retry when the gateway is ready."]);
  } finally {
    setBusy(false);
    ui.prompt.focus();
  }
}
ui.authForm.addEventListener("submit", async event => {
  event.preventDefault();
  const accessCode = ui.accessCode.value;
  if (!accessCode) return;
  ui.authError.textContent = "";
  ui.authSubmit.disabled = true;
  try {
    const result = await fetch("/api/auth", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessCode }), cache: "no-store"
    });
    const data = await result.json() as { token?: string; error?: string };
    if (!result.ok || !data.token) throw new Error(data.error || "Authentication failed.");
    token = data.token;
    sessionStorage.setItem("quantum-session", token);
    ui.accessCode.value = "";
    ui.gate.classList.add("hidden");
    ui.prompt.disabled = false;
    ui.send.disabled = false;
    await checkHealth();
    await loadConversations();
    const historyResult = await api<{ conversations: Conversation[] }>("/api/conversations");
    if (historyResult.conversations[0]) await restoreConversation(historyResult.conversations[0].id);
  } catch (error) {
    ui.authError.textContent = (error as Error).message;
  } finally { ui.authSubmit.disabled = false; }
});
ui.form.addEventListener("submit", event => { event.preventDefault(); void send(ui.prompt.value); });
ui.prompt.addEventListener("input", () => {
  ui.prompt.style.height = "auto";
});
ui.prompt.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ui.form.requestSubmit(); }
});
$("new-chat").addEventListener("click", newChat);
$("open-chat").addEventListener("click", () => { renderMessages(); ui.prompt.focus(); });
$("open-history").addEventListener("click", () => { void loadConversations().catch(e => banner((e as Error).message)); });
$("open-system").addEventListener("click", () => {
  void (async () => {
    try {
      const health = await api<{ status: string; database: string; model: string; inference: string; githubConfigured: boolean }>("/api/health");
      showDialog("Quantum system status", [
        "Gateway: " + health.status,
        "Database: " + health.database,
        "Model: " + health.model,
        "Inference: " + health.inference,
        "GitHub workflow: " + (health.githubConfigured ? "configured" : "not configured"),
        "The model runs on a remote CPU runner. This device performs no model inference."
      ]);
    } catch (error) { showDialog("System status", [(error as Error).message]); }
  })();
});
$("settings-button").addEventListener("click", () => {
  showDialog("Quantum settings", [
    "Model: SmolLM2-135M-Instruct (Q8_0 inference tag).",
    "Compute: GitHub Actions standard CPU runners.",
    "Storage: Cloud D1 conversation and task records.",
    "Authentication: private access code with a short-lived signed session."
  ]);
  const signOutButton = document.createElement("button");
  signOutButton.className = "dialog-action danger";
  signOutButton.textContent = "Sign out";
  signOutButton.addEventListener("click", () => { ui.dialog.close(); signOut(); });
  ui.dialogContent.append(signOutButton);
});
$("dialog-close").addEventListener("click", () => ui.dialog.close());
document.querySelectorAll<HTMLButtonElement>(".suggestion").forEach(button => {
  button.addEventListener("click", () => void send(button.dataset.prompt || ""));
});
if (token) {
  ui.gate.classList.add("hidden");
  ui.prompt.disabled = false;
  ui.send.disabled = false;
  void (async () => {
    try {
      await checkHealth();
      await loadConversations();
      const result = await api<{ conversations: Conversation[] }>("/api/conversations");
      if (result.conversations[0]) await restoreConversation(result.conversations[0].id);
    } catch { signOut(); }
  })();
} else {
  ui.gate.classList.remove("hidden");
  setStatus("Private sign-in required");
}
