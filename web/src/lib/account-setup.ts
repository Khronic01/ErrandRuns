type DatabaseError = {
  code?: string;
  message?: string;
};

export function accountSetupError(
  stage: "profile" | "roles",
  error: DatabaseError,
) {
  if (
    stage === "profile" &&
    error.code === "23502" &&
    /phone/i.test(error.message ?? "")
  ) {
    return "ACCOUNT_PROFILE_MIGRATION_REQUIRED";
  }

  if (
    stage === "roles" &&
    (error.code === "42P01" || error.code === "PGRST205")
  ) {
    return "ACCOUNT_ROLES_MIGRATION_REQUIRED";
  }

  return null;
}
