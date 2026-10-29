import type { Metadata } from "next";
import Link from "next/link";
import OpsWorkspace from "@/components/ops-workspace";

export const metadata: Metadata = { title: "Ops console", robots: { index: false } };

// Ops console (O1–O10). Every action calls an order-engine function that checks the
// staff role, needs a reason, and writes to the audit log.
const PANELS = [
  ["Live board", "Active jobs by status with time-rule alerts (ops_alerts)."],
  ["Live map", "Online runners and active jobs."],
  ["Dispatch", "Suggested runner per job (suggest_runners), offer or assign with a reason."],
  ["WhatsApp intake", "Create orders on a customer's behalf (create_job with customer_id)."],
  ["Runner queue", "Review, verify and suspend runners (ops_set_runner_status)."],
  ["Zones & prices", "Switch zones on/off; edit a draft price table and publish it as a new version."],
];

export default function OpsHome() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <p className="text-sm font-semibold text-brand">Errand Runs · Ops</p>
      <h1 className="mt-2 text-2xl font-semibold">Control room</h1>
      <Link className="mt-2 inline-block text-sm underline underline-offset-4" href="/sign-in?next=%2Fops">
        Staff sign in
      </Link>
      <OpsWorkspace />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PANELS.map(([title, body]) => (
          <section key={title} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
