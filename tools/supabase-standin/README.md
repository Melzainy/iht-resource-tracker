# Local Supabase stand-in (TEST ONLY)

Used to test the live Resource Tracker when supabase.co cannot be reached (for example from a sandbox without internet).
It is not part of the app and is never deployed.

**What it runs:**

- **Database:** a real PostgreSQL 16 on port 54329 with database `rt`.
  - `reset.sh` creates Supabase's `anon`/`authenticated` roles and the `supabase_realtime` publication.
  - It then applies the real `supabase/rt_schema.sql`, `rt_seed.sql` and `rt_verify.sql`.
- **`server.mjs`:** speaks the subset of PostgREST and Realtime (Phoenix vsn 2.0.0) that `@supabase/supabase-js` uses.
  - It runs every request as role `anon`, so the real grants, RLS and constraints apply.
  - Changes are fed by a test-only NOTIFY trigger.

**How to use it:**

```
cd tools/supabase-standin && npm i --no-save pg@8.13.1 ws@8.18.0
./reset.sh && node server.mjs                       # http://localhost:54321, key sb_publishable_LOCALTEST
RT_BACKEND=supabase RT_SUPABASE_URL=http://localhost:54321 RT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_LOCALTEST npm run build
node tests/rt-live-two-browser.cjs <url of the served dist>   # two isolated browsers, shared database
```

**What it does not test:** the real Supabase network, Supabase's own Realtime server and its 24-hour limit on public connections. Repeat the two-browser checklist in `docs/supabase-setup.md` §7 against the real project.
