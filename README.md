# Internal AI

An Apple-inspired, conversation-first enterprise intelligence workspace spanning Answer → Understand → Act → Anticipate.

## Delivered application

- Ask: lexical retrieval, source citations, scope selection, verified-evidence filtering, attached document context, conversation history, saved answers, Markdown export, optional live AI synthesis.
- Knowledge: searchable library, source/owner/date/version inspection, side-by-side comparison, sample knowledge-health findings, approved decision memory.
- Clients and people: two fictional Client 360 accounts, projects, opportunities, decisions, commitments, evidence-linked expertise profiles, profile drafting.
- Act: editable action drafts, recorded approval, completion and outcome capture; no external sending. RFP compliance review, proposal draft templates, pricing calculator and scenario comparisons.
- Anticipate: five sample insight types (meeting, opportunity, conflict, freshness and evidence gap), persistent dismissals, personal preferences, human-approved conversation-to-knowledge.
- Settings: connector setup surfaces, HTTPS MCP registration, connection testing, tool discovery and stored per-tool permissions, audit trail, capability boundaries.

This is a functional product prototype with real per-user persistence and file storage. It is not the fully operational enterprise platform in the supplied long-term vision. Source-labelled Confluence, Notion and SharePoint records are explicitly fictional. No enterprise accounts or AI service credentials are bundled.

## Stack and storage

React 19, TypeScript, Vinext, Tailwind, Radix/Shadcn primitives, Cloudflare Workers, D1 and R2. The system font stack uses San Francisco on Apple platforms. Responsive sidebar, keyboard command search, focus-visible controls and reduced-motion handling are included.

D1 stores per-user records, document text and append-only activity entries. R2 stores uploaded originals. Every API checks the trusted platform identity. Queries and downloads include the authenticated user ID. Mutations reject cross-origin browser requests. The production host must strip spoofed identity headers; Sites provides the trusted identity boundary. The site remains owner-private.

## Run locally

1. `npm ci`
2. `npm run build`
3. `node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_abandoned_princess_powerful.sql`
4. `npm run dev -- --host 127.0.0.1`
5. Open the printed URL and use Sign in for the local test identity.

Apply a migration only once to an existing local database. Runtime never creates tables. Hosted migrations are included in the deployment artifact.

Later migrations (`0001`–`0003`) are applied the same way with their file names. `0003_document_hash.sql` adds upload fingerprints for duplicate warnings; uploads still work without it.

The cookie-only local sign-in runs only under the Vite dev server (or with `SITES_DEV_AUTH=1` outside production), and the local mock strips any `oai-*` identity headers sent by the browser. Set `APP_ORIGIN` when the public origin differs from the request origin (used for the Notion OAuth redirect).

## Database on Vercel: Supabase Postgres + pgvector

When `POSTGRES_URL` is set (the Vercel Supabase integration adds it), the Vercel build stores everything in Supabase Postgres (Mumbai, `bom1`; functions are pinned to the same region in `vercel.json`). Without it, the app falls back to the single SQLite file in Vercel Blob. Uploaded originals stay in Blob.

- Tables live in a private schema (`PG_SCHEMA`, default `internal_ai`) that Supabase's REST API does not expose. Row-level security is on and `anon`/`authenticated` have no access; only the server connects.
- The app uses the session pooler (port 5432) even if the URL says 6543. The transaction pooler drops replies under concurrency with postgres.js; set `PG_TRANSACTION_POOLER=1` only to override. `PG_POOL_MAX` (default 3) sets connections per instance.
- Ask searches document passages instead of loading every document: full-text (tsvector + GIN) straight away, plus pgvector semantic search (HNSW, cosine) once the AI key allows the embedding model (`AI_EMBEDDING_MODEL`, default `text-embedding-v4`, 1024 dimensions). Results are fused by rank.
- Moving data from Blob to Postgres (safe to repeat; it upserts and never deletes):

```bash
PG_SCHEMA=internal_ai POSTGRES_URL=... BLOB_READ_WRITE_TOKEN=... node --experimental-strip-types scripts/migrate-to-postgres.mjs
PG_SCHEMA=internal_ai POSTGRES_URL=... node --experimental-strip-types scripts/index-documents.mjs
```

## Sign-in, team accounts and messaging (Vercel)

Everyone signs in by email, with no passwords. One click on **Email me a sign-in link** sends two emails:

- **Firebase email link** (project `internal-ai-6bb05`, configured in `lib/firebase-config.ts`; `NEXT_PUBLIC_FIREBASE_*` settings override it): Firebase (Google) emails a sign-in link. Opening it signs you in; the desktop app has a "paste the link" box. The server verifies the Firebase ID token with Google's public keys (issuer, audience, signature, verified email, signed in within the last 10 minutes), then applies the same team and domain rules. No Firebase secret is needed.
- **6-digit code** from the workspace's own email sender (Microsoft Graph or SMTP below). If it can't be sent, the page relies on the link.

