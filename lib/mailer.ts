import { ApiError } from "@/lib/server";

/*
 * Sign-in codes are emailed through one of:
 *
 * 1. Microsoft Graph (preferred for Microsoft 365): MS_GRAPH_TENANT_ID,
 *    MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, and MAIL_FROM (the mailbox
 *    that sends, e.g. "Internal AI <no-reply@company.com>"). The Entra app
 *    needs the Mail.Send application permission with admin consent.
 * 2. SMTP: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
 *    SMTP_FROM, SMTP_SECURE ("true" for port 465).
 *
 * In development without either, the code is printed to the server log.
 */

function graphConfigured() {
  return !!(
    process.env.MS_GRAPH_TENANT_ID?.trim() &&
    process.env.MS_GRAPH_CLIENT_ID?.trim() &&
    process.env.MS_GRAPH_CLIENT_SECRET?.trim()
  );
}

function smtpConfigured() {
  return !!process.env.SMTP_HOST?.trim() && !!process.env.SMTP_USER?.trim();
}

/** Email can be sent once Graph or SMTP is configured. */
export function mailConfigured() {
  return graphConfigured() || smtpConfigured();
}

/**
 * Until email is set up in production, the admin can still sign in with
 * AUTH_PASSWORD so nobody is locked out. It switches off by itself once email
 * is configured. Development always prints codes, so it never needs this.
 */
export function passwordFallback() {
  return process.env.NODE_ENV === "production" && !mailConfigured() && !!process.env.AUTH_PASSWORD;
}

/** The sender as "Name <address>", and the bare address. */
function sender() {
  const from = (process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  const name = from.includes("<") ? from.slice(0, from.indexOf("<")).trim().replace(/^"|"$/g, "") : "";
  return { from, address, name };
}

/* ---------------------------------------------------------------- */
/* Microsoft Graph                                                    */
/* ---------------------------------------------------------------- */

let graphToken: { value: string; expires: number } | null = null;

async function graphAccessToken() {
  if (graphToken && graphToken.expires > Date.now() + 60_000) return graphToken.value;
  const tenant = encodeURIComponent(process.env.MS_GRAPH_TENANT_ID!.trim());
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_GRAPH_CLIENT_ID!.trim(),
      client_secret: process.env.MS_GRAPH_CLIENT_SECRET!.trim(),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token)
    throw new Error(`Graph token request failed: ${data.error ?? response.status} ${data.error_description?.split("\r\n")[0] ?? ""}`);
  graphToken = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return graphToken.value;
}

async function sendWithGraph(to: string, subject: string, html: string) {
  const { address, name } = sender();
  if (!address) throw new ApiError("Email sign-in isn’t set up for this workspace yet. Ask your admin to set MAIL_FROM.", 503);
  const token = await graphAccessToken();
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(address)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        from: { emailAddress: { address, ...(name ? { name } : {}) } },
      },
      saveToSentItems: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401) graphToken = null;
    const detail = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new Error(`Graph sendMail failed: ${response.status} ${detail.error?.code ?? ""} ${detail.error?.message ?? ""}`);
  }
}

/* ---------------------------------------------------------------- */
/* SMTP                                                               */
/* ---------------------------------------------------------------- */

type Transport = { sendMail: (message: Record<string, unknown>) => Promise<unknown> };
let transport: Promise<Transport> | null = null;

async function smtp(): Promise<Transport> {
  if (!transport)
    transport = import("nodemailer").then((nodemailer) => {
      const port = Number(process.env.SMTP_PORT || 587);
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST!.trim(),
        port,
        secure: process.env.SMTP_SECURE === "true" || port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
        // Fail fast instead of holding the sign-in request open.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      }) as Transport;
    });
  return transport;
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function sendLoginCode(to: string, name: string, code: string, minutes: number) {
  if (!mailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[auth] Sign-in code for ${to}: ${code} (email isn't configured, so it wasn't sent)`);
      return;
    }
    throw new ApiError(
      "Email sign-in isn’t set up for this workspace yet. Ask your admin to configure email sending.",
      503,
      passwordFallback() ? "use_password" : "email_unavailable",
    );
  }
  const { from } = sender();
  if (!from) throw new ApiError("Email sign-in isn’t set up for this workspace yet. Ask your admin to set MAIL_FROM.", 503);
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi,";
  const text = [
    greeting,
    "",
    `Your Internal AI sign-in code is ${code}`,
    "",
    `It expires in ${minutes} minutes and can only be used once.`,
    "If you didn’t try to sign in, you can ignore this email. Nobody can sign in without the code.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f9fc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2a44">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #dfe5ef;border-radius:16px;padding:32px">
<tr><td style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#5146e5">INTERNAL AI</td></tr>
<tr><td style="padding:12px 0 4px;font-size:15px">${escape(greeting)}</td></tr>
<tr><td style="padding:0 0 20px;font-size:15px;line-height:1.5">Use this code to sign in to your workspace:</td></tr>
<tr><td align="center" style="padding:16px;background:#f5f6ff;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:.3em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</td></tr>
<tr><td style="padding:20px 0 0;font-size:13px;line-height:1.5;color:#5b6a85">It expires in ${minutes} minutes and can only be used once. If you didn’t try to sign in, you can ignore this email. Nobody can sign in without the code.</td></tr>
</table></td></tr></table></body></html>`;
  const subject = `${code} is your Internal AI sign-in code`;
  try {
    if (graphConfigured()) await sendWithGraph(to, subject, html);
    else await (await smtp()).sendMail({ from, to, subject, text, html });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    transport = null; // rebuild the connection next time
    console.error(
      `[auth] Couldn’t send sign-in email via ${graphConfigured() ? "Microsoft Graph" : "SMTP"}:`,
      error instanceof Error ? error.message : error,
    );
    throw new ApiError("We couldn’t send the email just now. Please try again in a minute.", 503);
  }
}
