// Static build for the prototype: bundles src/ into dist/ (plain HTML + JS + CSS).
//   node scripts/build.mjs            → production build into dist/
//   node scripts/build.mjs --serve    → dev server with rebuild on change (http://localhost:5173)
//   node scripts/build.mjs --preview  → build, then serve dist/ as a static site
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const serve = process.argv.includes('--serve');
const preview = process.argv.includes('--preview');
const PORT = Number(process.env.PORT || 5173);

const options = {
  entryPoints: ['src/tracker.jsx'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': serve ? '"development"' : '"production"' },
  logLevel: 'info',
};

// ── Resource Tracker live-database config (Stage B) ─────────────────────────
// Read from environment variables or .env.local (git-ignored). Only the project URL and the
// browser-safe PUBLISHABLE key are accepted; a secret / service_role key stops the build.
function readEnvFile(f) { try { return Object.fromEntries(readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => /^\s*[A-Z_]+\s*=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; })); } catch (e) { return {}; } }
const ENV = { ...readEnvFile('.env.local'), ...process.env };
let RT_SNIPPET = '';
if ((ENV.RT_BACKEND || (ENV.NEXT_PUBLIC_SUPABASE_URL ? 'supabase' : 'local')) === 'supabase') {
  // RT_* names; NEXT_PUBLIC_* accepted as aliases (this project is an esbuild static site, not Next.js).
  const url = ENV.RT_SUPABASE_URL || ENV.NEXT_PUBLIC_SUPABASE_URL; const key = ENV.RT_SUPABASE_PUBLISHABLE_KEY || ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const { keyProblem } = await import('../src/rt/config.js');
  const problem = !url || !(/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) || /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(url)) ? `RT_SUPABASE_URL must look like https://<project-ref>.supabase.co (got ${url || 'nothing'})` : keyProblem(key);
  if (problem) { console.error(`\n✘ Resource Tracker live config refused: ${problem}\n`); process.exit(1); }
  RT_SNIPPET = `<script>window.RT_CONFIG=${JSON.stringify({ backend: 'supabase', supabaseUrl: url.replace(/\/$/, ''), supabasePublishableKey: key })};</script>\n  `;
  console.log(`Resource Tracker: LIVE Supabase backend (${url}) · publishable key ${key.slice(0, 18)}…`);
} else if (ENV.RT_REQUIRE_LIVE) { console.error('\n✘ RT_REQUIRE_LIVE is set but RT_BACKEND is not "supabase" — refusing to build a local-data site.\n'); process.exit(1); } else console.log('Resource Tracker: local preview backend (set RT_BACKEND=supabase in .env.local for the live database)');

function html(js, css) {
  return readFileSync('src/index.html', 'utf8').replace('%CSS%', css).replace(/(<script[^>]*src="%JS%")/, `${RT_SNIPPET}$1`).replace('%JS%', js);
}
function copyPublic() { for (const f of readdirSync('public')) copyFileSync(`public/${f}`, `dist/${f}`); }

if (serve) {
  rmSync('dist', { recursive: true, force: true }); mkdirSync('dist/assets', { recursive: true });
  copyPublic(); copyFileSync('src/styles.css', 'dist/assets/app.css');
  writeFileSync('dist/index.html', html('assets/app.js', 'assets/app.css'));
  const ctx = await esbuild.context({ ...options, outfile: 'dist/assets/app.js', sourcemap: true,
    plugins: [{ name: 'css', setup(b) { b.onEnd(() => copyFileSync('src/styles.css', 'dist/assets/app.css')); } }] });
  await ctx.watch();
  await ctx.serve({ servedir: 'dist', port: PORT });
  console.log(`\n  Prototype running at http://localhost:${PORT}\n`);
} else {
  rmSync('dist', { recursive: true, force: true }); mkdirSync('dist/assets', { recursive: true });
  const r = await esbuild.build({ ...options, minify: true, write: false, outfile: 'dist/assets/app.js' });
  const js = r.outputFiles[0].contents;
  const css = readFileSync('src/styles.css');
  const h = (b) => createHash('sha256').update(b).digest('hex').slice(0, 10);
  const jsName = `assets/app.${h(js)}.js`, cssName = `assets/app.${h(css)}.css`;
  writeFileSync(`dist/${jsName}`, js); writeFileSync(`dist/${cssName}`, css);
  writeFileSync('dist/index.html', html(jsName, cssName));
  writeFileSync('dist/404.html', html(jsName, cssName));
  writeFileSync('dist/.nojekyll', '');
  copyPublic();
  console.log(`Built dist/ · ${jsName} ${(js.length / 1024).toFixed(0)} KB · ${cssName} ${(css.length / 1024).toFixed(0)} KB`);
  if (preview) {
    const ctx = await esbuild.context({ entryPoints: [], write: false });
    await ctx.serve({ servedir: 'dist', port: PORT });
    console.log(`\n  Static preview at http://localhost:${PORT}\n`);
  }
}
