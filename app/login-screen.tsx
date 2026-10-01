"use client";

import "./login.css";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, Link2, LoaderCircle, MailCheck, Sparkles } from "lucide-react";
import { emailForLink, finishSignIn, firebaseEnabled, isSignInLink, sendSignInLink } from "@/lib/firebase-client";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PENDING_KEY = "ia-login-pending";

type Pending = { email: string; resendAt: number; codeSent?: boolean; linkSent?: boolean; adminFallback?: boolean };

function readPending(): Pending | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
    return data && typeof data.email === "string" && typeof data.resendAt === "number" ? data : null;
  } catch {
    return null;
  }
}
function writePending(value: Pending | null) {
  try {
    if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {}
}

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: unknown; code?: unknown; wait?: unknown };
  return { ok: response.ok, status: response.status, data };
}

/** "Good morning" / "Good afternoon" / "Good evening" by the viewer's clock. */
function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const INSPIRATION = [
  { line: "Great work starts with a good question.", note: "Ask anything. Your team’s knowledge is ready." },
  { line: "What one of us learns, all of us can build on.", note: "Every answer shows where it came from." },
  { line: "Small steps every day add up to something remarkable.", note: "Pick up where you left off." },
  { line: "Curiosity is where every breakthrough begins.", note: "Explore an idea, then make it real." },
  { line: "Together, we know more than any of us alone.", note: "Share what you know with your colleagues." },
];

/** The welcoming side of the sign-in screen: a calm backdrop and a line of encouragement. */
function Inspiration() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % INSPIRATION.length), 7000);
    return () => window.clearInterval(t);
  }, []);
  const item = INSPIRATION[index];
  return (
    <aside className="login-inspire" aria-label="A note for today">
      <div className="inspire-art" aria-hidden="true">
        <span className="inspire-orb one" />
        <span className="inspire-orb two" />
        <span className="inspire-orb three" />
        <span className="inspire-words">
          learn · share · build · grow · learn · share · build · grow · learn · share · build · grow
        </span>
      </div>
      <div className="inspire-brand">
        <span className="brand-icon" aria-hidden="true">
          <Sparkles size={18} />
        </span>
        Internal AI
      </div>
      <figure className="inspire-quote" key={index}>
        <blockquote>{item.line}</blockquote>
        <figcaption>{item.note}</figcaption>
      </figure>
      <div className="inspire-dots" aria-hidden="true">
        {INSPIRATION.map((_, i) => (
          <i key={i} className={i === index ? "on" : ""} />
        ))}
      </div>
    </aside>
  );
}

