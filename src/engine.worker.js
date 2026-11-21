import { WebWorkerMLCEngineHandler } from "https://esm.sh/@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event) => handler.onmessage(event);
