// Tests for the restructure codemod. Everything here runs against an in-memory
// view — the codemod's core is pure, so a failing test cannot move a file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname as nativeDirname, join as nativeJoin, resolve as nativeResolve } from "node:path";
import {
  compileTable,
  diskView,
  findSpecs,
  isCodeFile,
  makeResolver,
  planRewrites,
  renderSpec,
} from "./move-tree.mjs";

const ROOT = nativeResolve(nativeDirname(fileURLToPath(import.meta.url)), "..");

export function memView(files) {
  const set = new Set(Object.keys(files));
  const dirs = new Set();
  for (const p of set) {
    let d = p.slice(0, p.lastIndexOf("/"));
    while (d) {
      dirs.add(d);
      d = d.slice(0, d.lastIndexOf("/"));
    }
  }
  return {
    isFile: (p) => set.has(p),
    isDir: (p) => dirs.has(p),
    read: (p) => files[p] ?? "",
    list: (p) => [...set].filter((f) => f.startsWith(p + "/")).sort(),
    looseFiles: [],
  };
}

const mapOf = (moves, keep = {}) => ({ moves, keep });

// --- resolution: the six forms a specifier arrives in ------------------------
test("resolver: alias, bare relative, extension, index dir, root-absolute, non-local", () => {
  const view = memView({
    "src/lib/db.ts": "",
    "src/lib/auth/index.ts": "",
    "src/components/app-shell.tsx": "",
    "src/lib/recruiting/ai.server.ts": "",
    "scripts/migration-plan.mjs": "",
  });
  const r = makeResolver(view);
  assert.equal(r("@/lib/db", "src/routes/app").file, "src/lib/db.ts");
  assert.equal(r("./db", "src/lib").file, "src/lib/db.ts");
  assert.equal(r("./ai.server", "src/lib/recruiting").file, "src/lib/recruiting/ai.server.ts");
  assert.equal(r("./ai.server.ts", "src/lib/recruiting").file, "src/lib/recruiting/ai.server.ts");
  assert.equal(r("./auth", "src/lib").file, "src/lib/auth/index.ts");
  assert.equal(r("/src/lib/db.ts", ".").file, "src/lib/db.ts");
  assert.equal(r("src/lib/db.ts", ".").file, "src/lib/db.ts");
  assert.equal(r("../../scripts/migration-plan.mjs", "src/lib").file, "scripts/migration-plan.mjs");
  assert.equal(r("@tanstack/react-start/server", "src/lib/recruiting"), null);
  assert.equal(r("/migrations/*.sql", "src/lib"), null);
  assert.equal(r("./missing", "src/lib"), null);
  assert.deepEqual(r("./auth", "src/lib"), { file: "src/lib/auth/index.ts", ext: "/index.ts" });
  assert.deepEqual(r("./recruiting", "src/lib"), { file: null, dir: "src/lib/recruiting" });
});

test("findSpecs: quotes, template literals, prose and glob patterns", () => {
  const text = [
    `import a from "@/lib/db";`,
    `const b = await import("../recruiting/api");`,
    `ssrLoadModule('/src/lib/db.ts')`,
    `import.meta.glob("/migrations/*.sql")`,
    `const prefix = "@/";`,
    "const backtick = `@/lib/db`;",
    `// "@lib/db" is not a path`,
  ].join("\n");
  const specs = findSpecs(text).map((s) => s.spec);
  assert.ok(specs.includes("@/lib/db"));
  assert.ok(specs.includes("../recruiting/api"));
  assert.ok(specs.includes("/src/lib/db.ts"));
  assert.ok(specs.includes("@/lib/db"), "template literals are import forms too");
  assert.ok(!specs.includes("/migrations/*.sql"), "glob patterns are not modules");
  assert.ok(!specs.includes("@/"), "a trailing-slash prefix constant is not a module");
  assert.equal(findSpecs(text).find((s) => s.spec === "@/lib/db").imported, true);
});

