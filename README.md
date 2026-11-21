# Quantum

Quantum is a local-first browser AI hosted as a static website. The application is designed to run model inference on the user's device rather than through a hosted inference API.

## Current implementation

- **Local language model inference:** WebLLM with WebGPU, using the built-in `Llama-3.2-1B-Instruct-q4f16_1-MLC` model record.
- **Worker isolation:** WebLLM's documented `WebWorkerMLCEngine` architecture keeps generation work off the UI thread.
- **Conversation persistence:** IndexedDB stores conversation records on this browser origin.
- **System capability reporting:** checks whether WebGPU and a GPU adapter are exposed, reads available adapter limits, reports `navigator.deviceMemory` only when the browser exposes it, and reports browser storage estimates.
- **Storage persistence request:** asks the browser for persistent origin storage when supported. This is a request, not a guarantee.
- **Static hosting:** no server, API key, database service, or remote inference endpoint is configured.

## Honest limitations (not implemented yet)

- **No fine-tuning yet.** WebLLM is being used as an inference runtime. Adding documents to a knowledge store is not model training. Genuine fine-tuning requires a separate training stack that can update model weights and save/reload those weights in a format the inference runtime can use.
- **No automatic web knowledge collector yet.** Cross-origin restrictions, source permissions, and licensing mean a static browser app cannot reliably crawl arbitrary websites. A future collector must use permitted accessible sources, store provenance, and clearly distinguish retrieved knowledge from model weights.
- **No CPU language-model fallback yet.** The current chat model uses WebGPU. The interface reports WebGPU unavailability rather than pretending CPU inference is active. A separate WASM/CPU runtime can be added after device and model compatibility testing.
- **No training while the tab is closed.** Browsers may suspend or terminate workers and service workers. Future resumable jobs must yield to the browser and device.
- **No precise VRAM or temperature readings.** Standard browser APIs do not reliably expose total/free VRAM or device temperature. Quantum reports only data the browser actually provides.

## Run locally

Serve this folder from a local HTTP server (ES modules and workers require an origin; do not open `index.html` as a `file://` URL). For example:

```bash
python -m http.server 8000
```

Open `http://localhost:8000` in a browser that supports WebGPU.

## Deploy with GitHub Pages

In the repository settings, open **Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save. The repository owner must enable Pages. The published URL is:

`https://w3356jchooks-cloud.github.io/Quantum-AI/`

## First model download

The first initialization downloads the model artifacts from the configured WebLLM/Hugging Face distribution. This is a substantial download; keep the tab open and use a stable connection. Subsequent loads can use browser caching, subject to browser storage policy and quota.

## Privacy

Chat messages are sent to the local model running in the browser worker and saved in IndexedDB for this origin. Model files are fetched from their configured distribution hosts. Google Fonts are loaded from Google Fonts. No chat-content analytics or remote chat API is included in this source.
