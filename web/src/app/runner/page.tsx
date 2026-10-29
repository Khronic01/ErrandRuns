import type { Metadata } from "next";
import Link from "next/link";
import RunnerWorkspace from "@/components/runner-workspace";

export const metadata: Metadata = { title: "Runner" };

// Runner app (R1–R9). Next: sign-up with ID, selfie, guarantor and bank details;
// go online; job offers with a 45-second timer; step-by-step job screen; proof capture.
export default function RunnerHome() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <p className="text-sm font-semibold text-brand">Errand Runs · Runners</p>
      <h1 className="mt-4 text-2xl font-semibold">Steady, fair pay. No chasing jobs.</h1>
      <p className="mt-2 text-muted">
        See what you earn before you accept every job. Earnings are paid weekly by bank transfer, and you keep 100% of tips.
      </p>
      <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-semibold">What you need</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          <li>A smartphone, and a bike or the legs for walking jobs</li>
          <li>Government ID (NIN slip or other accepted ID) and a selfie</li>
          <li>One guarantor with ID and a phone number</li>
          <li>An in-person onboarding session and a trial job</li>
        </ul>
      </section>
      <Link className="mt-6 inline-block text-sm font-medium underline underline-offset-4" href="/sign-in?next=%2Frunner">
        Runner sign in
      </Link>
      <RunnerWorkspace />
    </main>
  );
}
