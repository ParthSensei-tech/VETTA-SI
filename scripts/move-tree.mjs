// The restructure codemod: turns scripts/move-map.json into (a) a file move
// table and (b) the exact specifier rewrites that table forces, then applies
// both with `git mv` so rename detection can verify the result.
//
// Design rules, in order of why they exist:
//
// 1. The map is the only input. Nothing here decides where a file goes; if a
//    path is not named in move-map.json this script refuses to guess.
// 2. Resolution is real, not textual. A specifier is rewritten only after it
//    resolves to a file that the table moves. That is what makes `./api`,
//    `../server/x` and `@/lib/recruiting/api` all correct without a per-form
//    hack, and it is why the alias/extension rules mirror
//    scripts/bench-resolve-hooks.mjs (there is a test pinning that parity).
// 3. Fail closed. An unmappable local specifier, a directory import with no
//    index file, or a file parked inside a directory that otherwise moves is an
//    error that blocks --apply. Silent partial moves are the failure mode that
//    would actually ship a broken app.
// 4. Idempotent. Running it twice is a no-op: after the first pass the sources
//    are at their target paths, which are not table keys.
//
// Usage:
//   node scripts/move-tree.mjs --dry-run [--batch N] [--json out.json]
//   node scripts/move-tree.mjs --apply --batch N --yes

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join as nativeJoin } from "node:path";
import * as posix from "node:path/posix";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".cjs", ".js", ".json"];
// A candidate is any string literal that *looks* like a local module path. The
// rewrite then requires it to resolve, so being generous here is safe; being
// narrow here is what loses a `ssrLoadModule("/src/lib/db.ts")`.
const SPEC_STARTS = ["./", "../", "@/", "/src/", "src/"];
// Docs and prose are not rewritten by regex; they get updated by hand in the
// batch that changes what they describe (Batch 10).
const CODE_FILE = /\.(?:ts|tsx|mjs|cjs|js|json)$/;
export const isCodeFile = (p) => CODE_FILE.test(p);
// The codemod and its spec are never rewrite targets. move-map.json's `from`
// paths are the *historical* tree by design — rewriting them would make the
// map describe wherever the files happen to be now, which is not a spec any
// more. Same for the fixtures in move-tree.test.mjs, whose fake paths collide
// with real ones. Everything else in `scripts/` does get rewritten: those are
// assertions about the real tree, and keeping them in sync is the point.
export const SELF_FILES = [
  "scripts/move-map.json",
  "scripts/move-tree.mjs",
  "scripts/move-tree.test.mjs",
  "scripts/check-tree-invariants.mjs",
];

