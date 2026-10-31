"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { ERROR_MESSAGE, STATUS_LABEL, type JobStatus } from "@/lib/jobs";
import { formatNaira } from "@/lib/money";

type Job = {
  id: string;
  ref: string;
  task_type: string;
  status: JobStatus;
  price_kobo: number;
  created_at: string;
  promised_by: string | null;
};

export default function CustomerOrders() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const nextJobs = await apiRequest<Job[]>("/api/jobs");
      setError("");
      setJobs(nextJobs);
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : "REQUEST_FAILED";
      setError(
        code === "AUTH_REQUIRED"
          ? "Sign in to see your orders."
          : code === "SUPABASE_NOT_CONFIGURED"
            ? "Order services are not configured yet."
            : ERROR_MESSAGE[code] ?? code,
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const nextJobs = await apiRequest<Job[]>("/api/jobs");
        if (!active) return;
        setError("");
        setJobs(nextJobs);
      } catch (requestError) {
        if (!active) return;
        const code = requestError instanceof Error ? requestError.message : "REQUEST_FAILED";
        setError(
          code === "AUTH_REQUIRED"
            ? "Sign in to see your orders."
            : code === "SUPABASE_NOT_CONFIGURED"
              ? "Order services are not configured yet."
              : ERROR_MESSAGE[code] ?? code,
        );
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm font-semibold text-brand">OJAH</Link>
      <h1 className="mt-5 text-2xl font-semibold">Your orders</h1>
      {error && (
        <div className="mt-4 rounded-xl bg-warn-soft p-4 text-sm" role="alert">
          <p>{error}</p>
          {error === "Sign in to see your orders." && <Link className="mt-2 inline-block underline" href="/sign-in?next=%2Forders">Sign in</Link>}
        </div>
      )}
      {!error && jobs.length === 0 && <p className="mt-3 text-sm text-muted">No orders to show yet.</p>}
      <ul className="mt-5 space-y-3">
        {jobs.map((job) => (
          <li className="rounded-2xl border border-line bg-surface p-4" key={job.id}>
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-semibold">{job.ref} · {job.task_type.replaceAll("_", " ")}</span>
              <span className="text-sm">{STATUS_LABEL[job.status]}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{formatNaira(job.price_kobo)} · {new Date(job.created_at).toLocaleDateString()}</p>
          </li>
        ))}
      </ul>
      <button className="mt-5 text-sm underline underline-offset-4" onClick={() => void refresh()}>Refresh orders</button>
    </main>
  );
}
