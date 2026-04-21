import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function getArg(name, fallback = "") {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx === args.length - 1) return fallback;
  return String(args[idx + 1]).trim();
}

function sanitizeLabel(value) {
  return value.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-");
}

const target = sanitizeLabel(getArg("target", "lab"));
const label = sanitizeLabel(getArg("label", "baseline"));
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const runId = `${timestamp}-${target}-${label}`;

const root = process.cwd();
const baseDir = path.join(root, "data", "validation-feedback");
const runDir = path.join(baseDir, runId);

if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}
if (fs.existsSync(runDir)) {
  throw new Error(`Run directory already exists: ${runDir}`);
}
fs.mkdirSync(runDir, { recursive: true });

const runTemplate = fs
  .readFileSync(path.join(baseDir, "run-log.template.md"), "utf8")
  .replaceAll("<target>", target)
  .replaceAll("<run_id>", runId);
const csvTemplate = fs.readFileSync(path.join(baseDir, "findings-log.template.csv"), "utf8");

fs.writeFileSync(path.join(runDir, "run.md"), runTemplate, "utf8");
fs.writeFileSync(path.join(runDir, "findings.csv"), csvTemplate, "utf8");

console.log(`Created validation run: ${runId}`);
console.log(`Path: ${runDir}`);
