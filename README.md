# Quantum AI

Quantum is a cloud-connected AI application. The browser is a lightweight interface; model inference runs in GitHub Actions on standard hosted CPU runners.

## Current implementation

- **Model:** SmolLM2-135M-Instruct, acquired from the Ollama registry tag `smollm2:135m-instruct-q8_0`. The bootstrap verifies the pinned Ollama manifest digest `2d470404841a51320639b2c2418c7ad8643cccbbcb88c2a242b211ae83bf46a9`, then records the GGUF SHA-256 in the private R2 manifest; each inference job verifies that SHA-256 before loading the model.
- **Inference:** A dedicated GitHub Actions workflow downloads the active GGUF model and optional LoRA adapter from private Cloudflare R2, verifies SHA-256 checksums, starts a pinned CPU `llama.cpp` server, generates a response, and sends the result back through the protected Cloudflare Pages API.
- **Gateway:** Cloudflare Pages Functions provide same-origin API routes. A repository-scoped GitHub App installation token is generated server-side and never exposed to the browser.
- **Authentication:** A private access code is exchanged for a seven-day HMAC-signed session. Access and signing secrets stay server-side.
- **Storage:** Cloudflare D1 stores conversations, task state, the knowledge library, and sign-in/acquisition rate-limit records.
- **Knowledge acquisition:** Chat automatically searches Wikipedia when no relevant saved reference exists. The Knowledge Library also supports manual topic acquisition and removal. Retrieved extracts are passed to the model as untrusted secondary reference context; the model is instructed to cite them as `[Source N]`. This is retrieval (RAG), **not** fine-tuning.
- **Device requirements:** The tablet does not download the model, perform inference, or run training.

No Hugging Face account, token, repository, or runtime dependency is used.

## Cloudflare deployment bootstrap

A deployment workflow is included so you do not have to create the Pages project or D1 database manually. The one-time setup is to add the following **GitHub Actions repository secrets** to this repository, then run **Actions → Bootstrap and deploy Quantum on Cloudflare** from the `main` branch.

| GitHub Actions secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with account-level D1 Write, Pages Write, and Workers R2 Storage Read + Write permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `APP_ACCESS_CODE` | Private website sign-in code (at least 20 characters) |
| `SESSION_SECRET` | Random secret of at least 32 characters |
| `INTERNAL_API_SECRET` | Random secret of at least 32 characters |
| `GITHUB_APP_ID` | Numeric GitHub App ID |
| `GITHUB_INSTALLATION_ID` | Installation ID for the app installed on this repository |
| `GITHUB_APP_PRIVATE_KEY` | Full PEM private key for the GitHub App |

Create a GitHub App and install it **only** on `w3356jchooks-cloud/Quantum-AI`. Grant it **Actions: Read and write**; GitHub provides Metadata read access. The gateway mints short-lived installation tokens scoped to this repository and permission.

The workflow then:
1. Creates or reuses the Cloudflare D1 database.
2. Creates or reuses the Cloudflare Pages project `quantum-ai-w3356jchooks`.
3. Binds D1 as `DB` and applies `schema.sql`.
4. Uploads the private application secrets to Cloudflare Pages.
5. Builds and deploys the website and Pages Functions.
6. Keeps the Cloudflare API token/account ID available to GitHub Actions for private R2 artifact reads; the same workflow uses them for provisioning.
7. Checks the deployed health endpoint.

The deployed origin is `https://quantum-ai-w3356jchooks.pages.dev`. The workflow is manual and restricted to `main`; it will not deploy this draft branch. After a successful deployment, the **Quantum end-to-end acceptance test** runs automatically. It signs in, acquires a reference, dispatches the real model workflow, waits for the SmolLM2 response, and verifies the callback, saved conversation, and source links. This is the single integrated acceptance test; no separate manual test sequence is intended.

## Build, type-check, and tests

```bash
npm install
npm run typecheck
npm test
npm run build
```

Cloudflare Pages assets are assembled in `dist/`. Pages Functions are loaded from the repository's `functions/` directory. The `_headers` file applies a restrictive Content Security Policy and standard security headers.

## API routes

- `POST /api/auth` — exchange the private access code for a signed session.
- `GET /api/health` — non-sensitive deployment readiness.
- `POST /api/chat` — save a conversation, retrieve/acquire relevant knowledge, and dispatch a real inference job.
- `GET /api/tasks/:id` — poll a task's actual state.
- `GET /api/conversations` and `GET /api/conversations/:id` — restore cloud conversation history.
- `GET /api/knowledge`, `POST /api/knowledge`, `DELETE /api/knowledge/:id` — manage saved Wikipedia references.
- `GET /api/internal/tasks/:id` and `POST /api/internal/complete` — internal workflow callbacks protected by the shared secret.

## Remaining work and validation gates

The remote chat path, secure gateway, authentication, conversation storage, initial Wikipedia retrieval, and deployment bootstrap are implemented in this branch.

**Not yet production-validated:** LoRA fine-tuning, full fine-tuning, and checkpoint resume on the selected model. Durable R2 checkpoint handoff, training evaluation, automatic model promotion, and broad multi-source acquisition are not implemented yet. The base Q8 inference model and FP16 training model are mirrored to private R2. A CPU LoRA feasibility experiment is running; no training feature will be exposed as working until the corrected test proves it.

The bootstrap workflow mirrors the Q8 inference model and FP16 training model into a private R2 bucket and records SHA-256 checksums plus the Ollama manifest digests. Each inference job reads the active model manifest from R2 and verifies the downloaded model checksum before loading it. GitHub runner queue time and cold-start time depend on GitHub availability.

## Security notes

- The public repository contains source code only; no credentials or model checkpoints are committed.
- The browser receives only a short-lived signed session token held in session storage.
- The GitHub App private key and internal callback secret stay in server-side secrets.
- The internal task and completion routes require the shared secret.
- API bodies are size-bounded; failed sign-in attempts are rate-limited using a hashed client IP.
- Retrieved Wikipedia text is treated as untrusted data, not as instructions.
- Do not merge to production or ask for user acceptance testing until the Cloudflare bootstrap, actual GitHub Actions inference dispatch, real model response, knowledge retrieval, security checks, and recovery checks all pass.
