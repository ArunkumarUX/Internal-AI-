import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth-session";
import { accountById, readSession, type Role } from "@/lib/accounts";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
  /** Workspace role for cookie sessions; ChatGPT Sites users have none. */
  role?: Role;
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
  // oai-* identity headers are only set by the ChatGPT Sites platform. Where
  // cookie sessions are in use (Vercel, local dev) a browser could send them
  // itself, so they are ignored there.
  const cookieMode = localSessionAllowed();
  const requestHeaders = await headers();
  const userId = cookieMode ? null : requestHeaders.get(USER_ID_HEADER);
  const email = cookieMode ? null : requestHeaders.get(USER_EMAIL_HEADER);
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

  if (!cookieMode) return null;
  const jar = await cookies();
  const sessionUser = readSession(jar.get(SESSION_COOKIE)?.value);
  if (!sessionUser) return null;
  // Removed teammates lose access on their next request.
  const account = await accountById(sessionUser).catch(() => null);
  if (!account) return null;
  return {
    userId: account.id,
    displayName: account.name,
    email: account.email,
    fullName: account.name,
    role: account.role,
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
