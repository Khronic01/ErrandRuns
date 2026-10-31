// Shared vocabulary for the order engine. The database is the source of truth for
// which moves are allowed; this file only names things for the screens.

export type JobStatus =
  | "quoted" | "paid" | "assigned" | "picked_up" | "on_the_way" | "completed"
  | "needs_ops" | "customer_approval" | "cancelled" | "failed";

export type TaskType =
  | "buy_and_bring" | "collect" | "drop_and_submit" | "queue_and_wait" | "multi_stop" | "send";

export const STATUS_LABEL: Record<JobStatus, string> = {
  quoted: "Awaiting payment",
  paid: "Finding your runner",
  assigned: "Runner on the way to pickup",
  picked_up: "Picked up",
  on_the_way: "On the way to you",
  completed: "Completed",
  needs_ops: "Our team is on it",
  customer_approval: "Needs your approval",
  cancelled: "Cancelled",
  failed: "Could not be completed",
};

/** The main path a job walks, in order (PRD order lifecycle). */
export const MAIN_PATH: JobStatus[] = ["paid", "assigned", "picked_up", "on_the_way", "completed"];

export const TASKS: Record<TaskType, { title: string; example: string; proof: string }> = {
  buy_and_bring:   { title: "Buy & bring",   example: "Groceries from a named store",     proof: "Receipt photo + handover code" },
  collect:         { title: "Collect",       example: "Clothes from the dry cleaner",     proof: "Item photo + handover code" },
  drop_and_submit: { title: "Drop & submit", example: "Submit a form at an office",       proof: "Stamped copy or photo" },
  queue_and_wait:  { title: "Queue & wait",  example: "Wait in line at a bank",           proof: "Timestamped photos" },
  multi_stop:      { title: "Multi-stop",    example: "Pickup, then a store, then home",  proof: "Proof at every stop" },
  send:            { title: "Send",          example: "Move a parcel from A to B",        proof: "Photo + recipient code" },
};

/** Database error codes raised by the order engine, in words a customer can act on. */
export const ERROR_MESSAGE: Record<string, string> = {
  OUTSIDE_ZONE: "That address is outside our current service area. Join the waitlist and we'll tell you when we reach you.",
  PROHIBITED_ITEM: "We can't carry out this request.",
  ITEM_VALUE_CAP: "Items are capped at ₦100,000 per job during the pilot.",
  STOPS_INVALID: "Check the stops for this task.",
  NO_FARE: "We can't price this route yet. Our team will get back to you.",
  CONTACT_SUPPORT: "Your runner has already picked up. Contact support to cancel.",
  OTP_INVALID: "That handover code doesn't match.",
};

export function engineError(err: { message?: string } | null | undefined): string {
  const code = err?.message?.split(/\s/)[0] ?? "";
  return ERROR_MESSAGE[code] ?? "Something went wrong. Please try again.";
}
