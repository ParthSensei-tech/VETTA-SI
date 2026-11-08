import assert from "node:assert/strict";
import test from "node:test";
import {
  CLEAN_PROBE,
  PROBES,
  RANK_INPUT_COLUMNS,
  VERDICT_READS,
  checkAll,
  probeRules,
  scanFile,
  sqlText,
  stripComments,
} from "./check-verification.mjs";

/**
 * The rails over the verification feature have to be tested harder than the
 * feature: a check that never fires is indistinguishable from a clean codebase,
 * and every one of these five rules exists to stop one future commit.
 */

test("the probes prove each rule still fires, and a real ledger file stays clean", () => {
  assert.deepEqual(probeRules(), []);
  assert.ok(PROBES.length >= 8, "a rule added without a probe is a rule nobody can show working");
  const rules = new Set(PROBES.map((p) => p.rule));
  assert.deepEqual([...rules].sort(), [
    "append-only",
    "purity",
    "rank-firewall",
    "rank-inputs",
    "write-door",
  ]);
  assert.equal(scanFile(CLEAN_PROBE).length, 0, CLEAN_PROBE.source);
});

test("stripComments removes prose and keeps code, including prose that names forbidden columns", () => {
  const src = [
    "// rank_score and pipeline_status are never written here.",
    "/* verification_reports is the table above */",
    "export const q = sql`update verification_reports set status = 'completed'`;",
    "export const re = /from\\s+[\"']node:(fs|net)[\"']/;",
  ].join("\n");
  const out = stripComments(src);
  assert.ok(!out.includes("never written here"));
  assert.ok(!out.includes("the table above"));
  assert.ok(out.includes("update verification_reports"), "the SQL body must survive");
  // A regex literal's quote must not be mistaken for the start of a string, or
  // everything after it in the file is read as one and the rules go blind.
  assert.ok(out.includes("node:(fs|net)"), out);
});

test("the SQL scan sees template bodies and ignores the surrounding JavaScript", () => {
  assert.match(
    sqlText("const q = sql`INSERT INTO Claim_Evidence (id) values (1)`;"),
    /insert\s+into claim_evidence/,
  );
  assert.doesNotMatch(sqlText("claim_evidence = 'a variable'"), /insert into/);
});

test("purity: the deciding core may not reach the world", () => {
  const cases = [
    `import dns from "node:dns";\nexport const x = dns;`,
    `export const load = async (p) => (await import("node:fs")).readFileSync(p);`,
    `const r = await fetch("https://registry.example");\nexport default r;`,
    `const key = process.env.REGISTRY_TOKEN;\nexport default key;`,
    `import { getSql } from "../../../platform/db.ts";\nexport async function f() { return getSql(); }`,
    `import { runVerification } from "../server/ledger.server.ts";\nexport default runVerification;`,
  ];
  for (const source of cases) {
    const findings = scanFile({
      path: "src/features/verification/domain/checks/tier-b.ts",
      source,
    });
    assert.ok(
      findings.some((f) => f.rule === "purity"),
      source,
    );
  }
  // The same code one folder over is the server tier, where it is the job description.
  assert.equal(
    scanFile({ path: "src/features/verification/server/registry.server.ts", source: cases[2] })
      .length,
    0,
  );
  // And a test next door is allowed to import the world.
  assert.equal(
    scanFile({ path: "src/features/verification/domain/claims.test.ts", source: cases[0] }).length,
    0,
  );
});

test("the write door and the append-only history are enforced per table", () => {
  const insert = "const q = sql`insert into claim_evidence (id) values (1)`;";
  assert.equal(
    scanFile({ path: "src/features/verification/server/ledger.server.ts", source: insert }).length,
    0,
  );
  for (const path of [
    "src/features/recruiting/api/slate-api.ts",
    "src/features/pipeline/server/queue.server.ts",
    "src/routes/api/verification.ts",
  ]) {
    assert.ok(
      scanFile({ path, source: insert }).some((f) => f.rule === "write-door"),
      path,
    );
  }
  // An evidence row is never amended, not even by the ledger that wrote it.
  for (const source of [
    "const q = sql`update claim_evidence set status = 'verified' where id = 1`;",
    "const q = sql`delete from candidate_claims where report_id = 1`;",
  ]) {
    const findings = scanFile({
      path: "src/features/verification/server/ledger.server.ts",
      source,
    });
    assert.ok(
      findings.some((f) => f.rule === "write-door"),
      source,
    );
  }
  // The history table gets its own rule name, because the reason differs.
  const purge = scanFile({
    path: "src/features/verification/server/ledger.server.ts",
    source: "const q = sql`delete from verification_verdict_history where created_at < now()`;",
  });
  assert.ok(purge.some((f) => f.rule === "append-only"));
  // Reads are never a finding: the ledger reads its own tables constantly.
  assert.equal(
    scanFile({
      path: "src/features/verification/server/ledger.server.ts",
      source: "const q = sql`select status from claim_evidence where report_id = 1`;",
    }).length,
    0,
  );
});