Firebase setup: create a project, add a Web app, enable **Authentication → Email/Password → Email link (passwordless)**, and add `internal-ai.vercel.app` (and `localhost` for development) under **Authorized domains**. `NEXT_PUBLIC_*` values are built into the page, so redeploy after setting them.

- `ALLOWED_EMAIL_DOMAINS` (default `naar.io,nextgentechs.io`): anyone with an email at one of these exact domains can request a code; their account is created on first sign-in. People from other domains must be added in Settings → Team. Removing someone blocks them until they are added back.
- `AUTH_EMAIL`: the workspace admin. The admin keeps the original workspace, so existing data stays theirs. Optional `AUTH_NAME` sets the admin's display name.
- `AUTH_SECRET` (required): signs session cookies and sign-in codes. Use a long random value (`openssl rand -hex 32`). Changing it signs everyone out.
- Email sending, either:
  - **Microsoft Graph** (recommended for Microsoft 365, where password-based SMTP is being retired): `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` and `MAIL_FROM`. Register an app in Microsoft Entra, add the **Mail.Send** *application* permission and grant admin consent. To stop it sending as any mailbox, limit it to the sender with an Exchange application access policy.
  - **SMTP**: `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS, or 465 with `SMTP_SECURE=true`), `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`.
  Graph is used when its three settings are present. Without either option, production refuses to send codes (the admin can sign in with `AUTH_PASSWORD` meanwhile) and development prints the code in the server log.
- Codes are 6 digits, stored only as a keyed hash, single-use, expire after 10 minutes and allow 5 wrong guesses. A new code can be requested after 60 seconds. Sending is limited to 5 per email and 20 per network address per hour; checking to 15 per email and 30 per address per hour. Responses and timing don't reveal whether an email belongs to the team.
- The admin adds teammates (name and email) in **Settings → Team** and can remove them, which ends their access immediately. Each teammate gets a private workspace and can message anyone on the team from **Messages** (direct messages and groups, unread badges, "Seen").
- `oai-*` identity headers are ignored whenever cookie sessions are in use, so a browser can't claim another user's identity.
- The Blob-backed database uses conditional writes (ETag `ifMatch`), so concurrent writes from several server instances retry instead of overwriting each other. Reads re-check for a newer copy every 1.5 seconds.

Local development with `next dev --webpack -p 3100`: put overrides in `.env.development.local` (gitignored). Blank `BLOB_READ_WRITE_TOKEN` so development never touches production data, set `SITES_DEV_AUTH=1` and `AUTH_SECRET`, and optionally set `LOCAL_DB_FILE=.wrangler/state/dev-workspace.sqlite` to keep data across reloads. Browse on `http://localhost:3100` (not `127.0.0.1`) so the same-origin check passes.

Migrations `0004_team_messaging.sql` (team and messages) and `0005_login_codes.sql` (sign-in codes and rate limits) are for the D1 build; the Vercel runtime applies them automatically.

## Meeting assistant (Granola-style)

- **Your meetings:** each person connects Microsoft 365 (Teams/Outlook). The assistant lists meetings from yesterday to a week ahead with **Take notes** and **Join**, and **Import Teams transcript** for past Teams meetings that were transcribed in Teams. Tokens are stored encrypted (AES-GCM, key derived from `AUTH_SECRET`). Needs `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_CLIENT_SECRET` (optional `MS_GRAPH_TENANT_ID`, default `organizations`) and the delegated permissions in `.env.example`.
- **Call audio + mic:** records the call's tab or window audio (with "Share audio") mixed with the microphone, in 30-second chunks transcribed by `AI_ASR_MODEL` (default `qwen3-asr-flash`) through the AI gateway. The Windows desktop app captures the computer's own sound. If the AI key doesn't allow the speech model, the page says so and the microphone mode still works.
- **Your notes:** a notepad beside the transcript; **Enhance notes** keeps every point you wrote and expands it from the transcript, using the chosen template and the meeting's attendees.

## Live AI configuration

Configure server-side runtime values:

- `AI_GATEWAY_URL`: approved HTTPS OpenAI-compatible gateway base URL, e.g. your LiteLLM gateway including `/v1` when required.
- `AI_GATEWAY_KEY`: gateway bearer credential.
- `AI_MODEL`: an approved gateway model identifier.

No model is selected or charged until configured. Without these values, Ask returns labelled evidence extracts and structured draft templates. With them, the server sends accessible retrieved excerpts, the question, and a limited recent conversation to the approved gateway. Tool execution is never performed by the model.

## Agent backend

