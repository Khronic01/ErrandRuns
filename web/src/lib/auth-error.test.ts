import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-error";

describe("authErrorMessage", () => {
  it("explains Supabase email-send rate limiting and recovery", () => {
    expect(authErrorMessage({ message: "email rate limit exceeded" })).toContain(
      "temporarily rate-limited confirmation emails",
    );
    expect(authErrorMessage({ code: "over_email_send_rate_limit", message: "Too many requests" })).toContain(
      "custom SMTP provider",
    );
  });

  it("gives a recovery path for unconfirmed email accounts", () => {
    expect(authErrorMessage({ code: "email_not_confirmed", message: "Email not confirmed" })).toBe(
      "Confirm your email address before signing in.",
    );
  });

  it("identifies unavailable Google provider setup", () => {
    expect(authErrorMessage({ message: "Unsupported provider: provider is not enabled" })).toContain(
      "Google sign-in is not configured",
    );
  });
});
