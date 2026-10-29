"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

const INTERNATIONAL_PHONE = /^\+[1-9]\d{7,14}$/;
const OTP = /^\d{4,8}$/;
type AuthMode = "sign-in" | "sign-up";

function returnPath() {
  const requested = new URLSearchParams(window.location.search).get("next");
  if (!requested) return "/";
  const destination = new URL(requested, window.location.origin);
  return destination.origin === window.location.origin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/";
}

export default function SignInForm() {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPhone = phone.trim();
    if (!INTERNATIONAL_PHONE.test(normalizedPhone)) {
      setError("Enter your phone in international format, for example +2348012345678.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { error: requestError } = await supabaseBrowser().auth.signInWithOtp({
        phone: normalizedPhone,
        options: { shouldCreateUser: mode === "sign-up" },
      });
      if (requestError) {
        setError(requestError.message);
        return;
      }
      setPhone(normalizedPhone);
      setStage("code");
      setMessage(`We sent a verification code to ${normalizedPhone}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "We couldn't send a code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = code.trim();
    if (!OTP.test(normalizedCode)) {
      setError("Enter the verification code from your SMS.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const client = supabaseBrowser();
      const { data, error: verifyError } = await client.auth.verifyOtp({
        phone,
        token: normalizedCode,
        type: "sms",
      });
      if (verifyError) {
        setError(verifyError.message);
        return;
      }
      if (!data.user?.phone) {
        setError("We couldn't confirm the verified phone number. Request a new code and try again.");
        return;
      }

      const { error: profileError } = await client.from("profiles").upsert(
        { id: data.user.id, phone: data.user.phone },
        { onConflict: "id" },
      );
      if (profileError) {
        const { error: signOutError } = await client.auth.signOut();
        if (signOutError) console.error("Could not clear the incomplete Supabase session", signOutError);
        setError("Your number was verified, but your profile could not be saved. Please try signing in again.");
        return;
      }

      window.location.assign(returnPath());
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "We couldn't verify that code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Link href="/" className="text-sm font-semibold text-brand">Errand Runs</Link>
      <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-2xl font-semibold">
          {mode === "sign-up" ? "Create your account" : "Sign in"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {mode === "sign-up"
            ? "Create an Errand Runs account with your phone number. We'll text you a one-time verification code."
            : "Enter the phone number linked to your account and we'll text you a one-time verification code."}
        </p>

        {stage === "phone" ? (
          <>
            <div className="mt-6 grid grid-cols-2 rounded-xl bg-brand-soft p-1" aria-label="Account action" role="group">
              <button
                aria-pressed={mode === "sign-in"}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === "sign-in" ? "bg-white text-brand shadow-sm" : "text-muted"}`}
                onClick={() => setMode("sign-in")}
                type="button"
              >
                Sign in
              </button>
              <button
                aria-pressed={mode === "sign-up"}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === "sign-up" ? "bg-white text-brand shadow-sm" : "text-muted"}`}
                onClick={() => setMode("sign-up")}
                type="button"
              >
                Create account
              </button>
            </div>
            <form className="mt-5 space-y-4" onSubmit={sendCode}>
              <label className="block text-sm font-medium" htmlFor="phone">Phone number</label>
              <input
                autoComplete="tel"
                className="w-full rounded-xl border border-line bg-white px-3 py-3"
                id="phone"
                inputMode="tel"
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+2348012345678"
                required
                type="tel"
                value={phone}
              />
              <button className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-brand-ink disabled:opacity-60" disabled={busy} type="submit">
                {busy
                  ? "Sending code…"
                  : mode === "sign-up"
                    ? "Send sign-up code"
                    : "Send sign-in code"}
              </button>
            </form>
          </>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={verifyCode}>
            <label className="block text-sm font-medium" htmlFor="code">SMS verification code</label>
            <input
              autoComplete="one-time-code"
              className="w-full rounded-xl border border-line bg-white px-3 py-3"
              id="code"
              inputMode="numeric"
              onChange={(event) => setCode(event.target.value)}
              required
              type="text"
              value={code}
            />
            <button className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-brand-ink disabled:opacity-60" disabled={busy} type="submit">
              {busy ? "Verifying…" : mode === "sign-up" ? "Verify and create account" : "Verify and sign in"}
            </button>
            <button
              className="w-full text-sm underline underline-offset-4"
              disabled={busy}
              onClick={() => { setStage("phone"); setCode(""); setError(""); setMessage(""); }}
              type="button"
            >
              Use a different phone number
            </button>
          </form>
        )}

        {message && <p className="mt-4 text-sm text-brand" role="status">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
        <p className="mt-6 text-xs text-muted">
          SMS sign-in must be enabled for your Supabase project. Don&apos;t share your verification code with anyone.
        </p>
      </section>
    </main>
  );
}
