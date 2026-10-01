"use client";
/*
 * Firebase email-link sign-in in the browser. Firebase (Google) sends the
 * email; once the person opens or pastes the link, we hand the resulting ID
 * token to /api/auth/firebase, which applies the workspace's own rules and
 * starts a normal session. The Firebase session itself isn't kept.
 */
import type { Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
};
const EMAIL_KEY = "ia-firebase-email";

export const firebaseEnabled = () => !!(config.apiKey && config.authDomain && config.projectId);

let authPromise: Promise<Auth> | null = null;
async function auth() {
  if (!authPromise)
    authPromise = (async () => {
      const [{ initializeApp, getApps }, { getAuth, inMemoryPersistence, setPersistence }] = await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
      ]);
      const app = getApps()[0] ?? initializeApp(config);
      const a = getAuth(app);
      // The workspace keeps its own session; nothing Firebase-related is stored.
      await setPersistence(a, inMemoryPersistence);
      return a;
    })();
  return authPromise;
}

function remember(email: string) {
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {}
}
function remembered() {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}
function forget() {
  try {
    localStorage.removeItem(EMAIL_KEY);
  } catch {}
}

/** Asks Firebase to email a sign-in link that returns to this site. */
export async function sendSignInLink(email: string) {
  const { sendSignInLinkToEmail } = await import("firebase/auth");
  await sendSignInLinkToEmail(await auth(), email, {
    url: `${window.location.origin}/?signin=link`,
    handleCodeInApp: true,
  });
  remember(email);
}

export async function isSignInLink(link: string) {
  if (!firebaseEnabled() || !/[?&]oobCode=/.test(link)) return false;
  const { isSignInWithEmailLink } = await import("firebase/auth");
  return isSignInWithEmailLink(await auth(), link);
}

/** The email the link was requested for on this device, if any. */
export const emailForLink = () => remembered();

/** Completes sign-in with a link and starts the workspace session. */
export async function finishSignIn(email: string, link: string) {
  const { signInWithEmailLink, signOut } = await import("firebase/auth");
  const a = await auth();
  let idToken = "";
  try {
    const credential = await signInWithEmailLink(a, email.trim(), link.trim());
    idToken = await credential.user.getIdToken();
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    throw new Error(
      code === "auth/invalid-email"
        ? "That email doesn’t match the one the link was sent to."
        : code === "auth/expired-action-code" || code === "auth/invalid-action-code"
          ? "That sign-in link has expired or was already used. Request a new one."
          : "That sign-in link didn’t work. Request a new one.",
    );
  } finally {
    void signOut(a).catch(() => {});
  }
  const response = await fetch("/api/auth/firebase", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error || "Sign-in didn’t work. Please try again.");
  forget();
}
