"use client";

import { FormEvent, useRef, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";

export function LoginScreen({
  expired = false,
  onSignedIn,
}: {
  expired?: boolean;
  onSignedIn: () => void | Promise<void>;
}) {
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(
    expired ? "Your session has ended. Sign in again to keep working." : "",
  );
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>(
    {},
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: { email?: string; password?: string } = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "Enter your work email, like name@company.com.";
    }
    if (!password) next.password = "Enter your password.";
    setFieldError(next);
    if (next.email || next.password) {
      setFormError("");
      (next.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (!response.ok) {
        setFormError(
          typeof body.error === "string"
            ? body.error
            : "Those details didn’t match. Check your email and password, then try again.",
        );
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

  return (
    <div className="login-screen">
      <main className="login-card">
        <div className="login-brand" aria-hidden="true">
          <span className="brand-icon">
            <Sparkles size={22} />
          </span>
        </div>
        <p className="login-kicker">Internal AI</p>
        <h1>Sign in to your workspace</h1>
        <p className="login-lede">
          Use your organisation account to ask, save knowledge and keep work private to this instance.
        </p>
        <form className="login-form" onSubmit={submit} noValidate>
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
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com…"
              aria-invalid={fieldError.email ? true : undefined}
              aria-describedby={fieldError.email ? "login-email-error" : undefined}
            />
          </label>
          {fieldError.email ? (
            <p id="login-email-error" className="login-field-error">
              {fieldError.email}
            </p>
          ) : null}
          <label htmlFor="login-password">
            Password
            <input
              ref={passwordRef}
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your workspace password…"
              aria-invalid={fieldError.password ? true : undefined}
              aria-describedby={fieldError.password ? "login-password-error" : undefined}
            />
          </label>
          {fieldError.password ? (
            <p id="login-password-error" className="login-field-error">
              {fieldError.password}
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
        </form>
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
