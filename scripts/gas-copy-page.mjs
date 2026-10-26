// Private/offline browser viewer for the generated one-file Apps Script backend.
// The HTML is included in an authenticated GitHub Actions artifact, never shipped in public/.
import fs from "node:fs";
import path from "node:path";
const root=process.cwd(), dir=path.join(root,"apps-script");
const input=path.join(dir,"Code.gs"), output=path.join(dir,"Copy-Codegs.html");
if(!fs.existsSync(input)) throw Error("Missing apps-script/Code.gs; run npm run gas:build and gas-singlefile.mjs");
const code=fs.readFileSync(input,"utf8");
const escaped=code.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const html=`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>Copy Code.gs | B2B GEO Pipeline</title>
<style>:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#17324c;background:#f5f8fc}*{box-sizing:border-box}body{margin:0;padding:30px 16px}main{max-width:1200px;margin:auto}header{display:flex;gap:18px;justify-content:space-between;align-items:center;flex-wrap:wrap}h1{font-size:24px;margin:0}p{color:#61748b;line-height:1.5}button{appearance:none;background:#1765b0;color:white;border:0;border-radius:10px;padding:12px 20px;font-weight:650;cursor:pointer}button:focus-visible{outline:3px solid #ffb84d}textarea{display:block;width:100%;height:65vh;min-height:400px;padding:18px;border:1px solid #bfd0e0;border-radius:12px;resize:vertical;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:white;color:#162f46;white-space:pre;tab-size:2}.small{font-size:13px}.status{font-size:13px;font-weight:600;color:#1765b0}</style>
</head><body><main><header><div><h1>Copy Code.gs</h1><p>Generated from the same commit as the accompanying Code.gs. Copy everything into the existing Google Apps Script project, then update its deployment. Keep this file private.</p></div><button type="button" id="copy">Copy all code</button></header>
<p class="small">File: <strong>Code.gs</strong> · <span id="lines"></span> lines · <span id="chars"></span> characters · Offline viewer (no network requests)</p>
<textarea id="code" readonly spellcheck="false" aria-label="Full Code.gs source">${escaped}</textarea>
<p role="status" class="status" id="status">Nothing has been deployed. Copying does not update Apps Script.</p>
<script>const t=document.getElementById("code");document.getElementById("lines").textContent=t.value.split("\\n").length;document.getElementById("chars").textContent=t.value.length;document.getElementById("copy").addEventListener("click",async()=>{try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(t.value)}else{t.focus();t.select();if(!document.execCommand("copy"))throw Error("Copy unavailable")}document.getElementById("status").textContent="Copied Code.gs to clipboard. Paste into Apps Script and deploy manually."}catch(e){t.focus();t.select();document.getElementById("status").textContent="Select All is ready. Press Ctrl+C / Cmd+C to copy manually."}});</script>
</main></body></html>`;
fs.writeFileSync(output,html);
console.log(`Wrote ${output} (${code.length} source chars)`);