// --- renderSpec: the author's form is the contract --------------------------
test("renderSpec preserves alias vs relative and the presence of an extension", () => {
  assert.equal(
    renderSpec(
      "@/lib/recruiting/ai.server",
      "src/lib/recruiting/ai.server.ts",
      "src/features/ai/server/ai.server.ts",
      "src/routes/app",
    ),
    "@/features/ai/server/ai.server",
  );
  assert.equal(
    renderSpec("@/lib/db.ts", "src/lib/db.ts", "src/platform/db.ts", "."),
    "@/platform/db.ts",
  );
  assert.equal(
    renderSpec(
      "./api",
      "src/lib/recruiting/api.ts",
      "src/features/recruiting/api/api.ts",
      "src/features/recruiting/api",
    ),
    "./api",
  );
  assert.equal(
    renderSpec(
      "../observability/observability.server",
      "src/lib/observability/observability.server.ts",
      "src/features/pipeline/server/queue.server.ts",
      "src/platform/observability",
    ),
    "../../features/pipeline/server/queue.server",
  );
  assert.equal(
    renderSpec(
      "@/lib/recruiting/harness/index",
      "src/lib/recruiting/harness/index.ts",
      "src/features/eval/harness/index.ts",
      "x",
    ),
    "@/features/eval/harness/index",
  );
});

// --- compileTable: directory semantics and the four refusals ---------------
test("compileTable: file->dir keeps basename, dir->dir nests, file->file honours target", () => {
  const view = memView({
    "src/lib/utils.ts": "",
    "src/lib/auth/client.ts": "",
    "src/lib/auth/server.ts": "",
    "src/components/ui/button.tsx": "",
    "src/components/app-shell.tsx": "",
  });
  const { table, errors } = compileTable(
    mapOf([
      { to: "src/shared/utils.ts", from: ["src/lib/utils.ts"], batch: 4 },
      { to: "src/platform", from: ["src/lib/auth"], batch: 4 },
      {
        to: "src/shared/components",
        from: ["src/components/ui", "src/components/app-shell.tsx"],
        batch: 5,
      },
    ]),
    view,
  );
  assert.deepEqual(errors, []);
  assert.equal(table.get("src/lib/utils.ts"), "src/shared/utils.ts");
  assert.equal(table.get("src/lib/auth/server.ts"), "src/platform/auth/server.ts");
  assert.equal(table.get("src/components/ui/button.tsx"), "src/shared/components/ui/button.tsx");
  assert.equal(table.get("src/components/app-shell.tsx"), "src/shared/components/app-shell.tsx");
});

test("compileTable refuses: double claim, colliding targets, self map, missing source", () => {
  const view = memView({ "src/a/x.ts": "", "src/b/y.ts": "", "src/z/z.ts": "" });
  const cases = [
    [
      mapOf([
        { to: "src/a1", from: ["src/a/x.ts"] },
        { to: "src/a2", from: ["src/a/x.ts"] },
      ]),
      "claimed twice",
    ],
    [
      mapOf([
        { to: "src/a1", from: ["src/a/x.ts"] },
        { to: "src/a1/x.ts", from: ["src/b/y.ts"] },
      ]),
      "would be written by both",
    ],
    [mapOf([{ to: "src/a", from: ["src/a/x.ts"], batch: undefined }]), "maps to itself"],
    [mapOf([{ to: "src/a1", from: ["src/nope/x.ts"] }]), "exists on neither path"],
  ];
  for (const [map, needle] of cases) {
    const { errors } = compileTable(map, view);
    assert.ok(
      errors.some((e) => e.includes(needle)),
      `expected '${needle}' in ${JSON.stringify(errors)}`,
    );
  }
});

// --- the rewrite itself -----------------------------------------------------
const aiMove = [
  { to: "src/features/ai/server", from: ["src/lib/recruiting/ai.server.ts"], batch: 6 },
];

