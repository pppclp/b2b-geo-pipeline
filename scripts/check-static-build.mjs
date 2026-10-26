// Isolated, read-only smoke test against generated dist/ — no real API calls.
// Checks favicon / assets and deep-link refresh with each host's SPA fallback.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export async function checkStaticBuild({ base, directory }) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw Error("Invalid base path");
  const root = resolve(directory);
  const index = readFileSync(join(root, "index.html"), "utf8");
  const rootBased = base === "/";
  const fallback = join(root, rootBased ? "index.html" : "404.html");
  const redirectFile = join(root, "_redirects");
  if (!existsSync(fallback)) throw Error("Missing SPA fallback: " + fallback);
  // Cloudflare root hosts use native SPA fallback; PR #95 intentionally
  // removed _redirects, so the smoke test must reject rather than require it.
  if (rootBased && (existsSync(join(root,"404.html")) || existsSync(redirectFile))) {
    throw Error("Root build must use native SPA routing, without 404.html or _redirects");
  }
  if (!rootBased && existsSync(redirectFile)) throw Error("Project Pages build must not include root redirects");
  const assets = [...index.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(m=>m[1]);
  if (!assets.length) throw Error("Build HTML must reference JavaScript/CSS assets");
  for (const url of assets) {
    if (!url.startsWith(base)) throw Error("Asset is outside configured Vite base: " + url);
    const file = join(root, url.slice(base.length).split("?")[0]);
    if (!existsSync(file)) throw Error("Missing built asset: " + url);
  }
  const icon = base + "favicon.ico";
  if (!index.includes(icon)) throw Error("Favicon base path does not match " + base);
  const server = createServer((req,res)=>{
    const requestPath = new URL(req.url,"http://localhost").pathname;
    if (!requestPath.startsWith(base)) {
      res.writeHead(404); res.end("Outside base"); return;
    }
    let part;
    try { part=decodeURIComponent(requestPath.slice(base.length)); }
    catch { res.writeHead(400); res.end(); return; }
    const physical=resolve(root,part || "index.html");
    if(physical !== root && !physical.startsWith(root + sep)) {
      res.writeHead(400); res.end(); return;
    }
    const isFile=existsSync(physical) && physical !== root;
    const target=isFile?physical:fallback;
    const status=isFile?200:rootBased?200:404; // GitHub Pages serves 404.html with 404
    res.writeHead(status,{"Content-Type":target.endsWith(".html")?"text/html":target.endsWith(".js")?"text/javascript":"text/plain"});
    res.end(readFileSync(target));
  });
  await new Promise((ok,fail)=>server.once("error",fail).listen(0,"127.0.0.1",ok));
  const url="http://127.0.0.1:"+server.address().port;
  try {
    for (const route of ["", "login", "pipeline", "opportunity/SYNTHETIC"]) {
      const response=await fetch(url + base + route);
      const html=await response.text();
      const expectedStatus=route&&!rootBased?404:200;
      if(response.status!==expectedStatus || !html.includes("<div id=\"root\"></div>"))
        throw Error("Deep-link HTML fallback failed: " + base + route + " (" + response.status + ")");
    }
    for(const asset of assets) {
      const response=await fetch(url+asset);
      if(response.status!==200)throw Error("Missing static asset: "+asset);
    }
  } finally { await new Promise(ok=>server.close(ok)); }
  return {base,assetCount:assets.length,routes:4,fallback:rootBased?"native-spa":"404-html"};
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const arg = process.argv.indexOf("--base");
  const base=arg>=0?process.argv[arg+1]:(process.env.VITE_BASE_PATH||"/b2b-geo-pipeline/");
  const result=await checkStaticBuild({base,directory:join(process.cwd(),"dist")});
  process.stdout.write(JSON.stringify(result)+"\n");
}
