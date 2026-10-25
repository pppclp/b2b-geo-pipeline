/**
 * GitHub Pages UAT release gate.
 *
 * Automatic publishing is permitted only when *all* changes since the last
 * successfully published Pages commit are UI-only, as defined below.
 * A manual UAT release can publish a backend-changing revision only with an
 * explicit backend_verified confirmation, not just a green frontend build.
 *
 * Fail closed on missing GitHub metadata, unreachable APIs or unknown files.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

export const UI_ONLY_PATHS = Object.freeze([
  /^index\.html$/,
  /^tailwind\.config\.js$/,
  /^public\//,
  /^src\/index\.css$/,
  /^src\/components\/ui\//,
  /^src\/components\/dashboard\//,
  /^src\/components\/(?:AppLayout|AuthLayout|FilterBar|PipelineCard|EmptyState)\.jsx$/,
  /^src\/pages\/(?:Dashboard|Pipeline)\.jsx$/,
  /^src\/lib\/(?:pipelineListFilters|pipelineFilterUi|pipelineListPresentation|dashboardQueue|dashboardMetrics)\.js$/,
  /^tests\//,
]);

export function isUiOnlyChange(file) {
  return UI_ONLY_PATHS.some((pattern) => pattern.test(String(file || "")));
}
export function assessChanges(files) {
  const modified = files.filter(Boolean);
  if (!modified.length) return { eligible: false, blocked: [], reason: "No source changes found" };
  const blocked = modified.filter((file) => !isUiOnlyChange(file));
  return { eligible: blocked.length === 0, blocked };
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, name + "=" + value + "\n");
}
function notice(message) {
  process.stdout.write("::notice::" + message.replace(/\n/g, " ") + "\n");
}
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
async function lastSuccessfulDeployment() {
  const repo = process.env.GITHUB_REPOSITORY || "";
  const token = process.env.GITHUB_TOKEN || "";
  if (!repo || !token) throw Error("GitHub token/repository missing: cannot verify previously published version");
  const url = "https://api.github.com/repos/" + repo +
    "/actions/workflows/deploy-pages.yml/runs?branch=main&status=success&per_page=20";
  const response = await fetch(url, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error("Cannot fetch GitHub Pages release history: HTTP " + response.status);
  const json = await response.json();
  const previous = (json.workflow_runs || []).find((run) => run.conclusion === "success" && run.head_sha);
  return previous?.head_sha || null;
}

export async function main() {
  output("release_allowed", "false");
  const dispatch = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
  if (dispatch && process.env.BACKEND_VERIFIED === "true") {
    notice("Manual UAT release explicitly approved after matching Apps Script verification.");
    output("release_allowed", "true");
    output("release_mode", "verified-backend-manual");
    return;
  }

  let previous;
  try {
    previous = await lastSuccessfulDeployment();
  } catch (error) {
    notice(error.message + ". Release skipped; use verified manual dispatch.");
    return;
  }
  if (!previous) {
    notice("No successful Pages baseline. Release skipped; verify backend and run one manual UAT deployment.");
    return;
  }

  const head = process.env.GITHUB_SHA || git(["rev-parse", "HEAD"]);
  try {
    git(["cat-file", "-e", previous + "^{commit}"]);
    git(["merge-base", "--is-ancestor", previous, head]);
  } catch {
    notice("Previous Pages deployment is not a locally available ancestor. Release skipped.");
    return;
  }

  const changed = git(["diff", "--name-only", previous, head]).split("\n").filter(Boolean);
  const assessment = assessChanges(changed);
  if (!assessment.eligible) {
    const summary = assessment.blocked.length
      ? "Backend/contract/unknown files changed since last published Pages revision: " +
        assessment.blocked.slice(0, 12).join(", ") +
        (assessment.blocked.length > 12 ? " (and more)" : "")
      : "No files to publish";
    notice(summary + ". Automatic release skipped; first verify/deploy matching Apps Script, then run manual release with backend_verified checked.");
    output("release_mode", "backend-verification-required");
    return;
  }

  notice("UI-only update relative to successfully published Pages commit " + previous.slice(0, 10) + ". Tests and build will run before automatic publish.");
  output("release_allowed", "true");
  output("release_mode", "safe-ui-only");
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write("::error::Pages release gate failed closed: " + error.message + "\n");
    process.exitCode = 1;
  });
}
