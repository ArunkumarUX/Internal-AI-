import assert from "node:assert/strict";
const base = "http://localhost:5173";
const unauthorized = await fetch(`${base}/api/workspace`);
assert.equal(unauthorized.status, 401);
assert.equal((await fetch(`${base}/api/models`)).status, 401);
const login = await fetch(`${base}/signin-with-chatgpt?return_to=/`, {
  redirect: "manual",
});
const cookies = login.headers
  .getSetCookie()
  .map((x) => x.split(";")[0])
  .join("; ");
assert(cookies, "Local development sign-in must return a cookie");
async function call(path, body, headers = {}) {
  return fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookies,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
let r = await call("/api/workspace");
assert.equal(r.status, 200, await r.clone().text());
const ws = await r.json();
assert.equal(ws.user.userId, "local_seedy");
assert.equal(typeof ws.aiConfigured, "boolean");
assert.equal(typeof ws.aiModel, "string");
r = await call("/api/models");
assert.equal(r.status, 200, await r.clone().text());
const models = await r.json();
assert.equal(typeof models.configured, "boolean");
assert(Array.isArray(models.presets) && models.presets.length === 3);
assert.equal(models.presets[0].label, "Recommended");
if (models.configured && models.selected?.model) {
  r = await call("/api/models", {
    model: models.selected.model,
    fastModel: models.selected.fast,
  });
  assert.equal(r.status, 200, await r.clone().text());
}
r = await call(
  "/api/models",
  { model: "qwen3.8-max" },
  { Origin: "https://untrusted.example" },
);
assert.equal(r.status, 403);
r = await call("/api/workspace", {
  kind: "saved",
  data: {
    title: "QA · persistence check",
    content: "A synthetic test record.",
  },
});
assert.equal(r.status, 200);
const saved = await r.json();
r = await call("/api/workspace");
assert(
  (await r.json()).records.some((x) => x.id === saved.id),
  "Saved records survive a fresh request",
);
r = await call(
  "/api/workspace",
  { kind: "saved", data: { title: "Blocked cross-origin write" } },
  { Origin: "https://untrusted.example" },
);
assert.equal(r.status, 403);
r = await call("/api/ask", {
  query: "Prepare me for the Northstar Bank meeting",
  verified: true,
});
assert.equal(r.status, 200, await r.clone().text());
const answer = await r.json();
assert(answer.sourceIds.includes("meeting-notes"));
assert(answer.text.includes("August 2027"));
assert(!answer.sourceIds.includes("pricing-old"));
r = await call("/api/ask", {
  query: "zxqnonexistentsemantic123",
  verified: true,
});
assert.equal(r.status, 200);
assert((await r.json()).text.includes("No matching evidence"));
r = await call("/api/verify", {
  text: "Project Atlas will deploy in June 2027. We delivered a 40% cost reduction.",
});
assert.equal(r.status, 200);
const claims = (await r.json()).claims;
assert.equal(claims[0].status, "Potential conflict");
assert.notEqual(claims[1].status, "Exact source match");
const form = new FormData();
form.append(
  "file",
  new File(
    ["QA sample. The Zephyr project has a review on 12 November 2026."],
    "qa-zephyr.txt",
    { type: "text/plain" },
  ),
);
r = await fetch(`${base}/api/upload`, {
  method: "POST",
  headers: { Cookie: cookies },
  body: form,
});
assert.equal(r.status, 200, await r.clone().text());
const doc = await r.json();
assert(doc.content.includes("Zephyr"));
r = await call(`/api/files/${doc.id}`);
assert.equal(r.status, 200);
assert((await r.text()).includes("Zephyr"));
r = await fetch(`${base}/api/files/${doc.id}`);
assert.equal(r.status, 401);
r = await call("/api/ask", {
  query: "Summarise my attached document",
  attachmentIds: [doc.id],
});
assert.equal(r.status, 200);
assert((await r.json()).text.includes("Zephyr"));
r = await call("/api/workspace", {
  kind: "action",
  id: "act-brief",
  data: {
    id: "act-brief",
    title: "Prepare the Northstar executive brief",
    status: "Completed",
    owner: "Sarah Chen",
    client: "Northstar Bank",
    due: "2026-09-22",
    content: "QA completion",
    kind: "Draft",
  },
});
assert.equal(r.status, 200);
const action = await r.json();
assert.notEqual(
  action.id,
  "act-brief",
  "Seed actions must use user-scoped IDs",
);
r = await call("/api/workspace", {
  kind: "mcp",
  data: {
    title: "QA server",
    url: "https://unapproved.example/mcp",
    enabled: false,
    tools: [],
  },
});
assert.equal(r.status, 200);
const server = await r.json();
r = await call("/api/mcp", { id: server.id, operation: "test" });
assert.equal(r.status, 403);
const updated = await (await call("/api/workspace")).json();
const failedServer = updated.records.find(record => record.id === server.id);
assert.equal(failedServer.data.status, "Configuration required");
assert.match(failedServer.data.lastError, /approved HTTPS host list/);
assert(failedServer.data.lastTest);
console.log(
  "PASS: identity, persistence, cross-origin rejection, grounded retrieval, no-evidence response, claim conflicts, upload/download, private file access, attachment context, user-scoped actions, MCP host allowlist, model catalog.",
);
