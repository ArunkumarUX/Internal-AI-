import { ApiError } from "@/lib/server";

/** Public-web page reader for the "Read websites" skill. */

const MAX_BYTES = 2_000_000;
const MAX_TEXT = 40_000;

function privateHost(hostname: string) {
  // A trailing dot ("localhost.") names the same host.
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan") ||
    !h.includes(".") && !h.includes(":")
  )
    return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (h.includes(":"))
    // Loopback, unspecified, unique-local, link-local, multicast, IPv4-mapped,
    // IPv4-compatible (::a.b.c.d → ::xxxx:xxxx) and NAT64 prefixes.
    return (
      h === "::1" ||
      h === "::" ||
      /^(fc|fd|fe[89ab]|ff)/.test(h) ||
      h.startsWith("::ffff:") ||
      /^::[0-9a-f]{1,4}(:[0-9a-f]{1,4})?$/.test(h) ||
      h.startsWith("64:ff9b:")
    );
  // Hostnames that are numeric in other notations (e.g. 2130706433).
  return /^\d+$/.test(h) || /^0x/i.test(h);
}

export function checkPublicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("That isn’t a valid web address.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new ApiError("Only public http(s) pages without credentials can be read.");
  if (url.port && !["80", "443"].includes(url.port))
    throw new ApiError("Only standard web ports can be read.");
  if (privateHost(url.hostname))
    throw new ApiError("Private or internal network addresses can’t be read.");
  return url;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function decode(text: string) {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Converts HTML to readable text, keeping headings, list items and links. */
export function htmlToText(html: string) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const body = (html.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? html)
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => `\n\n${"#".repeat(Math.min(Number(n) + 1, 4))} `)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|h[1-6]|li|tr|table|ul|ol|blockquote)>/gi, "\n")
    .replace(/<t[dh][^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

export async function readPage(value: string) {
  let url = checkPublicUrl(value);
  let response: Response | undefined;
  // Follow redirects manually so each hop is re-checked.
  for (let hop = 0; hop < 4; hop++) {
    response = await fetch(url, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "User-Agent": "InternalAI-Reader/1.0 (+read-only)",
      },
      signal: AbortSignal.timeout(15000),
    });
    const next = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && next) {
      await response.body?.cancel();
      url = checkPublicUrl(new URL(next, url).toString());
      continue;
    }
    break;
  }
  if (!response || !response.ok || !response.body)
    throw new ApiError(`The page returned HTTP ${response?.status ?? "error"}.`, 502);
  const type = response.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
    await response.body.cancel();
    throw new ApiError("Only HTML or plain-text pages can be read.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(chunk);
  }
  const raw = new TextDecoder().decode(
    chunks.reduce((all, c) => {
      const out = new Uint8Array(all.length + c.length);
      out.set(all);
      out.set(c, all.length);
      return out;
    }, new Uint8Array()),
  );
  const page = type.includes("html") ? htmlToText(raw) : { title: "", text: raw.trim() };
  return {
    url: url.toString(),
    title: page.title || url.hostname,
    text: page.text.slice(0, MAX_TEXT),
  };
}

export function urlsIn(text: string) {
  return [...new Set(text.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [])]
    .map((u) => u.replace(/[.,;:!?]+$/, ""))
    .slice(0, 3);
}
