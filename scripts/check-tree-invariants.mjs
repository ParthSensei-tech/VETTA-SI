// npm run check:tree — the restructure's own gate, independent of the app's
// typecheck/tests. It answers three questions the compiler cannot:
//
//   1. Is the map still complete? (totality, no colliding targets)
//   2. Is every file's *tier* honest, judged from what the file does rather
//      than from the folder someone guessed for it? This is the check that
//      found batch.ts, labels.ts, portal.ts, share.ts and screen-session.ts
//      sitting in `domain/` while carrying createServerFn handlers.
//   3. Do the boundary rules actually fire? A glob that silently stops matching
//      is the failure mode of every directory-keyed lint rule, and it looks
//      exactly like success. --probes proves it instead of assuming it.
//
// Exit 0 with findings is allowed only where flagged as a report; every hard
// check fails closed.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname } from "node:path";
import * as posix from "node:path/posix";
import { fileURLToPath } from "node:url";
import { compileTable, diskView, isCodeFile } from "./move-tree.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const flags = new Set(args);
const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const note = (m) => notes.push(m);

const map = JSON.parse(readFileSync(posix.join(ROOT, "scripts/move-map.json"), "utf8"));
const liveMoves = map.moves
  .map((m) => ({ ...m, from: m.from.filter((f) => diskView.isFile(f) || diskView.isDir(f)) }))
  .filter((m) => m.from.length);
const { table, errors } = compileTable({ ...map, moves: liveMoves }, diskView);
errors.forEach(fail);

// --- 1. totality over the files the programme owns --------------------------
const owned = diskView
  .list("src")
  .filter(isCodeFile)
  .filter((f) => f.startsWith("src/lib/") || f.startsWith("src/components/"));
const keepPrefixes = Object.keys(map.keep)
  .filter((g) => g.startsWith("src/") && g.includes("**"))
  .map((g) => g.replace(/\/\*\*\/?\*?$/, ""));
for (const f of owned) {
  const kept =
    f in map.keep || keepPrefixes.some((p) => f === p || f.startsWith(p + "/"));
  if (!table.has(f) && !kept) fail(`map is not total: ${f} is neither moved nor kept`);
}

// --- 2. tier honesty, read from file content --------------------------------
const SERVER_SPEC = /["']((?:\.{1,2}\/|@\/)[^"']*(?:\.server(?:\.ts|\.tsx)?|\/server(?:\.ts|\.tsx)?|\/server\/))["']/g;
const tierOf = (p) => {
  const m = /src\/(?:features\/[^/]+|platform|shared)\/(domain|server|api|ui)\//.exec(p);
  return m ? m[1] : null;
};
let contentChecked = 0;
for (const [from, to] of table) {
  if (!isCodeFile(from) || from.endsWith(".test.ts") || from.endsWith(".test.tsx")) continue;
  const text = diskView.read(from);
  contentChecked++;
  const tier = tierOf(to);
  const isWrapper = /(^|\/)api\.ts$|-api\.ts$/.test(to);
  // Platform infrastructure is the server edge for auth and the connector
  // probes, so its wrappers (auth/middleware.ts, app-data/readiness.ts) are
  // exempt by tier rather than by an exception list.
  const inPlatform = to.startsWith("src/platform/");
  if (/createServerFn/.test(text) && !(tier === "api" || isWrapper || inPlatform))
    fail(
      `tier dishonest: ${from} builds createServerFn handlers but maps to '${to}' (tier ${tier ?? "none"}) — it belongs in an api/ folder`,
    );
  const servers = [...text.matchAll(SERVER_SPEC)].map((m) => m[1]);
  if (servers.length && (tier === "domain" || tier === "ui"))
    fail(
      `tier dishonest: ${from} reaches ${servers[0]} but maps into '${tier}/', which the lint boundary forbids`,
    );
  if (basename(to) !== basename(from))
    fail(`basename changed: ${from} -> ${to} (the map's hard rule is directories change, names do not)`);
}