test("the rank firewall holds in both directions and on both spellings", () => {
  const cases = [
    [
      "src/features/ranking/domain/match-engine.ts",
      "const q = sql`select headline from verification_reports`;",
    ],
    [
      "src/features/ranking/server/deepen.server.ts",
      "const s = applications.verification_summary_json;",
    ],
    [
      "src/features/ranking/ui/candidate-panel.tsx",
      `export { x } from "../../verification/domain/adjudicate.ts";`,
    ],
    [
      "src/features/verification/ui/verdict-chip.tsx",
      `export { rankCandidates } from "../../ranking/server/deepen.server.ts";`,
    ],
  ];
  for (const [path, source] of cases) {
    assert.ok(
      scanFile({ path, source }).some((f) => f.rule === "rank-firewall"),
      `${path}: ${source}`,
    );
  }
  // The job table is the allowed handoff: queueing a paid arm must not change a rank.
  assert.equal(
    scanFile({
      path: "src/features/pipeline/server/queue.server.ts",
      source: "const q = sql`insert into verification_jobs (id, status) values (1, 'queued')`;",
    }).length,
    0,
  );
  // And a UI file outside the rank path may render a verdict — that is the point.
  assert.equal(
    scanFile({
      path: "src/features/recruiting/ui/slate-table.tsx",
      source: "const v = application.verification_status;",
    }).length,
    0,
  );
});

test("verification may not write a rank input, and no rule bans the words outright", () => {
  const findings = scanFile({
    path: "src/features/verification/server/ledger.server.ts",
    source:
      "const q = sql`update applications set rank_score = 0, pipeline_status = 'rejected' where id = 1`;",
  });
  assert.ok(findings.some((f) => f.rule === "rank-inputs"));
  assert.equal(
    findings.filter((f) => f.rule === "rank-inputs").length,
    1,
    "one finding, not one per column",
  );
  // The same sentence in prose is documentation, which is how the rule is explained.
  assert.equal(
    scanFile({
      path: "src/features/verification/server/ledger.server.ts",
      source: "// Nothing here writes rank_score, and nothing ever will.",
    }).length,
    0,
  );
  // The rank path is allowed to talk about its own columns.
  assert.equal(
    scanFile({
      path: "src/features/ranking/server/deepen.server.ts",
      source: "const q = sql`update applications set rank_score = 88 where id = 1`;",
    }).length,
    0,
  );
});

test("the table list is the schema's, and the queue table stays legal", async () => {
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync(
    new URL("../migrations/0027_verification_ledger.sql", import.meta.url),
    "utf8",
  );
  const created = [...migration.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(created, [
    "verification_reports",
    "candidate_claims",
    "claim_evidence",
    "verification_verdict_history",
    "verification_jobs",
    "verification_checks_cache",
  ]);
  for (const table of created) {
    if (table === "verification_jobs") {
      assert.ok(
        !VERDICT_READS.includes(table),
        "the queue is the handoff between the features; banning it would forbid the wiring",
      );
      continue;
    }
    assert.ok(VERDICT_READS.includes(table), `${table} is readable by the rank path`);
  }
  assert.deepEqual(
    [...RANK_INPUT_COLUMNS].sort(),
    [...new Set(RANK_INPUT_COLUMNS)].sort(),
    "a duplicated column would double-count a finding",
  );
});

test("checkAll aggregates across files without losing which one failed", () => {
  const findings = checkAll([
    { path: "src/features/verification/domain/x.ts", source: `const f = () => fetch("u");` },
    {
      path: "src/features/ranking/domain/y.ts",
      source: "const v = `select 1 from claim_evidence`;",
    },
    { path: "src/features/ranking/domain/z.ts", source: "export const clean = 1;" },
  ]);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((f) => f.path).sort(), [
    "src/features/ranking/domain/y.ts",
    "src/features/verification/domain/x.ts",
  ]);
});
