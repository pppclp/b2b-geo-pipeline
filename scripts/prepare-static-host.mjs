// Configure SPA deep-link fallback for the selected static-host base path.
// GitHub Pages needs 404.html; root-based Pages hosts use SPA fallback instead.
// This changes only the generated dist/ files, never runtime app behavior.
import { copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
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
    // Cloudflare Pages supports its default SPA fallback when 404.html is absent.
    // Netlify/Cloudflare Pages additionally understand this explicit 200 rewrite.
    writeFileSync(redirects, "/* /index.html 200\n");
  } else {
    // Project GitHub Pages uses 404.html for fresh URL/deep-link requests.
    copyFileSync(index, notFound);
  }
  return { base, fallback: base === "/" ? "rewrite" : "404" };
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const result = prepareStaticHost({
    basePath: process.env.VITE_BASE_PATH,
    outputDir: join(process.cwd(), "dist"),
  });
  process.stdout.write("Prepared " + result.fallback + " SPA fallback for " + result.base + "\n");
}
