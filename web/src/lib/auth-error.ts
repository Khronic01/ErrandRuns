type AuthFailure = {
  code?: string;
  message: string;
};

export function authErrorMessage(error: AuthFailure) {
  if (
    error.code === "over_email_send_rate_limit" ||
    /email rate limit exceeded|over_email_send_rate_limit/i.test(error.message)
  ) {
    return "Supabase has temporarily rate-limited confirmation emails. Wait before retrying. If your account was created, switch to Sign in and request a confirmation email later. For production signup, configure a custom SMTP provider in Supabase Auth.";
  }
  if (error.message === "ACCOUNT_PROFILE_MIGRATION_REQUIRED") {
    return "Email accounts need the OJAH email-auth database migration before sign-in can finish. Please contact the OJAH team.";
  }
  if (error.message === "ACCOUNT_ROLES_MIGRATION_REQUIRED") {
    return "Account onboarding needs the OJAH roles database migration before sign-in can finish. Please contact the OJAH team.";
  }
  if (error.code === "email_not_confirmed") return "Confirm your email address before signing in.";
  if (error.code === "invalid_credentials") return "Email or password is incorrect.";
  if (error.code === "user_already_exists") return "An account with this email already exists. Sign in instead.";
  if (error.code === "weak_password") return "Choose a stronger password with at least 8 characters.";
  if (/failed to fetch|fetch failed|networkerror|load failed|econnrefused|enotfound/i.test(error.message)) {
    return "OJAH couldn't reach the authentication service. Check your connection and try again.";
  }
  if (/provider.*not enabled|unsupported provider/i.test(error.message)) {
    return "Google sign-in is not configured for OJAH yet. Use email and password for now.";
  }
  return error.message;
}
