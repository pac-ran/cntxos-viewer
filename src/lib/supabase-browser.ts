import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _browser: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (!_browser) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    _browser = createClient(url, key);
  }
  return _browser;
}
