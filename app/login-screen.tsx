"use client";

import "./login.css";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle, MailCheck, Sparkles } from "lucide-react";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PENDING_KEY = "ia-login-pending";

type Pending = { email: string; resendAt: number };

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

  // A refresh while waiting for the email keeps you on the code step.
  useEffect(() => {
    const pending = readPending();
    if (!pending) return;
    setEmail(pending.email);
    setResendAt(pending.resendAt);
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
      const { ok, data } = await post("/api/auth/code", { email: address });
      if (!ok && data.code === "use_password") {
        // Email isn't set up on this workspace yet: the admin signs in with their password.
        setStep("password");
        setNotice("Email sign-in isn’t set up yet. The workspace admin can sign in with their password.");
        requestAnimationFrame(() => passwordRef.current?.focus());
        return;
      }
      if (!ok) {
        setFormError(typeof data.error === "string" ? data.error : "We couldn’t send a code. Please try again.");
        return;
      }
      const next = Date.now() + (typeof data.wait === "number" ? data.wait : 60) * 1000;
      setResendAt(next);
      setNow(Date.now());
      writePending({ email: address, resendAt: next });
      setCode("");
      setStep("code");
      if (resend) setNotice("A new code is on its way. Use the most recent email.");
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
    <div className="login-screen">
      <main className="login-card">
        <div className="login-brand" aria-hidden="true">
          <span className="brand-icon">{step === "code" ? <MailCheck size={22} /> : <Sparkles size={22} />}</span>
        </div>
        <p className="login-kicker">Internal AI</p>
        {step === "email" ? (
          <>
            <h1>Sign in to your workspace</h1>
            <p className="login-lede">Enter your work email and we’ll send you a one-time sign-in code. No password needed.</p>
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
                    Sending code…
                  </>
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
              We sent a 6-digit code to <strong className="login-email-shown">{email.trim()}</strong>. It expires in 10
              minutes.
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
                  {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
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
