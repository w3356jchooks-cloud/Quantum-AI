# Quantum

Quantum is a local-first AI website hosted on GitHub Pages. Its language model runs in the user's browser; the site does not use a hosted chat-inference API.

## Current runtime

- TypeScript application source: `src/app.ts`.
- TypeScript inference worker: `src/engine.worker.ts`.
- GitHub Actions compiles both TypeScript files to browser JavaScript when source files change.
- Transformers.js 3.8.1 + ONNX Runtime Web.
- Model: `onnx-community/Qwen2.5-0.5B-Instruct`, using 4-bit quantization.
- WebGPU is attempted when a compatible adapter exists; otherwise inference uses CPU through WebAssembly (WASM).
- The inference worker keeps model execution off the main UI thread.
- IndexedDB stores conversations on this browser origin. The Local memory panel can export or clear saved conversations.

## Build

The repository includes separate TypeScript configurations because the main app uses browser DOM types and the worker uses Web Worker types:

```bash
tsc -p tsconfig.app.json
tsc -p tsconfig.worker.json
```

GitHub Actions runs these commands and commits the generated `src/app.js` and `src/engine.worker.js` files for GitHub Pages.

## Device and download notes

The first model load downloads model files from Hugging Face. It may take time and storage. CPU/WASM makes the app compatible with browsers that lack WebGPU, but generation can be slow on lower-powered tablets. Keep the tab open during initialization and generation. Browser caching and storage persistence depend on the browser's policies.

## Honest limitations

- **No fine-tuning yet.** Running inference and storing conversations do not update model weights. Genuine fine-tuning is not implemented.
- **No automatic web knowledge acquisition yet.** A static browser app cannot reliably crawl arbitrary websites because of cross-origin restrictions, source permissions and licensing.
- **No background training while the tab is closed.** Browsers can suspend or terminate workers.
- **No reliable VRAM or temperature readings.** Standard browser APIs do not expose total/free VRAM or device temperature.

## Deploy

Enable GitHub Pages in repository Settings → Pages and select `main` / `(root)`.

Site: https://w3356jchooks-cloud.github.io/Quantum-AI/

## Privacy

Chat messages are passed to the local model in the browser worker and stored in IndexedDB for this site. Model files are downloaded from Hugging Face. Google Fonts are loaded from Google Fonts. No remote chat API is configured.
