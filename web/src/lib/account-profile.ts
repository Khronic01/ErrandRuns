import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function ensureAccountProfile(client: SupabaseClient, user: User) {
  if (!user.email) {
    return {
      data: null,
      error: { code: "AUTH_EMAIL_REQUIRED", message: "The signed-in account must have an email address." },
    };
  }

  const { error: insertError } = await client.from("profiles").upsert(
    { id: user.id, email: user.email },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (insertError) return { data: null, error: insertError };

  const { data, error } = await client
    .from("profiles")
    .update({ email: user.email })
    .eq("id", user.id)
    .select("id,email,full_name")
    .single();
  return { data, error };
}