export function LoginScreen({
  expired = false,
  onSignedIn,
}: {
  expired?: boolean;
  onSignedIn: () => void | Promise<void>;
}) {
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [password, setPassword] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [formError, setFormError] = useState(
    expired ? "Your session has ended. Sign in again to keep working." : "",
  );
  const [fieldError, setFieldError] = useState("");
  const [notice, setNotice] = useState("");
  // What actually went out: the Firebase link, our 6-digit code, or both.
  const [codeSent, setCodeSent] = useState(true);
  const [linkSent, setLinkSent] = useState(false);
  const [adminFallback, setAdminFallback] = useState(false);
  const [pastedLink, setPastedLink] = useState("");
  const [finishing, setFinishing] = useState<"" | "working" | "need-email">("");
  const [linkToFinish, setLinkToFinish] = useState("");

  // Opened the emailed sign-in link: finish signing in here.
  useEffect(() => {
    const href = window.location.href;
    void isSignInLink(href).then((yes) => {
      if (!yes) return;
      window.history.replaceState(null, "", "/");
      const known = emailForLink();
      setLinkToFinish(href);
      if (!known) {
        // Opened on a different browser or device: confirm the email first.
        setFinishing("need-email");
        return;
      }
      setEmail(known);
      void completeLink(known, href);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function completeLink(address: string, link: string) {
    setFinishing("working");
    setFormError("");
    try {
      await finishSignIn(address, link);
      writePending(null);
      await onSignedIn();
    } catch (error) {
      setFinishing("");
      setStep("email");
      setFormError((error as Error).message);
    }
  }

  // A refresh while waiting for the email keeps you on the code step.
  useEffect(() => {
    const pending = readPending();
    if (!pending) return;
    setEmail(pending.email);
    setResendAt(pending.resendAt);
    setCodeSent(pending.codeSent ?? true);
    setLinkSent(!!pending.linkSent);
    setAdminFallback(!!pending.adminFallback);
    setStep("code");
  }, []);

  useEffect(() => {
    if (step !== "code") return;
    codeRef.current?.focus();
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [step]);

  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function sendCode(resend = false) {
    const address = email.trim();
    if (!EMAIL.test(address)) {
      setFieldError("Enter your work email, like name@company.com.");
      setFormError("");
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    setFieldError("");
    setFormError("");
    setNotice("");
    try {
      // Firebase emails a sign-in link while the workspace emails a 6-digit code.
      const [codeResult, linkResult] = await Promise.all([
        post("/api/auth/code", { email: address }),
        firebaseEnabled()
          ? sendSignInLink(address).then(
              () => true,
              () => false,
            )
          : Promise.resolve(false),
      ]);
      const { ok, data } = codeResult;
      const usePassword = !ok && data.code === "use_password";
      if (!ok && !linkResult) {
        if (usePassword) {
          // Neither email went out: the admin signs in with their password.
          setStep("password");
          setNotice(
            typeof data.error === "string"
              ? data.error
              : "Email sign-in isn’t available right now. The workspace admin can sign in with their password.",
          );
          requestAnimationFrame(() => passwordRef.current?.focus());
          return;
        }
        setFormError(typeof data.error === "string" ? data.error : "We couldn’t send a code. Please try again.");
        return;
      }
      const next = Date.now() + (ok && typeof data.wait === "number" ? data.wait : 60) * 1000;
      setResendAt(next);
      setNow(Date.now());
      setCodeSent(ok);
      setLinkSent(linkResult);
      setAdminFallback(usePassword);
      writePending({ email: address, resendAt: next, codeSent: ok, linkSent: linkResult, adminFallback: usePassword });
      setCode("");
      setPastedLink("");
      setStep("code");
      if (resend) setNotice(ok ? "A new code is on its way. Use the most recent email." : "A new sign-in link is on its way.");
      else if (!ok && linkResult) setNotice("The 6-digit code couldn’t be sent right now, so use the sign-in link instead.");
    } catch {
      setFormError("The workspace couldn’t be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 6) {
      setFieldError("Enter the 6-digit code from your email.");
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    setFieldError("");
    setFormError("");
    try {
      const { ok, data } = await post("/api/auth/login", { email: email.trim(), code: digits });
      if (!ok) {
        setFormError(typeof data.error === "string" ? data.error : "That code didn’t work. Please try again.");
        setCode("");
        codeRef.current?.focus();
        return;
      }
      writePending(null);
      await onSignedIn();
    } catch {
      setFormError("The workspace couldn’t be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPassword() {
    if (!password) {
      setFieldError("Enter your password.");
      passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    setFieldError("");
    setFormError("");
    try {
      const { ok, data } = await post("/api/auth/login", { email: email.trim(), password });
      if (!ok) {
        setFormError(typeof data.error === "string" ? data.error : "Those details didn’t match. Please try again.");
        passwordRef.current?.focus();
        return;
      }
      await onSignedIn();
    } catch {
      setFormError("The workspace couldn’t be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function changeEmail() {
    setPassword("");
    writePending(null);
    setStep("email");
    setCode("");
    setFormError("");
    setFieldError("");
    setNotice("");
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  return (
    <div className="login-screen login-split">
      <Inspiration />
      <main className="login-card">
        <div className="login-brand" aria-hidden="true">
          <span className="brand-icon">{step === "code" ? <MailCheck size={22} /> : <Sparkles size={22} />}</span>
        </div>
        <p className="login-kicker">Internal AI</p>
        {finishing === "working" ? (
          <>
            <h1>Signing you in…</h1>
            <p className="login-lede">
              <LoaderCircle size={16} className="spin" aria-hidden="true" /> Checking your sign-in link.
            </p>
          </>
        ) : finishing === "need-email" ? (
          <>
            <h1>Confirm your email</h1>
            <p className="login-lede">
              You opened the sign-in link on a different browser or device. Enter the email it was sent to.
            </p>
            <form
              className="login-form"
              noValidate
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (!EMAIL.test(email.trim())) {
                  setFieldError("Enter your work email, like name@company.com.");
                  return;
                }
                void completeLink(email, linkToFinish);
              }}
            >
              <label htmlFor="login-confirm-email">
                Work email
                <input
                  id="login-confirm-email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  aria-invalid={fieldError ? true : undefined}
                />
              </label>
              {fieldError ? <p className="login-field-error">{fieldError}</p> : null}
              <button className="primary-button login-submit" type="submit">
                Continue
              </button>
            </form>
          </>
        ) : step === "email" ? (
          <>
            <h1>{greeting()}, welcome back</h1>
            <p className="login-lede">
              Sign in with your work email and pick up right where you left off. We’ll send you a secure
              {firebaseEnabled() ? " sign-in link" : " one-time code"}, so there’s no password to remember.
            </p>
            <form
              className="login-form"
              noValidate
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void sendCode();
              }}
            >
              {formError ? (
                <p className="login-alert" role="alert">
                  {formError}
                </p>
              ) : null}
              <label htmlFor="login-email">
                Work email
                <input
                  ref={emailRef}
                  id="login-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoFocus
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? "login-field-error" : undefined}
                />
              </label>
              {fieldError ? (
                <p id="login-field-error" className="login-field-error">
                  {fieldError}
                </p>
              ) : null}
              <button className="primary-button login-submit" type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <LoaderCircle size={16} className="spin" aria-hidden="true" />
                    Sending…
                  </>
                ) : firebaseEnabled() ? (
                  "Email me a sign-in link"
                ) : (
                  "Email me a code"
                )}
              </button>
            </form>
          </>
        ) : step === "password" ? (
          <>
            <h1>Admin sign-in</h1>
            <p className="login-lede">
              Signing in as <strong className="login-email-shown">{email.trim()}</strong>.
            </p>
            <form
              className="login-form"
              noValidate
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void signInWithPassword();
              }}
            >
              {formError ? (
                <p className="login-alert" role="alert">
                  {formError}
                </p>
              ) : notice ? (
                <p className="login-notice" role="status">
                  {notice}
                </p>
              ) : null}
              <label htmlFor="login-password">
                Admin password
                <input
                  ref={passwordRef}
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? "login-field-error" : undefined}
                />
              </label>
              {fieldError ? (
                <p id="login-field-error" className="login-field-error">
                  {fieldError}
                </p>
              ) : null}
              <button className="primary-button login-submit" type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <LoaderCircle size={16} className="spin" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </button>
              <div className="login-actions">
                <button type="button" className="login-link" onClick={changeEmail}>
                  <ArrowLeft size={14} aria-hidden="true" /> Use a different email
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h1>Check your email</h1>
            <p className="login-lede">
              If <strong className="login-email-shown">{email.trim()}</strong> can use this workspace, we’ve sent it{" "}
              {linkSent && codeSent
                ? "a sign-in link and a 6-digit code. Open the link, or enter the code below."
                : linkSent
                  ? "a sign-in link. Open it on this device to sign in."
                  : "a 6-digit code. It expires in 10 minutes."}
            </p>
            <form
              className="login-form"
              noValidate
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void verify();
              }}
            >
              {formError ? (
                <p className="login-alert" role="alert">
                  {formError}
                </p>
              ) : notice ? (
                <p className="login-notice" role="status">
                  {notice}
                </p>
              ) : null}
              {codeSent && (
              <>
              <label htmlFor="login-code">
                Sign-in code
                <input
                  ref={codeRef}
                  id="login-code"
                  name="code"
                  className="login-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={7}
                  spellCheck={false}
                  value={code}
                  placeholder="000000"
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setCode(digits);
                    setFieldError("");
                    // Submit as soon as all six digits are in (typed or pasted).
                    if (digits.length === 6 && !busy) void verify(digits);
                  }}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? "login-field-error" : "login-code-help"}
                />
              </label>
              {fieldError ? (
                <p id="login-field-error" className="login-field-error">
                  {fieldError}
                </p>
              ) : (
                <p id="login-code-help" className="login-help">
                  Can’t find it? Check your spam or junk folder.
                </p>
              )}
              <button className="primary-button login-submit" type="submit" disabled={busy}>
                {busy ? (
                  <>
                    <LoaderCircle size={16} className="spin" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </button>
              </>
              )}
              {linkSent && (
                <div className="login-paste">
                  <label htmlFor="login-link">
                    <span>
                      <Link2 size={14} aria-hidden="true" /> {codeSent ? "Or paste the sign-in link" : "Opened the email elsewhere? Paste the link"}
                    </span>
                    <input
                      id="login-link"
                      type="url"
                      inputMode="url"
                      spellCheck={false}
                      value={pastedLink}
                      placeholder="https://…"
                      onChange={(e) => setPastedLink(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!pastedLink.trim() || busy}
                    onClick={async () => {
                      if (!(await isSignInLink(pastedLink.trim()))) {
                        setFormError("That doesn’t look like the sign-in link. Copy the whole link from the email.");
                        return;
                      }
                      await completeLink(email, pastedLink.trim());
                    }}
                  >
                    Sign in with link
                  </button>
                </div>
              )}
              {adminFallback && (
                <button
                  type="button"
                  className="login-link"
                  onClick={() => {
                    setStep("password");
                    setNotice("");
                    requestAnimationFrame(() => passwordRef.current?.focus());
                  }}
                >
                  Workspace admin? Sign in with your password
                </button>
              )}
              <div className="login-actions">
                <button type="button" className="login-link" onClick={changeEmail}>
                  <ArrowLeft size={14} aria-hidden="true" /> Use a different email
                </button>
                <button
                  type="button"
                  className="login-link"
                  disabled={busy || wait > 0}
                  onClick={() => void sendCode(true)}
                >
                  {wait > 0 ? `Resend in ${wait}s` : linkSent && !codeSent ? "Resend link" : "Resend"}
                </button>
              </div>
            </form>
          </>
        )}
        <p className="login-footnote">Your questions and documents stay on this workspace.</p>
      </main>
    </div>
  );
}

export function LoginSplash() {
  return (
    <div className="login-screen">
      <main className="login-card login-card-quiet">
        <div className="login-brand" aria-hidden="true">
          <span className="brand-icon">
            <Sparkles size={22} />
          </span>
        </div>
        <p className="login-kicker">Internal AI</p>
        <h1>Opening your workspace…</h1>
      </main>
    </div>
  );
}
