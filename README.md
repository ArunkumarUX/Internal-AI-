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

## Live AI configuration

Configure server-side runtime values:

- `AI_GATEWAY_URL`: approved HTTPS OpenAI-compatible gateway base URL, e.g. your LiteLLM gateway including `/v1` when required.
- `AI_GATEWAY_KEY`: gateway bearer credential.
- `AI_MODEL`: an approved gateway model identifier.

No model is selected or charged until configured. Without these values, Ask returns labelled evidence extracts and structured draft templates. With them, the server sends accessible retrieved excerpts, the question, and a limited recent conversation to the approved gateway. Tool execution is never performed by the model.

## MCP

Register a server in Settings → MCP servers. Add its exact hostname to `MCP_ALLOWED_HOSTS` in server configuration. If required, set `MCP_TOKEN_<SERVER_ID>` using the identifier displayed in its permissions panel (uppercase; hyphens converted to underscores). Secrets are never stored in workspace records or returned to the browser.

Implemented: version negotiation (2025-03-26, 2025-06-18 and 2025-11-25), validated initialization acknowledgement, connection tests, paginated tool discovery, bounded JSON and streaming SSE parsing, response-ID matching, negotiated headers for stateful and stateless endpoints, session cleanup, HTTPS allowlist, deadlines, redirect rejection and persisted failure status. Catalog limits are 500 tools / 200 KB / 50 pages; responses are limited to 1 MB. Rediscovery resets tool permissions to disabled.

Supported live transport: HTTPS Streamable HTTP with no authentication or a server-managed bearer token. OAuth-only servers need an OAuth integration; local stdio and legacy SSE servers need a compatible remote gateway. Tool execution, automatic routing and session resumability are not implemented. Tool-provided read-only annotations are descriptive, not a security boundary. A Connected badge confirms the handshake, not successful execution of every tool.

Run `node --experimental-strip-types --test tests/mcp.mjs` for transport compatibility and failure-case tests. These use controlled fixtures, not enterprise credentials. Production live verification still requires each approved endpoint and its credentials.

## Documents

TXT, Markdown and CSV are decoded as text. PDF text uses unpdf. DOCX, PPTX and XLSX extract selected XML text with fflate. Originals up to 10 MB are stored privately. Extracted text is capped at 300,000 characters; Office expansion is bounded at 30 MB. Images are stored but have no OCR/vision processing. Spreadsheet XML extraction is not formula evaluation or a faithful table model. Scanned or encrypted PDFs may have no text or fail extraction. The UI reports unavailable text rather than claiming successful analysis.

## Validation

- `npx tsc --noEmit`
- `npm run build`
- `node tests/smoke.mjs` against the local development server: identity, persistence, origin rejection, evidence filtering, no-evidence responses, claim conflict, TXT uploads, private downloads, attachment context, per-user seed action IDs, MCP allowlist.
- `node tests/documents.mjs`: synthetic PDF, DOCX, PPTX and XLSX uploads through the HTTP API.

Tests create synthetic records only in the local test workspace. No test records are bundled into production. Browser QA covers Client 360, source sheets, search/filtering, document comparison, pricing recalculation and saving, chat, command navigation, and the mobile layout. WebMCP navigation validates section inputs and uses the same visible state.

## Production work still required

The supplied vision includes capabilities beyond this prototype: native enterprise OAuth connectors and ACL synchronization; vector/hybrid retrieval and evaluation; incremental indexing and revocation; automatic knowledge graph construction; semantic duplicate/conflict/claim detection; live CRM/HR/project data; full agent orchestration and tool execution with idempotent approvals; channel adapters; scheduled proactive intelligence; operational observability and tenant/admin controls. These require further implementation and organisation-specific integration, not merely entering an API key. Current knowledge-health findings and cross-source relationships are curated examples. Claim checking is text-overlap screening with explicit human-review labels, not truth verification.
