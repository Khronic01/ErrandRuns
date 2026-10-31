"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { type AccountRole, isAccountRole } from "@/lib/roles";

const ROLE_LABEL: Record<AccountRole, string> = {
  customer: "Customer",
  runner: "Runner",
  business_owner: "Market/Business Owner",
};

function validRoleList(value: unknown): AccountRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isAccountRole);
}

export default function AccountDashboard() {
  const [roles, setRoles] = useState<AccountRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest<AccountRole[]>("/api/account/roles")
      .then((accountRoles) => {
        if (active) setRoles(validRoleList(accountRoles));
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "REQUEST_FAILED");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const signInLink = `/sign-in?next=${encodeURIComponent("/dashboard")}`;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <Link href="/" className="text-lg font-bold text-brand">OJAH</Link>
        <nav aria-label="Account navigation" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
          <Link className="underline-offset-4 hover:underline" href="/">Home</Link>
          <Link className="underline-offset-4 hover:underline" href="/#order">Errands</Link>
          <Link className="underline-offset-4 hover:underline" href="/orders">My orders</Link>
          <Link className="underline underline-offset-4" href="/dashboard">Profile</Link>
        </nav>
      </header>

      <section className="mt-8">
        <p className="text-sm font-semibold text-brand">Your account</p>
        <h1 className="mt-2 text-3xl font-semibold">One account, all your roles</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Your selected roles are shown here. Runner verification and business approval are separate steps.
        </p>

        {loading && <p className="mt-6 text-sm text-muted" role="status">Loading your account…</p>}
        {!loading && error === "AUTH_REQUIRED" && (
          <div className="mt-6 rounded-xl bg-warn-soft p-4 text-sm" role="alert">
            <p>Sign in to view your account roles.</p>
            <Link className="mt-2 inline-block font-semibold underline" href={signInLink}>Sign in</Link>
          </div>
        )}
        {!loading && error && error !== "AUTH_REQUIRED" && (
          <p className="mt-6 rounded-xl bg-warn-soft p-4 text-sm" role="alert">
            We couldn&apos;t load your account roles. Please refresh the page and try again.
          </p>
        )}
        {!loading && !error && roles.length === 0 && (
          <div className="mt-6 rounded-xl border border-line p-5">
            <p className="text-sm">Choose how you would like to use OJAH to finish setting up your account.</p>
            <Link className="mt-3 inline-block font-semibold text-brand underline" href="/onboarding/roles?next=%2Fdashboard">
              Choose account roles
            </Link>
          </div>
        )}
        {!loading && !error && roles.length > 0 && (
          <>
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Active account roles">
              {roles.map((role) => (
                <li className="rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand" key={role}>
                  {ROLE_LABEL[role]}
                </li>
              ))}
            </ul>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {roles.includes("customer") && (
                <section className="rounded-2xl border border-line bg-surface p-5">
                  <h2 className="text-xl font-semibold">Customer</h2>
                  <p className="mt-2 text-sm text-muted">Request an everyday errand or check your existing errand orders.</p>
                  <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold text-brand">
                    <Link className="underline" href="/#order">Request an errand</Link>
                    <Link className="underline" href="/orders">My orders</Link>
                  </div>
                </section>
              )}
              {roles.includes("runner") && (
                <section className="rounded-2xl border border-line bg-surface p-5">
                  <h2 className="text-xl font-semibold">Runner</h2>
                  <p className="mt-2 text-sm text-muted">
                    Runner access is available only after your application has been reviewed and verified.
                  </p>
                  <Link className="mt-4 inline-block text-sm font-semibold text-brand underline" href="/runner">
                    Runner workspace
                  </Link>
                </section>
              )}
              {roles.includes("business_owner") && (
                <section className="rounded-2xl border border-line bg-surface p-5">
                  <h2 className="text-xl font-semibold">Market/Business Owner</h2>
                  <p className="mt-2 text-sm text-muted">
                    Your role selection does not create or publish a store. Business registration and approval are separate steps.
                  </p>
                </section>
              )}
            </div>
            <Link
              className="mt-6 inline-block rounded-xl border border-line px-4 py-2 text-sm font-semibold"
              href="/onboarding/roles?next=%2Fdashboard"
            >
              Add another role
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
