import { describe, expect, it } from "vitest";
import { parseAccountRoles } from "./roles";

describe("parseAccountRoles", () => {
  it("accepts each supported account role", () => {
    expect(parseAccountRoles(["customer", "runner", "business_owner"])).toEqual([
      "customer",
      "runner",
      "business_owner",
    ]);
  });

  it("removes duplicate selections", () => {
    expect(parseAccountRoles(["runner", "runner"])).toEqual(["runner"]);
  });

  it.each([null, "runner", [], ["admin"], ["customer", "admin"], ["runner", "runner", "runner", "runner"]])(
    "rejects invalid role selections: %j",
    (input) => {
      expect(parseAccountRoles(input)).toBeNull();
    },
  );
});
