export const ACCOUNT_ROLES = ["customer", "runner", "business_owner"] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export function isAccountRole(value: unknown): value is AccountRole {
  return ACCOUNT_ROLES.some((role) => role === value);
}

export function parseAccountRoles(value: unknown): AccountRole[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > ACCOUNT_ROLES.length) {
    return null;
  }
  if (!value.every(isAccountRole)) return null;
  return [...new Set(value)];
}