test("regime: alias import in a page route, relative import inside the moved folder, ssrLoadModule", () => {
  const view = memView({
    "src/lib/recruiting/ai.server.ts": `import { db } from "@/lib/db";\nexport const h = () => db;`,
    "src/routes/app/index.tsx": `import { h } from "@/lib/recruiting/ai.server";\nexport default h;`,
    "src/lib/db.ts": `export const db = 1;`,
    "vite.config.ts": `x.ssrLoadModule('/src/lib/recruiting/ai.server.ts')`,
  });
  const map = mapOf([...aiMove, { to: "src/platform", from: ["src/lib/db.ts"], batch: 4 }]);
  const { edits } = planRewrites(map, view, { looseFiles: ["vite.config.ts"] });
  assert.match(
    edits.get("src/routes/app/index.tsx").text,
    /from "@\/features\/ai\/server\/ai\.server"/,
  );
  assert.match(edits.get("vite.config.ts").text, /'\/src\/features\/ai\/server\/ai\.server\.ts'/);
  // The moved file's own alias to a file that moves in the same batch.
  assert.match(edits.get("src/lib/recruiting/ai.server.ts").text, /from "@\/platform\/db"/);
});

test("between-batches trap: a moving file keeps a relative import into a folder that moves later", () => {
  const view = memView({
    "src/lib/recruiting/ai.server.ts": `import { o } from "./org.server";\nexport const h = o;`,
    "src/lib/recruiting/org.server.ts": `export const o = 1;`,
  });
  const { edits } = planRewrites(mapOf(aiMove), view);
  const next = edits.get("src/lib/recruiting/ai.server.ts").text;
  assert.match(
    next,
    /from "@\/lib\/recruiting\/org\.server"/,
    "canonicalised, not left at a broken depth",
  );
  const changes = edits.get("src/lib/recruiting/ai.server.ts").changes;
  assert.equal(changes[0].canonicalised, true);
  // And the canonical form is what the later batch then rewrites for real.
  const after = memView({
    "src/features/ai/server/ai.server.ts": next,
    "src/lib/recruiting/org.server.ts": `export const o = 1;`,
  });
  const second = planRewrites(
    mapOf([
      { to: "src/features/people/server", from: ["src/lib/recruiting/org.server.ts"], batch: 8 },
    ]),
    after,
  );
  assert.deepEqual(second.errors, []);
});

test("a moved file importing OUTSIDE src keeps a relative path — the alias cannot reach it", () => {
  // Batch 4 found this: src/lib/db.ts imports ../../scripts/migration-plan.mjs.
  // Canonicalising that to `@/../scripts/migration-plan.mjs` typechecks (tsc
  // reads @/ as src/) and bundles in Vite, but Node's ESM resolver rejects it
  // as an invalid package specifier — so only `npm test` caught it, 13 files deep.
  const view = memView({
    "src/lib/db.ts": `import { pendingMigrations } from "../../scripts/migration-plan.mjs";\nexport const x = pendingMigrations;`,
    "src/lib/auth/client.ts": `import { runSignOut } from "../../../scripts/sign-out-plan.mjs";\nexport const y = runSignOut;`,
    "scripts/migration-plan.mjs": `export const pendingMigrations = [];`,
    "scripts/sign-out-plan.mjs": `export const runSignOut = 1;`,
  });
  const map = mapOf([
    { to: "src/platform/db.ts", from: ["src/lib/db.ts"], batch: 4 },
    { to: "src/platform", from: ["src/lib/auth"], batch: 4 },
  ]);
  const { edits, errors } = planRewrites(map, view);
  assert.deepEqual(errors, []);
  assert.equal(
    edits.get("src/lib/db.ts"),
    undefined,
    "same depth after the move, so nothing to rewrite",
  );
  assert.equal(edits.get("src/lib/auth/client.ts"), undefined);

  // And when the depth *does* change, the relative path is recomputed, not aliased.
  const deeper = memView({
    "src/lib/db.ts": `import { pendingMigrations } from "../../scripts/migration-plan.mjs";`,
    "scripts/migration-plan.mjs": `export const pendingMigrations = [];`,
  });
  const moved = planRewrites(
    mapOf([{ to: "src/platform/deep/er/db.ts", from: ["src/lib/db.ts"], batch: 4 }]),
    deeper,
  );
  const text = moved.edits.get("src/lib/db.ts").text;
  assert.match(text, /from "\.\.\/\.\.\/\.\.\/\.\.\/scripts\/migration-plan\.mjs"/);
  assert.ok(!text.includes("@/.."), "never emit an alias that escapes src");
  const emitted = /from "([^"]+)"/.exec(text)[1];
  assert.ok(
    makeResolver(deeper)(emitted, "src/platform/deep/er"),
    `and the recomputed path ${emitted} still resolves from the new home`,
  );
});

