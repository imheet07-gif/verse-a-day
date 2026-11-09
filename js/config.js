// Sync configuration. Both values ship empty: while they are empty the app
// behaves exactly like phase 1 (device only) and the Supabase library is never
// loaded. Only the PUBLIC anon key belongs here. Never a service-role key.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
export const syncConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
