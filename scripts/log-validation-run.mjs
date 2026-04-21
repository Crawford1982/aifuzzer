import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sessionLog = path.join(repoRoot, "data", "validation-feedback", "SESSION-LOG.md");
const outputDir = path.join(repoRoot, "output");

function pickLatestReport() {
  if (!fs.existsSync(outputDir)) {
    throw new Error(`No output directory: ${outputDir}`);
  }
  const files = fs.readdirSync(outputDir).filter((f) => /^mythos-report-\d+\.json$/u.test(f));
  if (!files.length) {
    throw new Error("No mythos-report-*.json in ./output — run Mythos first.");
  }
  files.sort((a, b) => {
    const ma = /mythos-report-(\d+)\.json/u.exec(a);
    const mb = /mythos-report-(\d+)\.json/u.exec(b);
    const na = ma ? Number(ma[1]) : 0;
    const nb = mb ? Number(mb[1]) : 0;
    return nb - na;
  });
  return path.join(outputDir, files[0]);
}

function ensureSessionLogHeader() {
  if (fs.existsSync(sessionLog)) return;
  const initial = `# Validation session log

Append-only timeline of Mythos benchmark runs: **what we ran**, **what mode**, **how much traffic**, **how many findings**. Use per-run folders under this directory for narrative notes.

| generatedAt (UTC) | report file | mode | openapi | executed | findings | target |
| --- | --- | --- | --- | --- | --- | --- |
`;
  fs.mkdirSync(path.dirname(sessionLog), { recursive: true });
  fs.writeFileSync(sessionLog, initial, "utf8");
}

function main() {
  const arg = process.argv[2];
  const reportPath = arg ? path.resolve(arg) : pickLatestReport();
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Report not found: ${reportPath}`);
  }

  const raw = fs.readFileSync(reportPath, "utf8");
  /** @type {Record<string, unknown>} */
  const j = JSON.parse(raw);
  const findings = Array.isArray(j.findings) ? j.findings.length : 0;
  const openapi =
    typeof j.openapiPath === "string" && j.openapiPath.length ? j.openapiPath : "—";

  ensureSessionLogHeader();

  const row = `| ${j.generatedAt ?? ""} | ${path.basename(reportPath)} | ${j.mode ?? ""} | ${openapi} | ${j.executed ?? "—"} | ${findings} | ${String(j.target ?? "").trim()} |\n`;
  fs.appendFileSync(sessionLog, row, "utf8");

  console.log(`Appended row to ${path.relative(repoRoot, sessionLog)}`);
  console.log(row.trim());
}

main();
