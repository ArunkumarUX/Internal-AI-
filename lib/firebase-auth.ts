import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError } from "@/lib/server";
import { firebaseConfig } from "@/lib/firebase-config";

/*
 * Firebase email-link sign-in. Firebase (Google) emails the link and signs the
 * person in on the client; the server only checks the resulting ID token with
 * Google's public keys, so no service-account secret is needed. Our own team
 * and domain rules then decide whether that email may use the workspace.
 *
 * Configuration lives in lib/firebase-config.ts (public by design).
 */

export const firebaseProjectId = () => firebaseConfig.projectId.trim();

export function firebaseConfigured() {
  return !!(firebaseConfig.projectId && firebaseConfig.apiKey && firebaseConfig.authDomain);
}

const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

/** Freshly signed-in tokens only, so an old token can't be replayed. */
const MAX_AUTH_AGE_SECONDS = 10 * 60;

/** Verifies a Firebase ID token and returns the verified email address. */
export async function verifyFirebaseToken(idToken: string): Promise<string> {
  const projectId = firebaseProjectId();
  if (!firebaseConfigured()) throw new ApiError("Firebase sign-in isn’t set up for this workspace.", 503);
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    }));
  } catch {
    throw new ApiError("That sign-in link didn’t work. Request a new one.", 401, "bad_link");
  }
  const email = typeof payload.email === "string" ? payload.email : "";
  const authTime = typeof payload.auth_time === "number" ? payload.auth_time : 0;
  if (!email || payload.email_verified !== true)
    throw new ApiError("That sign-in link didn’t work. Request a new one.", 401, "bad_link");
  if (!payload.sub || Date.now() / 1000 - authTime > MAX_AUTH_AGE_SECONDS)
    throw new ApiError("That sign-in has expired. Request a new link.", 401, "expired");
  return email;
}
