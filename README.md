# Quantum AI

Quantum is a cloud-connected AI application. The browser is a lightweight interface; model inference runs in GitHub Actions on standard hosted CPU runners.

## Current implementation

- **Model:** SmolLM2-135M-Instruct, using the Ollama registry tag `smollm2:135m-instruct-q8_0`.
- **Inference:** A dedicated GitHub Actions workflow starts Ollama, acquires the selected model, generates a response, and sends the result back to the Cloudflare Pages API.
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
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with account-level D1 Write and Pages Write permissions |
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
6. Sets the inference callback secrets in GitHub Actions.
7. Checks the deployed health endpoint.

The deployed origin is `https://quantum-ai-w3356jchooks.pages.dev`. The workflow is manual and restricted to `main`; it will not deploy this draft branch.

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

**Not yet production-validated:** LoRA fine-tuning, full fine-tuning, checkpoint handoff/resume on the selected model, training evaluation and model promotion, R2 model/checkpoint mirroring, and broad multi-source web acquisition. A CPU LoRA feasibility experiment is in progress; the first attempt hit a graph-size assertion, so no training feature will be exposed as working until a corrected run proves it. The full fine-tuning path is also still unverified.

The inference workflow currently pulls the selected Ollama tag for each job. It does not yet mirror a digest-pinned model artifact into a Quantum GitHub Release or R2. GitHub runner queue time and cold-start time depend on GitHub availability.

## Security notes

- The public repository contains source code only; no credentials or model checkpoints are committed.
- The browser receives only a short-lived signed session token held in session storage.
- The GitHub App private key and internal callback secret stay in server-side secrets.
- The internal task and completion routes require the shared secret.
- API bodies are size-bounded; failed sign-in attempts are rate-limited using a hashed client IP.
- Retrieved Wikipedia text is treated as untrusted data, not as instructions.
- Do not merge to production or ask for user acceptance testing until the Cloudflare bootstrap, actual GitHub Actions inference dispatch, real model response, knowledge retrieval, security checks, and recovery checks all pass.