Stack: Cloudflare Workers (API routes), D1 (records, documents, jobs, capability cache), R2 (originals, generated files) and the OpenAI-compatible AI gateway. Skills are stored in the user's settings record and enforced on the server in `lib/engine.ts`; the browser never decides what runs.

| Skill | Implementation |
|---|---|
| RAG & memory | Lexical retrieval over sample, uploaded, Notion and approved-memory sources; history only when on |
| Documents | Attachments passed as evidence; images read by the vision model at upload |
| Web search | `web_search` tool → gateway search (`enable_search`, DashScope) |
| Read websites | Links in the question are read up front; `read_url` tool for others. Public http(s) only, private hosts blocked, redirects re-checked, 2 MB cap |
| Data analysis | `analyze_data` tool: structured filter/group/aggregate/sort over uploaded CSVs (`lib/data.ts`). Numeric questions about a retrieved CSV force the tool |
| Charts | Model emits ```` ```chart ```` JSON; rendered with Recharts |
| Document creation | `POST /api/export` builds a .docx (`lib/docx.ts`) and saves it to uploads |
| Images | `generate_image` tool (DashScope multimodal generation) — offered only when the key allows image models |
| Scheduled jobs | `POST /api/jobs` (create/update/delete/run/run-due). Due jobs run while the app is open (checked every 5 minutes, claimed atomically) |
| MCP tools | Enabled read-only tools on connected servers become agent tools; write tools are never offered |

`GET /api/capabilities` probes what the gateway key may use (vision, web search, image generation) with zero-cost invalid requests and caches the result for 12 hours per user.

## MCP

Register a server in Settings → MCP servers. Add its exact hostname to `MCP_ALLOWED_HOSTS` in server configuration. If required, set `MCP_TOKEN_<SERVER_ID>` using the identifier displayed in its permissions panel (uppercase; hyphens converted to underscores). Secrets are never stored in workspace records or returned to the browser.

Implemented: version negotiation (2025-03-26, 2025-06-18 and 2025-11-25), validated initialization acknowledgement, connection tests, paginated tool discovery, bounded JSON and streaming SSE parsing, response-ID matching, negotiated headers for stateful and stateless endpoints, session cleanup, HTTPS allowlist, deadlines, redirect rejection and persisted failure status. Catalog limits are 500 tools / 200 KB / 50 pages; responses are limited to 1 MB. Rediscovery resets tool permissions to disabled.

Supported live transport: HTTPS Streamable HTTP with no authentication or a server-managed bearer token. OAuth-only servers need an OAuth integration; local stdio and legacy SSE servers need a compatible remote gateway. Tool execution, automatic routing and session resumability are not implemented. Tool-provided read-only annotations are descriptive, not a security boundary. A Connected badge confirms the handshake, not successful execution of every tool.

Run `node --experimental-strip-types --test tests/mcp.mjs` for transport compatibility and failure-case tests. These use controlled fixtures, not enterprise credentials. Production live verification still requires each approved endpoint and its credentials.

## Documents

TXT, Markdown and CSV are decoded as text. PDF text uses unpdf. DOCX, PPTX and XLSX extract selected XML text with fflate. Originals up to 10 MB are stored privately. Extracted text is capped at 300,000 characters; Office expansion is bounded at 30 MB. Images (PNG, JPG, WebP up to 7 MB) are read by the gateway's vision model when it supports images: their text and a short description become searchable content. Spreadsheet XML extraction is not formula evaluation or a faithful table model. Scanned or encrypted PDFs may have no text or fail extraction. The UI reports unavailable text rather than claiming successful analysis.

## Validation

- `npx tsc --noEmit`
- `npm run build`
- `node tests/smoke.mjs` against the local development server: identity, persistence, origin rejection, evidence filtering, no-evidence responses, claim conflict, TXT uploads, private downloads, attachment context, per-user seed action IDs, MCP allowlist.
- `node tests/documents.mjs`: synthetic PDF, DOCX, PPTX and XLSX uploads through the HTTP API.

Tests create synthetic records only in the local test workspace. No test records are bundled into production. Browser QA covers Client 360, source sheets, search/filtering, document comparison, pricing recalculation and saving, chat, command navigation, and the mobile layout. WebMCP navigation validates section inputs and uses the same visible state.

## Production work still required

The supplied vision includes capabilities beyond this prototype: native enterprise OAuth connectors and ACL synchronization; vector/hybrid retrieval and evaluation; incremental indexing and revocation; automatic knowledge graph construction; semantic duplicate/conflict/claim detection; live CRM/HR/project data; full agent orchestration and tool execution with idempotent approvals; channel adapters; scheduled proactive intelligence; operational observability and tenant/admin controls. These require further implementation and organisation-specific integration, not merely entering an API key. Current knowledge-health findings and cross-source relationships are curated examples. Claim checking is text-overlap screening with explicit human-review labels, not truth verification.
