import { describe, expect, it } from "vitest";
import { accountSetupError } from "./account-setup";

describe("accountSetupError", () => {
  it("identifies the missing phone-column migration", () => {
    expect(
      accountSetupError("profile", {
        code: "23502",
        message: 'null value in column "phone" violates not-null constraint',
      }),
    ).toBe("ACCOUNT_PROFILE_MIGRATION_REQUIRED");
  });

  it("identifies a missing roles table", () => {
    expect(accountSetupError("roles", { code: "PGRST205", message: "Not found" })).toBe(
      "ACCOUNT_ROLES_MIGRATION_REQUIRED",
    );
  });

  it("leaves unrelated database errors to normal error handling", () => {
    expect(accountSetupError("roles", { code: "42501", message: "Forbidden" })).toBeNull();
    expect(accountSetupError("profile", { code: "23502", message: "full_name" })).toBeNull();
  });
});
