"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/** Supabase client for Client Components (customer, runner and ops screens). */
export function supabaseBrowser() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key);
}