// --- 3. framework integrity --------------------------------------------------
for (const [from, to] of table) {
  if (/^src\/routes\//.test(from) || /^src\/routes\//.test(to))
    fail(`a route file is in the move table (${from}) — moving it silently changes a public URL`);
  if (/^server\/|^public\/|^migrations\/|startup\.sh$|routeTree\.gen\.ts$/.test(to))
    fail(`${from} maps onto a platform-pinned path (${to})`);
}
if (existsSync(posix.join(ROOT, "src/routeTree.gen.ts"))) {
  const gen = diskView.read("src/routeTree.gen.ts");
  for (const from of table.keys()) if (gen.includes(from)) fail(`routeTree.gen.ts references ${from}, which moves`);
}

// --- 4. stale-path report ----------------------------------------------------
const staleNeedle = flags.has("--final") ? fail : note;
const stale = [];
for (const f of [...diskView.list("src"), ...diskView.list("scripts"), ...diskView.list("server")].filter(isCodeFile)) {
  const text = diskView.read(f);
  for (const m of text.matchAll(/["'`]([^"'`]*(?:src\/lib\/(?:recruiting|auth|observability|og|app-data)\b|@\/lib\/)[^"'`]*)["'`]/g))
    if (!/^src\/lib\/recruiting\/README/.test(f)) stale.push(`${f}: ${m[1]}`);
}
if (stale.length) staleNeedle(`${stale.length} literal path references into the old tree remain`);

// --- 5. do the boundary rules actually fire? ---------------------------------
const PROBES = [
  { file: "src/components/__probe_tree.tsx", code: `import * as a from "@/lib/recruiting/ai.server";\nexport const p = async () => [a, await import("../lib/recruiting/queue.server.ts")];`, min: 2 },
  { file: "src/routes/__probe_dir__/p.tsx", code: `import * as a from "../../lib/recruiting/org.server";\nexport const p = a;`, min: 1 },
  { file: "src/features/verification/domain/__probe.ts", code: `import * as a from "@/features/verification/server/evidence.server";\nimport * as c from "@/components/app-shell";\nexport const p = async () => [a, c, await import("../server/evidence.server.ts")];`, min: 3 },
  { file: "src/features/verification/api/__probe.ts", code: `import * as a from "@/features/verification/server/evidence.server";\nexport const p = a;`, min: 0 },
  { file: "src/features/verification/domain/__probe_neg.ts", code: `import * as fw from "@tanstack/react-start/server";\nexport const p = fw;`, min: 0 },
];

function probes() {
  const created = [];
  for (const p of PROBES) {
    const abs = posix.join(ROOT, p.file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, p.code, "utf8");
    created.push(p.file);
  }
  const res = spawnSync(
    process.execPath,
    [posix.join(ROOT, "node_modules", "eslint", "bin", "eslint.js"), ...PROBES.map((p) => p.file), "--format", "json"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  let parsed = [];
  try {
    parsed = JSON.parse(res.stdout || "[]");
  } catch {
    fail(`probe run unusable (exit ${res.status}): ${(res.stderr || "").slice(0, 300)}`);
  }
  const madeDirs = [...new Set(created.map((f) => posix.dirname(f)))];
  for (const f of created) rmSync(posix.join(ROOT, f), { force: true });
  for (const d of madeDirs.sort((a, b) => b.length - a.length)) {
    const abs = posix.join(ROOT, d);
    if (existsSync(abs) && readdirCount(abs) === 0) rmSync(abs, { recursive: true, force: true });
  }
  for (const p of PROBES) {
    const hit = parsed.find((r) => r.filePath.replace(/\\/g, "/").endsWith(p.file));
    const got = (hit?.messages ?? []).filter((m) => m.severity === 2).length;
    if (got < p.min) fail(`boundary rule went silent: ${p.file} expected >= ${p.min} errors, got ${got}`);
    if (p.min === 0 && got > 0)
      fail(`boundary rule over-fires on the legal case ${p.file}: ${JSON.stringify(hit.messages.map((m) => m.message))}`);
  }
  return created.length;
}

function readdirCount(abs) {
  try {
    return readdirSync(abs).length;
  } catch {
    return -1;
  }
}

const probeCount = flags.has("--probes") ? probes() : 0;

console.log(
  `check:tree  moves=${table.size} tier-checked=${contentChecked} owned=${owned.length}` +
    (flags.has("--probes") ? ` probes=${probeCount}` : " (probe pass skipped: --probes)"),
);
for (const n of notes) console.log("  note: " + n);
if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("  0 failures");
