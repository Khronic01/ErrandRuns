import { Suspense } from "react";
import type { Metadata } from "next";
import { supabasePublic } from "@/lib/supabase/server";
import { MAIN_PATH, STATUS_LABEL, type JobStatus } from "@/lib/jobs";

export const metadata: Metadata = { title: "Track your delivery", robots: { index: false } };

type Tracking = {
  ref: string;
  status: JobStatus;
  promised_by: string | null;
  runner: { first_name: string; vehicle: string; plate: string | null } | null;
  position: { lat: number; lng: number; at: string } | null;
  dropoff: { address: string; landmark: string | null } | null;
  timeline: { status: JobStatus; at: string }[];
};

const time = new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

// C6: the shareable link a recipient gets by SMS. No login, no phone numbers.
export default function TrackPage({ params }: PageProps<"/track/[token]">) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <p className="text-sm font-semibold text-brand">OJAH · Every Market, One Place.</p>
      <Suspense fallback={<p className="mt-6 text-muted">Loading your delivery…</p>}>
        <TrackingCard params={params} />
      </Suspense>
    </main>
  );
}

async function TrackingCard({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data, error } = await supabasePublic().rpc("get_tracking", { p_token: token });
  const t = data as Tracking | null;

  if (error || !t) {
    return (
      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h1 className="text-xl font-semibold">Link not found</h1>
        <p className="mt-2 text-sm text-muted">Check the link in your SMS, or ask the sender to share it again.</p>
      </div>
    );
  }

  const reached = new Map(t.timeline.map((e) => [e.status, e.at]));
  const onHold = t.status === "needs_ops" || t.status === "customer_approval";

  return (
    <div className="mt-6 space-y-4">
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-xs uppercase tracking-wide text-muted">Job {t.ref}</p>
        <h1 className={`mt-1 text-2xl font-semibold ${onHold ? "text-warn" : ""}`}>{STATUS_LABEL[t.status]}</h1>
        {t.promised_by && t.status !== "completed" && (
          <p className="mt-1 text-sm text-muted">Expected by {time.format(new Date(t.promised_by))}</p>
        )}
        {t.runner && (
          <p className="mt-4 text-sm">
            <span className="font-medium">{t.runner.first_name}</span>
            <span className="text-muted"> · {t.runner.vehicle === "bike" ? "on a bike" : "on foot"}{t.runner.plate ? ` · ${t.runner.plate}` : ""}</span>
          </p>
        )}
        {t.dropoff && (
          <p className="mt-2 text-sm text-muted">
            To {t.dropoff.address}{t.dropoff.landmark ? ` (${t.dropoff.landmark})` : ""}
          </p>
        )}
      </section>

      <ol className="rounded-2xl border border-line bg-surface p-5">
        {MAIN_PATH.map((s) => {
          const at = reached.get(s);
          return (
            <li key={s} className="flex items-center gap-3 py-2">
              <span className={`size-3 rounded-full ${at ? "bg-brand" : "border border-line"}`} />
              <span className={at ? "" : "text-muted"}>{STATUS_LABEL[s]}</span>
              {at && <span className="ml-auto text-sm text-muted">{time.format(new Date(at))}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