/** POSIX-relative repo path, no leading `./`. */
export function norm(p) {
  return p
    .split(/[\\/]+/)
    .join("/")
    .replace(/^\.\//, "");
}

/** The extensionless+index resolution rules the bundler and the test hook use. */
export function makeResolver(view) {
  return function resolve(spec, fromDir) {
    if (!spec || spec.includes("*")) return null;
    let base;
    if (spec.startsWith("@/")) base = posix.join("src", spec.slice(2));
    else if (spec.startsWith("/src/")) base = spec.slice(1);
    else if (spec.startsWith("src/")) base = spec;
    else if (spec.startsWith("./") || spec.startsWith("../"))
      base = posix.normalize(posix.join(fromDir, spec));
    else return null;
    for (const cand of [base, ...EXTENSIONS.map((e) => base + e)])
      if (view.isFile(cand)) return { file: cand, ext: "" };
    for (const e of EXTENSIONS) {
      const idx = posix.join(base, "index" + e);
      if (view.isFile(idx)) return { file: idx, ext: "/index" + e };
    }
    if (view.isDir(base)) return { file: null, dir: base };
    return null;
  };
}

/** Real filesystem view; tests pass their own in-memory object instead. */
export const diskView = {
  isFile: (p) => {
    try {
      return statSync(nativeJoin(ROOT, p)).isFile();
    } catch {
      return false;
    }
  },
  isDir: (p) => {
    try {
      return statSync(nativeJoin(ROOT, p)).isDirectory();
    } catch {
      return false;
    }
  },
  read: (p) => readFileSync(nativeJoin(ROOT, p), "utf8"),
  list(p) {
    const out = [];
    const walk = (rel) => {
      for (const name of readdirSync(nativeJoin(ROOT, rel), { withFileTypes: true })) {
        const child = posix.join(rel, name.name);
        if (name.isDirectory()) walk(child);
        else out.push(child);
      }
    };
    if (this.isDir(p)) walk(p);
    return out;
  },
  // The consumers that are not inside a directory tree: `vite.config.ts` holds
  // three `ssrLoadModule("/src/lib/...")` calls, which is exactly the class of
  // reference a src-only codemod would miss and the app would only discover at
  // runtime, in the one place (dev SSR) that cannot be typechecked.
  looseFiles: [
    "vite.config.ts",
    "eslint.config.mjs",
    "tsconfig.json",
    "package.json",
    "vercel.json",
    "startup.sh",
  ],
};

/**
 * move-map.json -> { table: Map<oldPath,newPath>, batches, errors }.
 * Directory entries keep their own basename as a subfolder of `to`, which is
 * what makes `src/lib/auth` -> `src/platform/auth` and
 * `src/lib/recruiting/harness` -> `src/features/eval/harness` the same rule.
 */
export function compileTable(map, view, onlyBatch) {
  const table = new Map();
  const errors = [];
  const owners = [];
  for (const move of map.moves) {
    if (onlyBatch !== undefined && move.batch !== onlyBatch) continue;
    const to = norm(move.to);
    for (const raw of move.from) {
      const from = norm(raw);
      owners.push({ from, to, batch: move.batch });
      if (view.isDir(from)) {
        const stem = posix.basename(from);
        for (const file of view.list(from))
          add(table, errors, file, posix.join(to, stem, posix.relative(from, file)));
      } else if (view.isFile(from)) {
        const isFileTarget = posix.basename(to).includes(".");
        add(table, errors, from, isFileTarget ? to : posix.join(to, posix.basename(from)));
      } else {
        errors.push(`move-map: '${from}' exists on neither path — a typo or already moved`);
      }
    }
  }
  return { table, errors, owners };
}

function add(table, errors, from, to) {
  if (table.has(from)) {
    errors.push(`move-map: '${from}' is claimed twice — '${table.get(from)}' and '${to}'`);
    return;
  }
  if (from === to) {
    errors.push(`move-map: '${from}' maps to itself`);
    return;
  }
  for (const [prevFrom, prevTo] of table)
    if (prevTo === to) {
      errors.push(`move-map: '${to}' would be written by both '${prevFrom}' and '${from}'`);
      return;
    }
  table.set(from, to);
}

/** Every string literal that could be a local module path, with its quote char. */
export function findSpecs(text) {
  const out = [];
  const re = /(["'`])((?:[^"'`\\]|\\.)*)(\1)/g;
  let m;
  while ((m = re.exec(text))) {
    const spec = m[2];
    if (!SPEC_STARTS.some((s) => spec.startsWith(s))) continue;
    if (spec.includes("\n") || spec.includes("*") || spec.endsWith("/")) continue;
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    out.push({
      start: m.index + 1,
      end: m.index + 1 + spec.length,
      spec,
      // Only used to decide whether a *directory* literal is a barrel import
      // (which would break the build) or prose (which is not a hazard).
      imported: /(?:from|import|require)\s*[(+]?\s*$/.test(before),
    });
  }
  return out;
}

/** Re-render a specifier for its new location, preserving the author's form. */
export function renderSpec(oldSpec, resolvedFile, newTarget, newImporterDir) {
  const hadExt = EXTENSIONS.some((e) => oldSpec.endsWith(e));
  const hadIndex = /\/index(\.[a-z]+)?$/.test(oldSpec);
  let target = newTarget;
  if (!hadExt) target = target.replace(/\.[a-z]+$/, "");
  if (!hadIndex) target = target.replace(/\/index$/, "");
  if (oldSpec.startsWith("@/")) return "@/" + posix.relative("src", target);
  if (oldSpec.startsWith("/src/")) return "/" + target;
  if (oldSpec.startsWith("src/")) return target;
  const rel = posix.relative(newImporterDir, target);
  return rel.startsWith(".") ? rel : "./" + rel;
}

/**
 * All rewrites a move set forces, keyed by the file that must be edited.
 * Returns { edits: Map<path, {text, changes[]}>, errors[] }.
 */
export function planRewrites(map, view, { onlyBatch, consumerDirs, looseFiles } = {}) {
  const { table, errors, owners } = compileTable(map, view, onlyBatch);
  const resolve = makeResolver(view);
  const edits = new Map();
  const problems = [...errors];
  const dirs = consumerDirs ?? ["src", "scripts", "server"];
  const consumers = [];
  for (const d of dirs) consumers.push(...view.list(d).filter(isCodeFile));
  for (const f of looseFiles ?? view.looseFiles ?? []) if (view.isFile(f)) consumers.push(f);
  // Directory entries map by prefix, which is what lets a literal that *names a
  // folder* move too — brand-check.test.mjs asserts existsSync("src/lib/og").
  const dirOwners = owners
    .filter((o) => view.isDir(o.from))
    .sort((a, b) => b.from.length - a.from.length);
  const remap = (p) => {
    if (table.has(p)) return table.get(p);
    for (const o of dirOwners) {
      if (p === o.from) return posix.join(o.to, posix.basename(o.from));
      if (p.startsWith(o.from + "/"))
        return posix.join(o.to, posix.basename(o.from), posix.relative(o.from, p));
    }
    return null;
  };

  for (const file of consumers) {
    if (/routeTree\.gen\.ts$/.test(file) || SELF_FILES.includes(file)) continue;
    const text = view.read(file);
    if (!text) continue;
    let out = text;
    const changes = [];
    // Replace right-to-left so earlier offsets stay valid.
    for (const { start, end, spec, imported } of findSpecs(text).reverse()) {
      const r = resolve(spec, posix.dirname(file));
      if (!r) continue;
      const resolvedPath = r.file ?? r.dir;
      // A directory literal only matters when it is a barrel import; prose
      // about `src/lib` in a comment is not a hazard and not a rewrite target.
      if (r.dir && !imported) continue;
      const target = remap(resolvedPath);
      if (!target) {
        // The between-batches trap: a file moving *now* may hold a relative
        // specifier into a folder that moves in a *later* batch. Its depth
        // changes, so the import silently breaks until that batch lands — and a
        // typecheck run between batches would point at the wrong file. Rewrite
        // those to the canonical `@/` alias instead: same module, resolves the
        // same from any depth, and the later batch rewrites it for real.
        if (table.has(file) && r.file && /^\.\.?\//.test(spec)) {
          let rel = posix.relative("src", resolvedPath);
          if (!EXTENSIONS.some((e) => spec.endsWith(e))) rel = rel.replace(/\.[a-z]+$/, "");
          const next = "@/" + rel;
          out = out.slice(0, start) + next + out.slice(end);
          changes.push({ spec, next, to: resolvedPath, canonicalised: true });
        }
        continue;
      }
      if (r.dir)
        problems.push(
          `${file}: '${spec}' imports a directory that moves and has no index file — the move breaks it`,
        );
      const newImporter = table.get(file) ?? file;
      const next = renderSpec(spec, resolvedPath, target, posix.dirname(newImporter));
      if (next === spec) continue;
      out = out.slice(0, start) + next + out.slice(end);
      changes.push({ spec, next, to: resolvedPath });
    }
    if (changes.length) edits.set(file, { text: out, changes });
  }
  return { edits, table, errors: problems, moved: table.size };
}

/** Apply: git mv every table entry, then write the planned rewrites. */
export function applyPlan({ table, edits }, view, root = ROOT) {
  const dirs = new Set();
  for (const to of table.values()) dirs.add(posix.dirname(to));
  for (const d of [...dirs].sort()) mkdirSync(nativeJoin(root, d), { recursive: true });
  for (const [from, to] of [...table].sort()) {
    if (!existsSync(nativeJoin(root, from))) throw new Error(`apply: ${from} vanished mid-run`);
    execFileSync("git", ["mv", from, to], { cwd: root, stdio: "pipe" });
  }
  for (const [file, { text }] of edits) {
    const at = table.get(file) ?? file;
    writeFileSync(nativeJoin(root, at), text, "utf8");
  }
  return { moved: table.size, rewritten: edits.size };
}

function cli() {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(`--${n}`);
  const value = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const map = JSON.parse(readFileSync(nativeJoin(ROOT, "scripts/move-map.json"), "utf8"));
  const onlyBatch = value("batch") === undefined ? undefined : Number(value("batch"));
  const { edits, table, errors, moved } = planRewrites(map, diskView, { onlyBatch });
  const rows = [];
  for (const [file, { changes }] of [...edits].sort())
    for (const c of changes) rows.push({ file, spec: c.spec, next: c.next, resolvesTo: c.to });

  if (flag("json")) {
    const p = value("json");
    if (!p || p.startsWith("--")) {
      console.error("--json needs an output path, e.g. --json scratch/batch4.json");
      process.exitCode = 2;
      return;
    }
    writeFileSync(
      p,
      JSON.stringify({ batch: onlyBatch ?? "all", table: [...table], rows, errors }, null, 2),
    );
    console.log(
      `wrote ${p}: ${moved} moves, ${rows.length} specifier rewrites, ${errors.length} problems`,
    );
  }
  if (!flag("json") || flag("verbose")) {
    console.log(
      `batch=${onlyBatch ?? "all"} moves=${moved} rewrites=${rows.length} problems=${errors.length}`,
    );
    for (const r of rows) console.log(`  ${r.file}\n    ${r.spec}  ->  ${r.next}`);
  }
  if (errors.length) {
    console.error("\nFAIL CLOSED — unresolved path hazards, --apply refused:");
    for (const e of errors) console.error("  " + e);
    process.exitCode = 1;
    return;
  }
  if (flag("apply")) {
    if (!flag("yes")) {
      console.error("\n--apply needs --yes as well. Nothing was moved.");
      process.exitCode = 1;
      return;
    }
    const r = applyPlan({ table, edits }, diskView);
    console.log(`\napplied: ${r.moved} files moved, ${r.rewritten} files rewritten`);
  }
}

if (process.argv[1] && norm(process.argv[1]).endsWith("scripts/move-tree.mjs")) cli();
