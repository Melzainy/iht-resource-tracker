// Resource Tracker data-layer selection.
//   local    → seed adapter, data stays in this browser (default)
//   supabase → shared live database; needs the project URL + the browser-safe PUBLISHABLE key
// Values come from window.RT_CONFIG, which scripts/build.mjs writes from .env.local (never committed).
// A secret / service_role key is refused here AND at build time.
const W = typeof window !== 'undefined' ? window.RT_CONFIG || {} : {};

export function keyProblem(key) {
  if (!key) return 'No Supabase key configured.';
  if (/^sb_secret_/i.test(key)) return 'This is a SECRET key. Only the publishable key may be used in the browser.';
  if (key.split('.').length === 3) { // legacy JWT key: must be the anon role
    try { const p = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (p.role !== 'anon') return `This key has role "${p.role}". Only the anon / publishable key may be used in the browser.`; } catch (e) { return 'The Supabase key could not be read.'; }
    return null;
  }
  if (!/^sb_publishable_/.test(key)) return 'Unrecognised key. Use the project\'s publishable key (starts with sb_publishable_).';
  return null;
}

export const RT_CONFIG = {
  backend: W.backend === 'supabase' ? 'supabase' : 'local',
  supabaseUrl: W.supabaseUrl || null,
  supabasePublishableKey: W.supabasePublishableKey || null,
};
