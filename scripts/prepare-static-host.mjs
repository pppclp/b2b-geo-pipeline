// Configure SPA deep-link fallback for the selected static-host base path.
// GitHub Pages needs 404.html; root-based Cloudflare hosts use native SPA fallback.
// Workers Assets use wrangler.jsonc assets.not_found_handling; no _redirects rule is needed.
// This changes only the generated dist/ files, never runtime app behavior.
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export function prepareStaticHost({ basePath, outputDir }) {
  const base = basePath || "/b2b-geo-pipeline/";
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))
    throw new Error("VITE_BASE_PATH must be / or an absolute slash-terminated path");
  const index = join(outputDir, "index.html");
  if (!existsSync(index)) throw new Error("Build index.html before preparing static routing");
  const notFound = join(outputDir, "404.html");
  const redirects = join(outputDir, "_redirects");
  rmSync(notFound, { force: true });
  rmSync(redirects, { force: true });
  if (base === "/") {
    // Cloudflare Workers uses assets.not_found_handling: single-page-application.
    // Cloudflare Pages also serves index.html as SPA fallback when 404.html is absent.
    // Do not generate /* /index.html 200: Workers rejects it as an infinite loop.
  } else {
    // Project GitHub Pages uses 404.html for fresh URL/deep-link requests.
    copyFileSync(index, notFound);
  }
  return { base, fallback: base === "/" ? "native-spa" : "404" };
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const result = prepareStaticHost({
    basePath: process.env.VITE_BASE_PATH,
    outputDir: join(process.cwd(), "dist"),
  });
  process.stdout.write("Prepared " + result.fallback + " SPA fallback for " + result.base + "\n");
}
