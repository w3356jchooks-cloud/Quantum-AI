type Message = { role: "system" | "user" | "assistant"; content: string };
type WorkerRequest = { type: "initialize" } | { type: "generate"; messages: Message[] };
const scope = self as unknown as DedicatedWorkerGlobalScope;
let model: any = null;
let initializing = false;
scope.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const request = event.data;
  if (request.type === "initialize") {
    if (model || initializing) return;
    initializing = true;
    try {
      // @ts-ignore Browser CDN module; TypeScript source compiles to native browser ESM.
      const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
      // One WASM thread avoids cross-origin-isolation requirements on GitHub Pages.
      env.backends.onnx.wasm.numThreads = 1;
      const gpu = (self.navigator as WorkerNavigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
      let device: "webgpu" | "wasm" = "wasm";
      try { if (await gpu?.requestAdapter()) device = "webgpu"; } catch { device = "wasm"; }
      const progress_callback = (p: { status?: string; file?: string; progress?: number }): void => {
        const suffix = typeof p.progress === "number" ? " " + Math.round(p.progress) + "%" : "";
        scope.postMessage({ type: "progress", text: (p.status || "Loading model") + (p.file ? " · " + p.file : "") + suffix });
      };
      try {
        model = await pipeline("text-generation", "onnx-community/Qwen2.5-0.5B-Instruct", { dtype: "q4", device, progress_callback });
      } catch (gpuError) {
        if (device !== "webgpu") throw gpuError;
        scope.postMessage({ type: "progress", text: "GPU unavailable for this model. Switching to CPU/WASM…" });
        model = await pipeline("text-generation", "onnx-community/Qwen2.5-0.5B-Instruct", { dtype: "q4", device: "wasm", progress_callback });
        device = "wasm";
      }
      scope.postMessage({ type: "ready", backend: device === "webgpu" ? "WebGPU" : "CPU · WASM" });
    } catch (error) {
      scope.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
    } finally { initializing = false; }
    return;
  }
  if (request.type === "generate") {
    if (!model) { scope.postMessage({ type: "error", error: "The model is not initialized." }); return; }
    try {
      const result = await model(request.messages, { max_new_tokens: 160, do_sample: true, temperature: 0.7, top_p: 0.9 });
      const generated = result?.[0]?.generated_text;
      const last = Array.isArray(generated) ? generated[generated.length - 1] : generated;
      const answer = typeof last === "string" ? last : last?.content || "The model returned an empty response.";
      scope.postMessage({ type: "token", content: answer });
      scope.postMessage({ type: "complete", content: answer });
    } catch (error) {
      scope.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
};