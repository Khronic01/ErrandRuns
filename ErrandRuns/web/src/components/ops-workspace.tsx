"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { formatNaira } from "@/lib/money";

type Alert = { job_id: string; ref: string; status: string; alert: string; since: string };
type Job = { id: string; ref: string; task_type: string; status: string; price_kobo: number; runner_id: string | null };
type Runner = { user_id: string; full_name: string; status: string; online: boolean; vehicle: string };
type Suggestion = { runner_id: string; full_name: string; vehicle: string; distance_m: number };

function messageFor(error: unknown) {
  const code = error instanceof Error ? error.message : "REQUEST_FAILED";
  if (code === "AUTH_REQUIRED") return "Sign in with an authorized staff account.";
  if (code === "FORBIDDEN") return "This account doesn't have ops access.";
  if (code === "SUPABASE_NOT_CONFIGURED") return "Order services are not configured yet.";
  return code;
}

export default function OpsWorkspace() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion[]>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextAlerts, nextJobs, nextRunners] = await Promise.all([
        apiRequest<Alert[]>("/api/ops/alerts"),
        apiRequest<Job[]>("/api/ops/jobs"),
        apiRequest<Runner[]>("/api/ops/runners"),
      ]);
      setError("");
      setAlerts(nextAlerts);
      setJobs(nextJobs);
      setRunners(nextRunners);
    } catch (requestError) {
      setError(messageFor(requestError));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [nextAlerts, nextJobs, nextRunners] = await Promise.all([
          apiRequest<Alert[]>("/api/ops/alerts"),
          apiRequest<Job[]>("/api/ops/jobs"),
          apiRequest<Runner[]>("/api/ops/runners"),
        ]);
        if (!active) return;
        setError("");
        setAlerts(nextAlerts);
        setJobs(nextJobs);
        setRunners(nextRunners);
      } catch (requestError) {
        if (active) setError(messageFor(requestError));
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  async function loadSuggestions(jobId: string) {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<Suggestion[]>(`/api/ops/jobs/${jobId}/suggestions`);
      setSuggestions((current) => ({ ...current, [jobId]: result }));
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function dispatch(jobId: string, runnerId: string, mode: "offer" | "assign") {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/api/ops/jobs/${jobId}/dispatch`, {
        method: "POST",
        body: JSON.stringify({ runner_id: runnerId, mode, ...(mode === "assign" ? { reason: reasons[jobId] ?? "" } : {}) }),
      });
      await refresh();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface p-5" aria-labelledby="ops-workspace-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ops-workspace-title" className="text-xl font-semibold">Live operations</h2>
        <button className="rounded-xl border border-line px-3 py-2 text-sm" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {error && (
        <div className="mt-4 rounded-xl bg-warn-soft p-3 text-sm" role="alert">
          <p>{error}</p>
          {error.startsWith("Sign in") && <Link className="mt-1 inline-block underline" href="/sign-in?next=%2Fops">Staff sign in</Link>}
        </div>
      )}
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="font-semibold">Alerts</h3>
          {alerts.length === 0 ? <p className="mt-2 text-sm text-muted">No active alerts.</p> : (
            <ul className="mt-2 space-y-2">
              {alerts.map((alert) => <li className="rounded-xl border border-line p-3 text-sm" key={`${alert.job_id}-${alert.alert}`}>{alert.ref}: {alert.alert}</li>)}
            </ul>
          )}
        </div>
        <div>
          <h3 className="font-semibold">Runner availability</h3>
          <p className="mt-2 text-sm text-muted">{runners.filter((runner) => runner.online && runner.status === "verified").length} verified runners online</p>
        </div>
      </div>
      <div className="mt-6">
        <h3 className="font-semibold">Active jobs</h3>
        {jobs.length === 0 ? <p className="mt-2 text-sm text-muted">No active jobs.</p> : (
          <ul className="mt-2 space-y-3">
            {jobs.map((job) => (
              <li className="rounded-xl border border-line p-3" key={job.id}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{job.ref} · {job.task_type.replaceAll("_", " ")}</span>
                  <span>{job.status.replaceAll("_", " ")} · {formatNaira(job.price_kobo)}</span>
                </div>
                {["paid", "needs_ops"].includes(job.status) && (
                  <>
                    <button className="mt-2 rounded-lg border border-line px-3 py-1 text-sm disabled:opacity-60" disabled={busy} onClick={() => void loadSuggestions(job.id)}>Suggest runners</button>
                    {suggestions[job.id]?.map((runner) => (
                      <div className="mt-2 rounded-lg bg-brand-soft p-3 text-sm" key={runner.runner_id}>
                        <p>{runner.full_name} · {runner.vehicle} · {Math.round(runner.distance_m)} m</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button className="rounded-lg bg-brand px-3 py-1 text-brand-ink disabled:opacity-60" disabled={busy} onClick={() => void dispatch(job.id, runner.runner_id, "offer")}>Send 45s offer</button>
                          <button className="rounded-lg border border-line px-3 py-1 disabled:opacity-60" disabled={busy || !(reasons[job.id] ?? "").trim()} onClick={() => void dispatch(job.id, runner.runner_id, "assign")}>Assign directly</button>
                        </div>
                      </div>
                    ))}
                    <label className="mt-2 block text-xs text-muted" htmlFor={`reason-${job.id}`}>Reason for direct assignment</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                      id={`reason-${job.id}`}
                      onChange={(event) => setReasons((current) => ({ ...current, [job.id]: event.target.value }))}
                      value={reasons[job.id] ?? ""}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
