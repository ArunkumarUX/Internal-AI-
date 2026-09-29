import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { EMAIL_COOKIE, SESSION_COOKIE, SESSION_USER } from "@/lib/auth-session";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (userId && email) {
    const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
    const fullName =
      encodedFullName &&
      requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
        ? safeDecodeURIComponent(encodedFullName)
        : null;

    return {
      userId,
      displayName: fullName ?? email,
      email,
      fullName,
    };
  }

  if (!localSessionAllowed()) return null;
  const jar = await cookies();
  const session = jar.get(SESSION_COOKIE)?.value;
  if (session !== SESSION_USER) return null;
  const sessionEmail = jar.get(EMAIL_COOKIE)?.value;
  const signedEmail =
    sessionEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sessionEmail)
      ? sessionEmail
      : "seedy@local.test";
  const displayName = signedEmail === "seedy@local.test" ? "Local Seedy" : signedEmail;
  return {
    userId: SESSION_USER,
    displayName,
    email: signedEmail,
    fullName: displayName,
  };
}

/**
 * Cookie sessions are for the Vite dev server and the Vercel Node runtime.
 * ChatGPT Sites production still uses oai-* headers only.
 */
function localSessionAllowed() {
  if (process.env.VERCEL === "1" || process.env.SITES_DEV_AUTH === "1") return true;
  if (process.env.NODE_ENV === "production") return false;
  const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
  return dev;
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
