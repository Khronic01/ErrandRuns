"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api-client";
import { type AccountRole, isAccountRole } from "@/lib/roles";

const ROLE_OPTIONS: { role: AccountRole; title: string; description: string }[] = [
  {
    role: "customer",
    title: "Customer",
    description: "Shop local and request shopping, delivery and everyday errands.",
  },
  {
    role: "runner",
    title: "Runner",
    description: "Apply to fulfil errands and delivery requests as an independent runner.",
  },
  {
    role: "business_owner",
    title: "Market/Business Owner",
    description: "Prepare to register a business and list products on the marketplace.",
  },
];

function returnPath() {
  const requested = new URLSearchParams(window.location.search).get("next");
  if (!requested) return "/dashboard";
  const destination = new URL(requested, window.location.origin);
  return destination.origin === window.location.origin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/dashboard";
}

function validRoleList(value: unknown): AccountRole[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isAccountRole);
}

function messageFor(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "AUTH_REQUIRED") return "Sign in with your email to choose account roles.";
  if (code === "SUPABASE_NOT_CONFIGURED") return "Account services are not configured yet.";
  if (code === "FORBIDDEN") return "This account cannot change roles.";
  return "We couldn't save your account roles. Please try again.";
}

export default function RoleSelection() {
  const router = useRouter();
  const [existingRoles, setExistingRoles] = useState<AccountRole[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<AccountRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest<AccountRole[]>("/api/account/roles")
      .then((roles) => {
        if (!active) return;
        const validRoles = validRoleList(roles);
        setExistingRoles(validRoles);
        setSelectedRoles(validRoles);
      })
      .catch((requestError: unknown) => {
        if (active) {
          setLoadError(requestError instanceof Error ? requestError.message : "REQUEST_FAILED");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function toggleRole(role: AccountRole) {
    if (existingRoles.includes(role)) return;
    setSelectedRoles((roles) =>
      roles.includes(role) ? roles.filter((selected) => selected !== role) : [...roles, role],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedRoles.length === 0) {
      setError("Choose at least one account type to continue.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const savedRoles = await apiRequest<AccountRole[]>("/api/account/roles", {
        method: "POST",
        body: JSON.stringify({ roles: selectedRoles }),
      });
      setSelectedRoles(validRoleList(savedRoles));
      router.replace(returnPath());
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/" className="text-sm font-semibold text-brand">Errand Runs</Link>
      <section className="mt-6 rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <p className="text-sm font-semibold text-muted">One account, more ways to take part</p>
        <h1 className="mt-2 text-3xl font-semibold">How would you like to use Errand Runs?</h1>
        <p className="mt-3 text-sm text-muted">
          Select one or more account types. You can add another role later without creating a second account.
        </p>

        {loading ? (
          <p className="mt-6 text-sm text-muted" role="status">Loading your account roles…</p>
        ) : loadError === "AUTH_REQUIRED" ? (
          <div className="mt-6 rounded-xl bg-warn-soft p-4 text-sm" role="alert">
            <p>Sign in with your email to choose account roles.</p>
            <Link className="mt-2 inline-block font-semibold underline" href="/sign-in?next=%2Fonboarding%2Froles">
              Sign in
            </Link>
          </div>
        ) : loadError ? (
          <p className="mt-6 rounded-xl bg-warn-soft p-4 text-sm" role="alert">
            We couldn&apos;t load your account roles. Please refresh the page and try again.
          </p>
        ) : (
          <form className="mt-6 space-y-3" onSubmit={submit}>
            {ROLE_OPTIONS.map(({ role, title, description }) => {
              const active = selectedRoles.includes(role);
              const alreadySelected = existingRoles.includes(role);
              return (
                <label
                  className={`flex cursor-pointer gap-4 rounded-xl border p-4 ${
                    active ? "border-brand bg-brand-soft" : "border-line"
                  } ${alreadySelected ? "cursor-default" : ""}`}
                  key={role}
                >
                  <input
                    checked={active}
                    className="mt-1 size-4 accent-brand"
                    disabled={loading || busy || alreadySelected}
                    onChange={() => toggleRole(role)}
                    type="checkbox"
                    value={role}
                  />
                  <span>
                    <span className="block font-semibold">{title}</span>
                    <span className="mt-1 block text-sm text-muted">{description}</span>
                    {alreadySelected && (
                      <span className="mt-2 block text-xs font-semibold text-brand">Already selected</span>
                    )}
                  </span>
                </label>
              );
            })}

            <p className="rounded-xl bg-brand-soft p-4 text-sm text-muted">
              Selecting Runner does not verify an application, and selecting Market/Business Owner does not approve or publish a store. Those require separate review.
            </p>
            {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
            <button
              className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-brand-ink disabled:opacity-60"
              disabled={busy || selectedRoles.length === 0}
              type="submit"
            >
              {busy ? "Saving roles…" : existingRoles.length > 0 ? "Add selected roles" : "Continue"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
