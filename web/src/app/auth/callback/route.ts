import { NextResponse } from "next/server";
import { ensureAccountProfile } from "@/lib/account-profile";
import { supabaseServer } from "@/lib/supabase/server";

function safeNextPath(request: Request, requested: string | null) {
  if (!requested) return "/dashboard";
  const destination = new URL(requested, request.url);
  return destination.origin === new URL(request.url).origin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/dashboard";
}

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = safeNextPath(request, url.searchParams.get("next"));

  if (!code) return redirectTo(request, "/sign-in?error=oauth");

  const client = await supabaseServer();
  const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    console.error("Supabase OAuth callback failed", exchangeError);
    return redirectTo(request, "/sign-in?error=oauth");
  }

  const { data: userData, error: userError } = await client.auth.getUser();
  const user = userData.user;
  if (userError || !user?.email) {
    console.error("OAuth callback returned no verified email account", userError);
    return redirectTo(request, "/sign-in?error=oauth");
  }

  const { error: profileError } = await ensureAccountProfile(client, user);
  if (profileError) {
    console.error("Could not save profile after auth callback", profileError);
    return redirectTo(request, "/sign-in?error=profile");
  }

  const { data: roles, error: rolesError } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (rolesError) {
    console.error("Could not load roles after OAuth callback", rolesError);
    return redirectTo(request, "/sign-in?error=roles");
  }

  if (roles.length === 0) {
    return redirectTo(
      request,
      `/onboarding/roles?next=${encodeURIComponent(nextPath)}`,
    );
  }
  return redirectTo(request, nextPath);
}
