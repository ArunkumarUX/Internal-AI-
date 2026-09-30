import { ApiError } from "@/lib/server";

/*
 * Sign-in codes go out over SMTP:
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS,
 *   SMTP_FROM (e.g. "Internal AI <no-reply@company.com>"),
 *   SMTP_SECURE ("true" for port 465 / implicit TLS).
 * In development without SMTP_HOST the code is printed to the server log.
 */

export function mailConfigured() {
  return !!process.env.SMTP_HOST?.trim();
}

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
      console.info(`[auth] Sign-in code for ${to}: ${code} (SMTP isn't configured, so it wasn't emailed)`);
      return;
    }
    throw new ApiError("Email sign-in isn’t set up for this workspace yet. Ask your admin to configure SMTP.", 503);
  }
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  if (!from) throw new ApiError("Email sign-in isn’t set up for this workspace yet. Ask your admin to set SMTP_FROM.", 503);
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
  try {
    await (await smtp()).sendMail({ from, to, subject: `${code} is your Internal AI sign-in code`, text, html });
  } catch (error) {
    transport = null; // rebuild the connection next time
    console.error("[auth] Couldn’t send sign-in email:", error instanceof Error ? error.message : error);
    throw new ApiError("We couldn’t send the email just now. Please try again in a minute.", 503);
  }
}