test("idempotence: rewriting a rewritten file again changes nothing", () => {
  const view = memView({
    "src/lib/recruiting/ai.server.ts": `import { o } from "./org.server"; import { p } from "./privacy.server.ts";\nexport const h = [o, p];`,
    "src/lib/recruiting/org.server.ts": "",
    "src/lib/recruiting/privacy.server.ts": "",
  });
  const map = mapOf(aiMove);
  const first = planRewrites(map, view);
  const moved = memView({
    "src/features/ai/server/ai.server.ts": first.edits.get("src/lib/recruiting/ai.server.ts").text,
    "src/lib/recruiting/org.server.ts": "",
    "src/lib/recruiting/privacy.server.ts": "",
  });
  // Re-running the *same* batch is a no-op: the source is gone, and the only
  // message is the one that says so.
  const again = planRewrites(map, moved);
  assert.equal(again.moved, 0);
  assert.match(again.errors.join(" "), /exists on neither path/);
  // And the canonical specifiers it left behind still resolve from the new home.
  const r = makeResolver(moved);
  for (const { spec } of findSpecs(moved.read("src/features/ai/server/ai.server.ts")))
    if (spec.startsWith("@/"))
      assert.ok(r(spec, "src/features/ai/server"), `${spec} still resolves`);
});

test("a prose mention of a moving folder is not treated as a barrel import", () => {
  const view = memView({
    "src/lib/recruiting/README.md": `See \`src/lib/recruiting\` and \`src/lib/auth\`.`,
    "src/lib/recruiting/harness/x.ts": "",
    "src/lib/auth/client.ts": "",
    "src/routes/app/p.tsx": `const note = "move src/lib/recruiting/harness first";\nexport default note;`,
  });
  const { edits, errors } = planRewrites(
    mapOf([{ to: "src/features/eval", from: ["src/lib/recruiting/harness"], batch: 8 }]),
    view,
  );
  assert.deepEqual(errors, []);
  assert.ok(!edits.has("src/routes/app/p.tsx"), "not in an import position, so untouched");
});

test("a real barrel import of a moving directory is refused", () => {
  const view = memView({
    "src/lib/recruiting/harness/db.ts": "",
    "src/lib/recruiting/api.ts": `import * as h from "./harness";\nexport default h;`,
  });
  const { errors } = planRewrites(
    mapOf([{ to: "src/features/eval", from: ["src/lib/recruiting/harness"], batch: 8 }]),
    view,
  );
  assert.match(errors.join(" "), /no index file/);
});

