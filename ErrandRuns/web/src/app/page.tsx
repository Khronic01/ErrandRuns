import Link from "next/link";
import { TASKS, type TaskType } from "@/lib/jobs";

const RUN_TASKS: TaskType[] = ["buy_and_bring", "collect", "drop_and_submit", "queue_and_wait", "multi_stop"];

const STEPS = [
  ["Describe it", "Pick Run or Send, the task, and drop a pin with a landmark."],
  ["Get a fixed price", "See the price instantly, with what could add to it."],
  ["Pay upfront", "Card, bank transfer or USSD. Buying budgets are paid at the same time."],
  ["Watch it move", "Your runner's name, photo and live position. Recipients get a tracking link."],
  ["Confirm and rate", "The handover code closes the job, and you get a receipt."],
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16">
      <header className="flex items-center justify-between py-5">
        <span className="text-lg font-semibold tracking-tight">Errand Runs</span>
        <div className="flex items-center gap-3">
          <Link className="text-sm underline underline-offset-4" href="/sign-in">Sign in</Link>
          <Link className="text-sm underline underline-offset-4" href="/orders">My orders</Link>
          <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">Lagos pilot</span>
        </div>
      </header>

      <section className="py-8">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Tell us what needs doing. Pay one price. Watch it get done.
        </h1>
        <p className="mt-3 max-w-xl text-muted">
          A verified runner handles the errand or delivery while you get on with your day.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-xl font-semibold">Run</h2>
          <p className="mt-1 text-sm text-muted">A runner does a task for you.</p>
          <ul className="mt-4 space-y-3">
            {RUN_TASKS.map((t) => (
              <li key={t}>
                <p className="font-medium">{TASKS[t].title}</p>
                <p className="text-sm text-muted">{TASKS[t].example}</p>
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-xl font-semibold">Send</h2>
          <p className="mt-1 text-sm text-muted">You have the item; we move it from A to B.</p>
          <ul className="mt-4 space-y-3 text-sm">
            <li>Envelope, small bag or medium box</li>
            <li>Recipient gets a tracking link by SMS</li>
            <li>Photo proof and a recipient code at handover</li>
          </ul>
        </article>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">How it works</h2>
        <ol className="mt-4 space-y-4">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-ink">
                {i + 1}
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-sm text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-12 flex flex-wrap gap-4 border-t border-line pt-6 text-sm text-muted">
        <span>Yaba · Surulere · Ebute Metta · Ikeja GRA</span>
        <Link href="/runner" className="underline underline-offset-4">Run with us</Link>
      </footer>
    </main>
  );
}
