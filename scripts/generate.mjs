#!/usr/bin/env node
/**
 * Reads results/{repo-slug}/runs/*.json files, builds HubResult[] with full
 * HistoryEntry[] per repo, and injects into the @skillproof/ui HTML template.
 *
 * Run file format (one file per evaluation run):
 * {
 *   repo: string;        // "org/repo-name"
 *   repoUrl: string;     // "https://github.com/org/repo-name"
 *   repoPath: string;    // "/home/runner/work/..."
 *   sha: string;         // git commit SHA
 *   ref?: string;        // git ref, e.g. "refs/heads/main"
 *   evaluatedAt: string; // ISO 8601
 *   results: SkillEvaluationResult[];
 * }
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";

const ws = process.env.GITHUB_WORKSPACE ?? process.cwd();

const resultsDir = resolve(ws, process.env.INPUT_RESULTS_DIR ?? "results");
const outputFile = resolve(ws, process.env.INPUT_OUTPUT_FILE ?? "index.html");
const maxDays    = parseInt(process.env.INPUT_MAX_DAYS ?? "0", 10);
const maxRuns    = parseInt(process.env.INPUT_MAX_RUNS ?? "0", 10);
const uiHtml     = process.env.INPUT_UI_HTML;

if (!uiHtml || !existsSync(uiHtml)) {
  console.error(`@skillproof/ui template not found at: ${uiHtml ?? "(unset)"}`);
  process.exit(1);
}

function loadRepoRuns(slug) {
  const runsDir = join(resultsDir, slug, "runs");
  if (!existsSync(runsDir)) return [];

  const cutoff = maxDays > 0
    ? new Date(Date.now() - maxDays * 86_400_000).toISOString()
    : null;

  let runs = readdirSync(runsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try { return JSON.parse(readFileSync(join(runsDir, f), "utf8")); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt));

  if (cutoff) runs = runs.filter((r) => r.evaluatedAt >= cutoff);
  if (maxRuns > 0) runs = runs.slice(-maxRuns);

  return runs;
}

function buildHubResults() {
  if (!existsSync(resultsDir)) return [];

  return readdirSync(resultsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((dir) => {
      const runs = loadRepoRuns(dir.name);
      if (runs.length === 0) return null;

      const latest = runs[runs.length - 1];
      return {
        repo:     latest.repo,
        repoUrl:  latest.repoUrl,
        repoPath: latest.repoPath,
        history:  runs.map((r) => ({
          sha:         r.sha ?? "",
          ref:         r.ref,
          evaluatedAt: r.evaluatedAt,
          results:     r.results ?? [],
        })),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

const results = buildHubResults();
const template = readFileSync(uiHtml, "utf8");

const payload     = JSON.stringify({ mode: "multi", results });
const safePayload = payload.replace(/<\/script>/gi, "<\\/script>");
const inject      = `<script>window.__SKILLPROOF_DATA__ = ${safePayload};</script>`;
const html        = template.replace("</body>", `${inject}\n</body>`);

writeFileSync(outputFile, html);
console.log(`Skillproof Hub: generated dashboard — ${results.length} repo(s), output: ${outputFile}`);
