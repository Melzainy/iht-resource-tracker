import * as esbuild from 'esbuild'; import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8'); const cfg = html.match(/<script>window\.RT_CONFIG=.*?<\/script>/)[0];
const r = await esbuild.build({ entryPoints: ['tools/live-check/check.js'], bundle: true, format: 'iife', minify: true, write: false, target: ['es2020'], define: { 'process.env.NODE_ENV': '"production"' } });
const js = r.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
writeFileSync(process.argv[2] || 'dist/resource-tracker-live-check.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Resource Tracker — live Supabase check</title>
<style>body{font:14px/1.5 system-ui,Segoe UI,sans-serif;max-width:980px;margin:32px auto;padding:0 16px;color:#23272c}h1{font-size:20px}button{font:inherit;padding:8px 16px;border-radius:6px;border:1px solid #cfd4da;background:#2f5d8c;color:#fff;cursor:pointer}button[disabled]{opacity:.5}#copy{background:#fff;color:#23272c}#out div{padding:3px 0;border-bottom:1px solid #eef0f2;font-family:ui-monospace,Consolas,monospace;font-size:12.5px}.ok{color:#256b43}.bad{color:#b3372f;font-weight:600}.note{color:#5b636d}#sum{font-size:18px;font-weight:600;margin:12px 0}</style></head><body>
<h1>Resource Tracker — live Supabase check</h1>
<p>Runs the tracker's own data layer through two independent connections (A and B) to the shared database and checks Realtime between them. It only touches records it creates (named "ZZ Live Check …") and removes them at the end; the test person stays as an inactive entry. Takes about 30–60 seconds.</p>
<p><button id="start">Run live check</button> <button id="copy" disabled>Copy results</button></p>
<div id="sum"></div><div id="out"></div>
${cfg}
<script>${js}</script></body></html>`);
console.log('ok', (js.length / 1024).toFixed(0), 'KB');
