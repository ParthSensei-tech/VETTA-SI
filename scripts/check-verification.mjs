#!/usr/bin/env node
/**
 * npm run check:verification — the five rules this feature is made of, as a
 * build gate rather than as prose in a header comment.
 *
 * The product promise is that a verdict is defensible: it came from arithmetic
 * or from a registry, never from a model, and it did not touch how the candidate
 * was ranked. Those promises are currently held up by comments and by the good
 * intentions of whoever edits this next, which is not a thing a promise survives.
 * Each rule below is a pattern over the scanned tree, and the probes at the
 * bottom prove every pattern still fires — the failure mode of a grep-shaped rail
 * is silently matching nothing while looking like a green build, and this repo
 * has already been bitten by exactly that in `eslint.config.mjs`.
 *
 *  1. The deciding core is pure. Nothing under `verification/domain/` may reach
 *     the filesystem, the network, the environment or the database. That is what
 *     makes a verdict re-computable years later, and what keeps a model
 *     structurally unable to accuse anyone.
 *  2. The ledger has one write door. Only `verification/{server,api}/` writes the
 *     verdict tables, because that is where the definitive-check cap lives.
 *  3. The verdict history is append-only. No UPDATE and no DELETE, anywhere.
 *  4. Ranking cannot see verification. No file on the rank path names a verdict
 *     table or the two `applications` columns, and the two features do not import
 *     each other — the veto plumbing in `match-engine` is the obvious temptation.
 *  5. Verification cannot write a rank input, so a flagged resume still ranks
 *     exactly as it did before the check existed.
 *
 * Exit 0 = clean, 1 = violations, 2 = the checker itself is blind.
 */
import { diskView, isCodeFile } from "./move-tree.mjs";
import { isMainModule } from "./with-app-env.mjs";

/** The columns that decide where a candidate sits. Verification may not write them. */
export const RANK_INPUT_COLUMNS = [
  "rank_score",
  "rank_json",
  "rubric_score",
  "rubric_json",
  "rubric_hash",
  "pipeline_status",
  "hard_gates",
  "strict_filter",
  "is_stale",
];

/**
 * What the rank path may not even name.
 *
 * `verification_jobs` is absent on purpose: enqueueing a tier-2 check is the
 * handoff between the two features, and a slate that queued a paid arm must still
 * rank identically to one that did not.
 */
export const VERDICT_READS = [
  "verification_reports",
  "candidate_claims",
  "claim_evidence",
  "verification_verdict_history",
  "verification_checks_cache",
  "verification_status",
  "verification_summary_json",
];

export const VERDICT_TABLES = [
  "verification_reports",
  "candidate_claims",
  "claim_evidence",
  "verification_verdict_history",
];

/** Tables whose rows are decided once and never amended, by any caller at all. */
const IMMUTABLE_ROWS = new Set([
  "claim_evidence",
  "candidate_claims",
  "verification_verdict_history",
]);

const LEDGER_DOOR = /^src\/features\/verification\/(server|api)\//;
const DECIDING_CORE = /^src\/features\/verification\/domain\//;
const VERIFICATION_TREE = /^src\/features\/verification\//;
const RANK_PATH = /^src\/features\/(ranking|recruiting\/domain)\//;

/**
 * An I/O module reached any of the three ways it can be reached.
 *
 * `import("node:fs")` is the one that matters: a static import is visible in a
 * diff and blocked by the lint rail, a dynamic one is neither, and the whole
 * purity claim rests on the deciding core being unable to look at the world.
 */
const IO_MODULE = "fs|net|dns|tls|http|https|child_process|worker_threads|os|readline|module";
const IMPORTED_IO = new RegExp(`(?:from|require\\(|import\\()\\s*["']node:(${IO_MODULE})["']`);

/**
 * Drop comments, keep strings.
 *
 * Every rule here is currently *described* in a comment that names the very
 * tokens it forbids — `ledger.server.ts` explains the rank columns by listing
 * them, and `tier-a.ts` quotes the import rails in prose. A scanner that read
 * that as a violation trains people to reach for a suppression flag.
 */
