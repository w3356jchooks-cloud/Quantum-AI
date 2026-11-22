# Quantum AI

Quantum is a cloud-connected AI application. The browser is a lightweight interface; model inference runs in GitHub Actions on standard hosted CPU runners.

## Current implementation

- **Model:** SmolLM2-135M-Instruct, using the Ollama registry tag `smollm2:135m-instruct-q8_0`.
- **Inference:** A dedicated GitHub Actions workflow starts an Ollama runtime, acquires the model, generates a response, and sends the result back to the Cloudflare Pages API.
- **Gateway:** Cloudflare Pages Functions provide same-origin API routes. GitHub App installation tokens are generated server-side and are never exposed to the browser.
- **Authentication:** A private access code is exchanged for a seven-day HMAC-signed session. The access code and session-signing key are Cloudflare secrets.
- **Storage:** Cloudflare D1 stores conversations, task state, and authentication rate-limit records.
- **Device requirements:** The tablet does not download the model, perform inference, or run training.

No Hugging Face account, token, repository, or runtime dependency is used.

## Cloudflare Pages setup

Connect this repository to Cloudflare Pages using the Cloudflare Workers & Pages GitHub App. Configure:

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: repository root

Create a D1 database named `quantum-ai`, bind it to the Pages project using the binding name `DB`, and apply the SQL in `schema.sql`.

Add these Pages project secrets:

| Secret | Purpose |
| --- | --- |
| `APP_ACCESS_CODE` | Private code used to sign in to the Quantum website |
| `SESSION_SECRET` | Random secret of at least 32 characters for signing browser sessions |
| `INTERNAL_API_SECRET` | Random secret shared only by Pages Functions and the inference workflow |
| `GITHUB_APP_ID` | Numeric GitHub App ID |
| `GITHUB_INSTALLATION_ID` | Installation ID for the app installed on this repository |
| `GITHUB_APP_PRIVATE_KEY` | Full PEM private key for the GitHub App |

The GitHub App should be installed only on `w3356jchooks-cloud/Quantum-AI` and granted **Actions: Read and write**. Metadata read access is provided by GitHub. The gateway requests a short-lived installation token scoped to this one repository and the Actions permission.

## GitHub Actions secrets

Add these repository Actions secrets:

| Secret | Purpose |
| --- | --- |
| `QUANTUM_API_URL` | The deployed Cloudflare Pages origin, e.g. `https://your-project.pages.dev` |
| `QUANTUM_INTERNAL_API_SECRET` | Must exactly match the Pages `INTERNAL_API_SECRET` |

Do not put any of these secrets in browser JavaScript, HTML, or committed files.

## Build and type-check

```bash
npm install
npm run typecheck
npm run build
```

Cloudflare Pages runs the build command before deployment. Pages Functions are loaded from the `functions/` directory.

## API routes

- `POST /api/auth` — exchange the private access code for a signed session.
- `GET /api/health` — non-sensitive deployment health.
- `POST /api/chat` — store a conversation and dispatch a real inference job.
- `GET /api/tasks/:id` — poll a task's actual state.
- `GET /api/conversations` and `GET /api/conversations/:id` — restore cloud conversation history.
- `GET /api/internal/tasks/:id` and `POST /api/internal/complete` — internal workflow callbacks protected by the shared secret.

## Important current limits

This commit establishes the real remote chat path, secure gateway, authentication, and D1 conversation/task storage. It does **not** yet implement automatic knowledge acquisition, retrieval with source citations, LoRA training, full fine-tuning, checkpoint handoff, model promotion, or R2 checkpoint storage. Those features must be implemented and tested before Quantum can be described as complete.

The inference workflow currently pulls the pinned Ollama model tag for each job. It does not yet mirror a digest-pinned model artifact into a Quantum GitHub Release or R2. The workflow uses a standard GitHub-hosted CPU runner; queue time and cold-start time depend on GitHub availability.

## Security notes

- The public repository contains source code only; no credentials or model checkpoints are committed.
- The browser receives only a short-lived signed session token.
- The GitHub App private key and internal callback secret stay in server-side secrets.
- The internal task and completion routes require the shared secret.
- Failed access-code attempts are rate-limited by a hashed client IP.
- Production should remain private until all Cloudflare bindings, GitHub App permissions, and workflow secrets are configured and verified.
