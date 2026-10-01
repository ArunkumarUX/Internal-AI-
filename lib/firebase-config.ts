/*
 * Firebase web app configuration for email-link sign-in. These values are
 * public by design (Firebase puts them in every web page that uses it); access
 * is controlled by Firebase's authorized domains and our own server checks.
 * NEXT_PUBLIC_FIREBASE_* settings override them, e.g. for another project.
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAxCcKjqSRGBKLjYS---4xQmalQrmbdLVk",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "internal-ai-6bb05.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "internal-ai-6bb05",
};