test("the codemod never rewrites its own spec or its own fixtures", () => {
  const view = memView({
    "scripts/move-map.json": `{"moves":[{"to":"x","from":["src/lib/recruiting/ai.server.ts"]}]}`,
    "scripts/move-tree.test.mjs": `const fixture = "src/lib/recruiting/ai.server.ts";`,
    "src/lib/db.ts": `export const db = 1;`,
  });
  const map = mapOf([
    { to: "src/platform", from: ["src/lib/recruiting/ai.server.ts"], batch: 6 },
    { to: "src/platform", from: ["src/lib/db.ts"], batch: 4 },
  ]);
  const { edits } = planRewrites(map, view, { looseFiles: ["scripts/move-map.json"] });
  assert.ok(!edits.has("scripts/move-map.json"));
  assert.ok(!edits.has("scripts/move-tree.test.mjs"));
  assert.equal(edits.size, 0, "only the machinery referenced these paths");
});

// --- the real map: totality, injectivity and the measured shape -------------

const realMap = JSON.parse(readFileSync(nativeJoin(ROOT, "scripts/move-map.json"), "utf8"));
// The map describes the whole programme; run a batch at a time, the already
// moved sources no longer exist. Trim to what is still on disk so these tests
// stay meaningful from Batch 1 through Batch 10 instead of pinning one state.
const liveMap = () => ({
  keep: realMap.keep,
  moves: realMap.moves
    .map((m) => ({ ...m, from: m.from.filter((f) => diskView.isFile(f) || diskView.isDir(f)) }))
    .filter((m) => m.from.length),
});
const srcFiles = () => diskView.list("src").filter(isCodeFile);

function keepMatch(f, keep) {
  return Object.keys(keep).some((glob) => {
    const base = glob.replace(/\/\*\*\/?\*?$/, "");
    if (glob.includes("**")) return f === base || f.startsWith(base + "/");
    return new RegExp("^" + base.replace(/[.*]/g, (c) => "\\" + c) + "$").test(f);
  });
}

test("the real move-map compiles with no refusals and no colliding targets", () => {
  const { table, errors } = compileTable(liveMap(), diskView);
  assert.deepEqual(errors, []);
  const targets = new Map();
  for (const [from, to] of table) {
    assert.ok(!targets.has(to), `${to} claimed by ${targets.get(to)} and ${from}`);
    targets.set(to, from);
    assert.equal(from.split("/").pop(), to.split("/").pop(), `basename changed: ${from} -> ${to}`);
  }
});

test("the map is total over the files the restructure owns", () => {
  const { table } = compileTable(liveMap(), diskView);
  const owned = srcFiles().filter(
    (f) => f.startsWith("src/lib/") || f.startsWith("src/components/"),
  );
  assert.ok(owned.length > 100, `only ${owned.length} owned files — the scan is broken`);
  for (const f of owned)
    assert.ok(
      table.has(f) || keepMatch(f, realMap.keep),
      `${f} is neither moved nor kept — the map is not total`,
    );
});

test("resolver parity: every extensionless local specifier resolves to .ts/.tsx, which is all the loader hook can do", () => {
  // The hook (scripts/bench-resolve-hooks.mjs:36-50) tries base, base.ts,
  // base.tsx, base/index.ts, base/index.tsx and nothing else. If the codemod
  // ever emits an extensionless specifier whose real file is .mjs or .json, the
  // test process resolves it and the runtime hook does not — so pin agreement.
  const r = makeResolver(diskView);
  let checked = 0;
  for (const f of srcFiles().filter((p) => /\.(ts|tsx)$/.test(p))) {
    for (const { spec } of findSpecs(diskView.read(f))) {
      if (!/^\.\.?\//.test(spec) && !spec.startsWith("@/")) continue;
      if (/\.[a-z]+$/.test(spec)) continue;
      const res = r(spec, f.slice(0, f.lastIndexOf("/")));
      if (!res?.file) continue;
      checked++;
      assert.match(
        res.file,
        /\.tsx?$/,
        `${f}: '${spec}' resolves to ${res.file}, which the loader hook cannot resolve`,
      );
    }
  }
  assert.ok(checked > 200, `only ${checked} extensionless specifiers checked — the scan is broken`);
});
