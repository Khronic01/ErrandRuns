"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { formatNaira } from "@/lib/money";

type RunnerProfile = { full_name: string; status: string; online: boolean; vehicle: string };
type Offer = { id: string; job_id: string; earnings_kobo: number; expires_at: string; job: { ref: string; task_type: string } | null };
type Job = { id: string; ref: string; task_type: string; status: string };

function messageFor(error: unknown) {
  const code = error instanceof Error ? error.message : "REQUEST_FAILED";
  if (code === "AUTH_REQUIRED") return "Sign in with the email address on your runner account.";
  if (code === "FORBIDDEN" || code === "NOT_A_RUNNER") return "This account doesn't have runner access.";
  if (code === "RUNNER_PROFILE_NOT_FOUND") return "Your runner profile has not been set up yet.";
  if (code === "SUPABASE_NOT_CONFIGURED") return "Order services are not configured yet.";
  return code;
}

export default function RunnerWorkspace() {
  const [profile, setProfile] = useState<RunnerProfile | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextProfile, nextOffers, nextJobs] = await Promise.all([
        apiRequest<RunnerProfile>("/api/runner/profile"),
        apiRequest<Offer[]>("/api/runner/offers"),
        apiRequest<Job[]>("/api/runner/jobs"),
      ]);
      setError("");
      setProfile(nextProfile);
      setOffers(nextOffers);
      setJobs(nextJobs);
    } catch (requestError) {
      setError(messageFor(requestError));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [nextProfile, nextOffers, nextJobs] = await Promise.all([
          apiRequest<RunnerProfile>("/api/runner/profile"),
          apiRequest<Offer[]>("/api/runner/offers"),
          apiRequest<Job[]>("/api/runner/jobs"),
        ]);
        if (!active) return;
        setError("");
        setProfile(nextProfile);
        setOffers(nextOffers);
        setJobs(nextJobs);
      } catch (requestError) {
        if (active) setError(messageFor(requestError));
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  async function act(path: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(path, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface p-5" aria-labelledby="runner-workspace-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="runner-workspace-title" className="text-xl font-semibold">Runner workspace</h2>
        <button className="rounded-xl border border-line px-3 py-2 text-sm" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {error && (
        <div className="mt-4 rounded-xl bg-warn-soft p-3 text-sm" role="alert">
          <p>{error}</p>
          {error.startsWith("Sign in") && <Link className="mt-1 inline-block underline" href="/sign-in?next=%2Frunner">Sign in</Link>}
        </div>
      )}
      {profile && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{profile.full_name} · {profile.status} · {profile.vehicle}</p>
          <button
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-ink disabled:opacity-60"
            disabled={busy || profile.status !== "verified"}
            onClick={() => void act("/api/runner/online", { online: !profile.online })}
          >
            {profile.online ? "Go offline" : "Go online"}
          </button>
        </div>
      )}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="font-semibold">Offers</h3>
          {offers.length === 0 ? <p className="mt-2 text-sm text-muted">No pending offers.</p> : (
            <ul className="mt-2 space-y-3">
              {offers.map((offer) => (
                <li className="rounded-xl border border-line p-3" key={offer.id}>
                  <p className="text-sm">{offer.job?.ref ?? offer.job_id.slice(0, 8)} · {offer.job?.task_type.replaceAll("_", " ") ?? "Job"} · {formatNaira(offer.earnings_kobo)}</p>
                  <p className="mt-1 text-xs text-muted">Respond before {new Date(offer.expires_at).toLocaleTimeString()}</p>
                  <div className="mt-2 flex gap-2">
                    <button className="rounded-lg bg-brand px-3 py-1 text-sm text-brand-ink disabled:opacity-60" disabled={busy} onClick={() => void act(`/api/runner/offers/${offer.id}`, { accept: true })}>Accept</button>
                    <button className="rounded-lg border border-line px-3 py-1 text-sm disabled:opacity-60" disabled={busy} onClick={() => void act(`/api/runner/offers/${offer.id}`, { accept: false })}>Decline</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="font-semibold">Active jobs</h3>
          {jobs.length === 0 ? <p className="mt-2 text-sm text-muted">No active jobs.</p> : (
            <ul className="mt-2 space-y-2">
              {jobs.map((job) => (
                <li className="rounded-xl border border-line p-3 text-sm" key={job.id}>
                  <p className="font-medium">{job.ref} · {job.task_type.replaceAll("_", " ")}</p>
                  <p className="text-muted">{job.status.replaceAll("_", " ")}</p>
                  {job.status === "assigned" && (
                    <button className="mt-2 rounded-lg border border-line px-3 py-1 disabled:opacity-60" disabled={busy} onClick={() => void act(`/api/runner/jobs/${job.id}/transition`, { to: "picked_up" })}>Mark picked up</button>
                  )}
                  {job.status === "picked_up" && (
                    <button className="mt-2 rounded-lg border border-line px-3 py-1 disabled:opacity-60" disabled={busy} onClick={() => void act(`/api/runner/jobs/${job.id}/transition`, { to: "on_the_way" })}>Start delivery</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
