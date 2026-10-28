import { createClient } from "@supabase/supabase-js";

const storageKey = "dcp-google-auth";
const verifierKey = `${storageKey}-code-verifier`;

// Supabase's PKCE storage is request-local. Only the verifier travels in a
// short-lived HttpOnly cookie; sessions/provider tokens never go to localStorage.
export function googleOAuthClient(url: string, key: string, verifier?: string, fetcher: typeof fetch = fetch) {
  const values = new Map<string, string>();
  if (verifier) values.set(verifierKey, JSON.stringify(verifier));
  const client = createClient(url, key, {
    global: { fetch: fetcher },
    auth: {
      flowType: "pkce", storageKey, persistSession: true,
      autoRefreshToken: false, detectSessionInUrl: false,
      storage: {
        getItem: (name) => values.get(name) ?? null,
        setItem: (name, value) => { values.set(name, value); },
        removeItem: (name) => { values.delete(name); }
      }
    }
  });
  return { client, getVerifier: () => {
    const stored = values.get(verifierKey);
    return stored ? JSON.parse(stored) as string : null;
  } };
}
