"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api-client";
import { authErrorMessage } from "@/lib/auth-error";
import { supabaseBrowser } from "@/lib/supabase/browser";

type AuthMode = "sign-in" | "sign-up";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth: "Google sign-in could not be completed. Please try again.",
  profile: "Your account was verified, but your profile could not be saved. Please sign in again.",
  roles: "Your account was verified, but account roles could not be loaded. Please try again.",
  profile_setup: "Email sign-in needs a database update before accounts can finish setup. Please contact the OJAH team.",
  roles_setup: "Account onboarding needs a database update before new accounts can continue. Please contact the OJAH team.",
};

const googleAuthEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

function returnPath() {
  const requested = new URLSearchParams(window.location.search).get("next");
  if (!requested) return "/dashboard";
  const destination = new URL(requested, window.location.origin);
  return destination.origin === window.location.origin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/dashboard";
}

export default function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") ?? "";
  const initialError = AUTH_ERROR_MESSAGES[errorCode] ?? "";
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);

  async function resendConfirmation() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your email address first.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { error: resendError } = await supabaseBrowser().auth.resend({
        type: "signup",
        email: normalizedEmail,
      });
      if (resendError) {
        setError(authErrorMessage(resendError));
        return;
      }
      setMessage("A new confirmation link has been sent. Check your inbox.");
      setCanResendConfirmation(false);
    } catch (requestError) {
      setError(authErrorMessage({
        message: requestError instanceof Error ? requestError.message : "Request failed",
      }));
    } finally {
      setBusy(false);
    }
  }

  async function finishSignIn(userId: string, isNewAccount: boolean) {
    const client = supabaseBrowser();
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user?.email || userData.user.id !== userId) {
      setError("Your sign-in succeeded, but your account details could not be confirmed. Please sign in again.");
      return;
    }

    try {
      await apiRequest("/api/account/profile", { method: "POST", body: "{}" });
    } catch (profileError) {
      console.error("Could not save the authenticated user's profile", profileError);
      setError(authErrorMessage({
        message: profileError instanceof Error ? profileError.message : "Your profile could not be saved.",
      }));
      return;
    }

    let roles: string[];
    try {
      roles = await apiRequest<string[]>("/api/account/roles");
    } catch (rolesError) {
      console.error("Could not load account roles after sign-in", rolesError);
      setError(authErrorMessage({
        message: rolesError instanceof Error ? rolesError.message : "Account roles could not be loaded.",
      }));
      return;
    }

    const destination = returnPath();
    if (isNewAccount || roles.length === 0) {
      router.replace(`/onboarding/roles?next=${encodeURIComponent(destination)}`);
      return;
    }
    router.replace(destination);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (mode === "sign-up" && password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    setCanResendConfirmation(false);
    try {
      const client = supabaseBrowser();
      if (mode === "sign-up") {
        const { data, error: signUpError } = await client.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: new URL(
              `/auth/callback?next=${encodeURIComponent(returnPath())}`,
              window.location.origin,
            ).toString(),
          },
        });
        if (signUpError) {
          setError(authErrorMessage(signUpError));
          return;
        }
        if (!data.user) {
          setError("We couldn't create your account. Please try again.");
          return;
        }
        if (data.user.identities?.length === 0) {
          setError("An account with this email already exists. Sign in instead.");
          setMode("sign-in");
          return;
        }
        if (!data.session) {
          setMessage("Check your email for a confirmation link. Confirm your address to finish creating your account.");
          setCanResendConfirmation(true);
          return;
        }
        await finishSignIn(data.user.id, true);
        return;
      }

      const { data, error: signInError } = await client.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      if (signInError) {
        setError(authErrorMessage(signInError));
        setCanResendConfirmation(signInError.code === "email_not_confirmed");
        return;
      }
      if (!data.user) {
        setError("We couldn't sign you in. Please check your details and try again.");
        return;
      }
      await finishSignIn(data.user.id, false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "We couldn't complete sign-in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    if (!googleAuthEnabled) {
      setError("Google sign-in is not configured for OJAH yet. Use email and password for now.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    setCanResendConfirmation(false);
    try {
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", returnPath());
      const { error: oauthError } = await supabaseBrowser().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback.toString() },
      });
      if (oauthError) setError(authErrorMessage(oauthError));
    } catch (oauthError) {
      setError(authErrorMessage({
        message: oauthError instanceof Error ? oauthError.message : "Google sign-in couldn't be started. Please try again.",
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-wrap">
        <header className="auth-header">
          <Link className="auth-mark" href="/" aria-label="OJAH — Every Market, One Place.">
            <Image alt="" className="brand-logo" height={56} priority src="/ojah-logo.png" style={{ width: "min(168px, 37vw)", height: "auto" }} width={168} />
          </Link>
          <Link className="auth-home-link" href="/">Back to home</Link>
        </header>

        <div className="auth-content">
          <aside className="auth-story" aria-label="About OJAH">
          <p className="auth-kicker"><span aria-hidden="true" /> Every Market, One Place.</p>
            <h2>One less thing to worry about.</h2>
            <p className="auth-story-copy">
              Discover local markets and businesses, and keep your everyday errands moving with OJAH.
            </p>
            <div className="auth-promise" aria-label="OJAH service benefits">
              <p><span aria-hidden="true">✓</span> Simple, dependable errand support</p>
              <p><span aria-hidden="true">✓</span> Updates as your request moves</p>
              <p><span aria-hidden="true">✓</span> One account for your OJAH experience</p>
            </div>
            <div className="auth-stamp" aria-hidden="true">
              <span>LOCAL</span>
              <strong>MADE<br />FOR LAGOS</strong>
              <span>OJAH · LAGOS</span>
            </div>
          </aside>

          <section className="auth-card" aria-labelledby="auth-title">
            <div className="auth-card-heading">
              <p className="auth-card-eyebrow">{mode === "sign-up" ? "Get started" : "Welcome back"}</p>
              <h1 id="auth-title">{mode === "sign-up" ? "Create your account" : "Sign in to OJAH"}</h1>
              <p>
                {mode === "sign-up"
                  ? googleAuthEnabled
                    ? "Use your email, or continue securely with Google."
                    : "Create your account with your email and password."
                  : "Your errands are just a sign-in away."}
              </p>
            </div>

            <div className="auth-tabs" aria-label="Account action" role="group">
              <button
                aria-pressed={mode === "sign-in"}
                className={mode === "sign-in" ? "is-active" : ""}
                disabled={busy}
                onClick={() => { setMode("sign-in"); setError(""); setMessage(""); setCanResendConfirmation(false); }}
                type="button"
              >
                Sign in
              </button>
              <button
                aria-pressed={mode === "sign-up"}
                className={mode === "sign-up" ? "is-active" : ""}
                disabled={busy}
                onClick={() => { setMode("sign-up"); setError(""); setMessage(""); setCanResendConfirmation(false); }}
                type="button"
              >
                Create account
              </button>
            </div>

            <form className="auth-form" onSubmit={submit}>
              <div className="auth-field">
                <label htmlFor="email">Email address</label>
                <input
                  autoComplete="email"
                  id="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  type="email"
                  value={email}
                />
              </div>
              <div className="auth-field">
                <label htmlFor="password">Password</label>
                <input
                  autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                  id="password"
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={mode === "sign-up" ? 8 : undefined}
                  required
                  type="password"
                  value={password}
                />
                {mode === "sign-up" && <span className="auth-field-hint">Use at least 8 characters.</span>}
              </div>
              <button className="auth-submit" disabled={busy} type="submit">
                {busy ? "Please wait…" : mode === "sign-up" ? "Create account" : "Sign in"}
                {!busy && <span aria-hidden="true">→</span>}
              </button>
            </form>

            <div className="auth-divider"><span>{googleAuthEnabled ? "or continue with" : "Google sign-in"}</span></div>

            {googleAuthEnabled ? (
              <button
                className="auth-google"
                disabled={busy}
                onClick={() => void signInWithGoogle()}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 48 48">
                  <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
                  <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
                  <path fill="#FBBC05" d="M12.6 27.7a12 12 0 0 1 0-7.4V15H5.8a20 20 0 0 0 0 18l6.8-5.3Z" />
                  <path fill="#EA4335" d="M24 11.9c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 5.8 29.5 4 24 4A20 20 0 0 0 5.8 15l6.8 5.3c1.6-4.8 6.1-8.4 11.4-8.4Z" />
                </svg>
                Continue with Google
              </button>
            ) : (
              <p className="auth-field-hint" role="status">
                Google sign-in is unavailable until the OJAH Google OAuth provider is configured.
              </p>
            )}

            {message && <p className="auth-message" role="status">{message}</p>}
            {(error || initialError) && (
              <p className="auth-error" role="alert">{error || initialError}</p>
            )}
            {canResendConfirmation && (
              <button
                className="auth-home-link"
                disabled={busy}
                onClick={() => void resendConfirmation()}
                type="button"
              >
                Resend confirmation email
              </button>
            )}
            <p className="auth-legal">
              By continuing, you agree to use OJAH responsibly. We&apos;ll only use your account details to provide the service.
            </p>
          </section>
        </div>

        <footer className="auth-footer">
          <span>OJAH · Lagos</span>
          <span>Every Market, One Place.</span>
        </footer>
      </div>
    </main>
  );
}