export function stripComments(code) {
  let out = "";
  let i = 0;
  let quote = "";
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = "";
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // A `'` or `"` with no partner on the line is a regex literal or prose, not
      // a string; entering string mode there would desync the rest of the file.
      if (ch !== "`") {
        const lineEnd = code.indexOf("\n", i);
        const until = lineEnd === -1 ? code.length : lineEnd;
        const close = code.indexOf(ch, i + 1);
        if (close === -1 || close > until) {
          out += ch;
          i += 1;
          continue;
        }
      }
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** The bodies of `sql`…`` templates, lowercased: where every SQL rule lives. */
export function sqlText(code) {
  return [...code.matchAll(/`([^`]*)`/gs)]
    .map((m) => m[1])
    .join("\n")
    .toLowerCase();
}

/**
 * One file in, the findings out.
 *
 * Pure and exported so `check-verification.test.mjs` can hand it a violation
 * instead of having to commit one to the tree to prove the rail still works.
 */
export function scanFile({ path, source }) {
  const findings = [];
  const code = stripComments(source);
  const isTest = /\.test\.tsx?$/.test(path);
  const add = (rule, message) => findings.push({ path, rule, message });

  // 1 — the deciding core is pure.
  if (DECIDING_CORE.test(path) && !isTest) {
    const io = IMPORTED_IO.exec(code);
    if (io)
      add(
        "purity",
        `imports node:${io[1]}, so a verdict is only as reproducible as the machine it ran on`,
      );
    if (/\bfetch\s*\(/.test(code))
      add("purity", "calls fetch(), which puts the open web inside a verdict");
    if (/\bprocess\.env\b/.test(code))
      add("purity", "reads process.env, so one document can grade two ways");
    if (/from\s+["'][^"']*\.server(\.ts)?["']/.test(code))
      add("purity", "imports a .server module from the pure side");
    if (/\bgetSql\b/.test(code)) add("purity", "reaches the database from the pure side");
  }

  // 2 and 3 — one write door, immutable rows, append-only history.
  const sql = sqlText(code);
  const WRITE_RE = /\b(insert\s+into|update|delete\s+from)\s+([a-z_]+)\b/g;
  for (const match of sql.matchAll(WRITE_RE)) {
    const [, verb, name] = match;
    if (!VERDICT_TABLES.includes(name)) continue;
    const kind = verb.startsWith("insert") ? "inserts into" : `${verb.toUpperCase()} on`;
    if (kind !== "inserts into") {
      if (name === "verification_verdict_history") {
        add(
          "append-only",
          `${kind} ${name}: a past verdict has to stay re-readable after the rules change`,
        );
        continue;
      }
      if (IMMUTABLE_ROWS.has(name)) {
        add("write-door", `${kind} ${name}: a verdict is written once and never amended`);
        continue;
      }
    }
    if (!LEDGER_DOOR.test(path)) {
      add("write-door", `${kind} ${name} without going through insertEvidence()/ensureReport()`);
    }
  }

  // 4 — ranking cannot see verification, in either direction.
  // The specifier is matched by its feature segment, not by `src/features/…`,
  // because half of this tree imports its neighbours relatively and a rail that
  // only understands absolute paths lets the coupling in through `../`.
  if (RANK_PATH.test(path) && !isTest) {
    const seen = VERDICT_READS.filter((name) => new RegExp(`\\b${name}\\b`).test(code));
    if (seen.length)
      add("rank-firewall", `names ${seen.join(", ")}: verification is displayed, never ranked on`);
    if (/from\s+["'][^"']*\/verification\//.test(code)) {
      add("rank-firewall", "imports the verification feature into the rank path");
    }
  }
  if (VERIFICATION_TREE.test(path) && !isTest) {
    if (/from\s+["'][^"']*\/(ranking|recruiting)\//.test(code)) {
      add(
        "rank-firewall",
        "imports the ranking feature; the two are display neighbours, not collaborators",
      );
    }
  }

  // 5 — verification cannot write a rank input.
  if (VERIFICATION_TREE.test(path) && !isTest) {
    const columns = RANK_INPUT_COLUMNS.filter((name) => new RegExp(`\\b${name}\\b`).test(code));
    if (columns.length)
      add(
        "rank-inputs",
        `mentions ${columns.join(", ")} in code: the ledger writes its own two columns`,
      );
  }

  return findings;
}

/**
 * Prove each rule still fires, and that a compliant file stays clean.
 *
 * These run on every invocation, not only in a `--probes` mode someone forgets
 * to pass: a rail that nobody can demonstrate failing is not evidence of
 * anything, and three of the five rules guard against exactly one future commit.
 */
export const PROBES = [
  {
    rule: "purity",
    path: "src/features/verification/domain/probe.ts",
    source: `import { readFileSync } from "node:fs";\nexport const x = () => fetch("https://a");\nreadFileSync;`,
  },
  {
    rule: "purity",
    path: "src/features/verification/domain/probe.ts",
    source: `const bytes = await import("node:fs").then((m) => m.readFileSync);export default bytes;`,
  },
  {
    rule: "purity",
    path: "src/features/verification/domain/probe.ts",
    source: `import { getSql } from "../../../platform/db.ts";\nexport async function p() { await getSql(); }`,
  },
  {
    rule: "write-door",
    path: "src/features/recruiting/api/probe.ts",
    source: "const q = sql`insert into claim_evidence (id) values (1)`;\nexport default q;",
  },
  {
    rule: "write-door",
    path: "src/features/verification/api/probe.ts",
    source: "const q = sql`update claim_evidence set status = 'verified'`;\nexport default q;",
  },
  {
    rule: "append-only",
    path: "src/features/verification/server/probe.ts",
    source:
      "const q = sql`delete from verification_verdict_history where org_id = 'x'`;\nexport default q;",
  },
  {
    rule: "rank-firewall",
    path: "src/features/ranking/domain/probe.ts",
    source: "const s = `select headline from verification_reports where 1=1`;\nvoid s;",
  },
  {
    rule: "rank-firewall",
    path: "src/features/ranking/domain/probe.ts",
    source: `export { runVerification } from "../../verification/server/ledger.server.ts";`,
  },
  {
    rule: "rank-firewall",
    path: "src/features/verification/server/probe.ts",
    source: `export { rankCandidates } from "../../ranking/server/deepen.server.ts";`,
  },
  {
    rule: "rank-inputs",
    path: "src/features/verification/server/probe.ts",
    source:
      "const q = sql`update applications set rank_score = 0 where id = 'x'`;\nexport default q;",
  },
];

/** A file that must never be flagged, so the rules cannot be widened into noise. */
export const CLEAN_PROBE = {
  path: "src/features/verification/server/ledger.server.ts",
  source: [
    "// The rank columns (rank_score, pipeline_status) are never touched here.",
    'import { CHECK_REGISTRY } from "../domain/checks/registry.ts";',
    "const a = sql`insert into claim_evidence (id, status) values (1, 'verified')`;",
    "const b = sql`update verification_reports set status = 'completed' where id = 1`;",
    "const c = sql`insert into verification_verdict_history (id) values (1)`;",
    "const d = sql`select quote from candidate_claims where report_id = 1`;",
    "export { a, b, c, d, CHECK_REGISTRY };",
  ].join("\n"),
};

export function probeRules() {
  const failures = [];
  for (const probe of PROBES) {
    const found = scanFile({ path: probe.path, source: probe.source });
    if (!found.some((f) => f.rule === probe.rule)) {
      failures.push(`rule "${probe.rule}" did not fire on its probe — the pattern matches nothing`);
    }
  }
  const clean = scanFile(CLEAN_PROBE);
  if (clean.length) failures.push(`a compliant ledger file was flagged: ${JSON.stringify(clean)}`);
  return failures;
}

export function checkAll(files) {
  return files.flatMap(scanFile);
}

function main() {
  let files;
  try {
    files = diskView
      .list("src")
      .filter((p) => isCodeFile(p) && /\.(ts|tsx)$/.test(p))
      .map((p) => ({ path: p, source: diskView.read(p) }));
  } catch (err) {
    console.error(`[check:verification] could not read the tree: ${err.message}`);
    process.exit(2);
  }

  const blind = probeRules();
  const findings = checkAll(files);

  // A rail that scanned nothing passed nothing.
  const covered = {
    verification: files.filter((f) => VERIFICATION_TREE.test(f.path)).length,
    "rank path": files.filter((f) => RANK_PATH.test(f.path)).length,
    "pure core": files.filter((f) => DECIDING_CORE.test(f.path) && !/\.test\./.test(f.path)).length,
  };
  for (const [name, count] of Object.entries(covered)) {
    if (count === 0)
      blind.push(`no ${name} files were scanned — the rail is guarding an empty glob`);
  }

  for (const message of blind) console.error(`[check:verification] rail is blind: ${message}`);
  for (const f of findings)
    console.error(`[check:verification] ${f.rule}: ${f.path}: ${f.message}`);

  if (blind.length) process.exit(2);
  if (findings.length) {
    console.error(
      `\n[check:verification] ${findings.length} violation(s). The rules and the reasons are in the ` +
        "header of this file. If one is genuinely wrong for a capability you are adding, change the " +
        "rule and say why in the commit message — never suppress a finding.",
    );
    process.exit(1);
  }
  console.log(
    `[check:verification] ${files.length} files: pure core, single write door, append-only history, ` +
      `rank firewall and rank-input ban all hold (${covered.verification} verification, ` +
      `${covered["rank path"]} rank-path, ${covered["pure core"]} pure-core).`,
  );
}

if (isMainModule(import.meta.url)) main();
