# Vetta — Architecture Analysis (Phase 5 output, deliverable B)

Analysis only. **No file was moved.** The recommendation at the end is deliberately *not* to do a
large-scale reorganisation in this pass, with the evidence that justifies that call and the cheaper
sequence that gets the same benefit later.

---

## 1. Original tree (as it stands, `.bak` excluded)

```
rp1RKbTXMmwGpqUp-grok-workspace/
├── AGENTS.md  README.md  startup.sh  vercel.json            # platform + restart contract
├── package.json  package-lock.json  tsconfig.json  vite.config.ts  eslint.config.mjs  .prettierrc
├── .env.example                                             # 34 var names, frozen
├── migrations/            26 *.sql + auth/0001_base.sql     # applied by glob on both backends
├── server/middleware/     grok-pwa.ts                       # platform chrome — protected
├── public/                __grok/ (protected), icons, manifest
├── scripts/               migrate, with-app-env, check-auth-invariant, browser-smoke,
│                          preview, bench-live-arms, apply-200-candidates, replay-router-clock, …
├── docs/                  pricing-tiers.md + audit/ (this set)
├── attachments/ 91 MB │ .output/ 90 MB │ screenshots/ │ artifacts/ │ scratch/ │ *.log │ {}
└── src/
    ├── router.tsx  routeTree.gen.ts  styles.css             # entry points
    ├── routes/            19 files  (app/9, api/3+auth+queue+whatsapp, jobs, apply, portal, login, share, screen)
    ├── components/        21 + ui/17                         # client surface
    └── lib/
        ├── db.ts  env.server.ts  utils.ts  theme.ts  error-component.tsx
        ├── auth/          19   Better Auth, gate identity/session, isolation, pglite-dialect
        ├── observability/ 5    cost model, access logger, event log, desk queries
        ├── app-data/      11   viewer-connector plumbing (+ dead barrel)
        ├── og/            1    site.json
        ├── multiplayer/   2    WebRTC scaffold island (dead)
        └── recruiting/    101  ← everything product-shaped   (100 after Batch 3 removed seed.ts)
            ├── benchmark/ 2   harness/ 4
            ├── 30 *.server.ts   (I/O)
            ├── 19 *.test.ts
            ├── 11 *-api.ts      (createServerFn wrappers)
            ├──  2 api.ts        (bare — recruiting/api.ts, harness/api.ts)
            └── 38 plain .ts     (mostly pure domain; includes harness/server.ts + benchmark/phases.ts)
```

> **Count correction (found writing the Batch 6 README).** This tree originally read **97**, from the
> four-bucket breakdown 30 + 19 + 11 + 37. That arithmetic silently dropped three files that do not
> match the suffix they were counted by: `recruiting/api.ts` and `harness/api.ts` (wrappers named
> without the `-api` prefix) and `harness/server.ts` (I/O named without the `.server` suffix). The
> verified total is 101 before / 100 after Batch 3, and `npm run lint` agrees — 231 files linted, same
> before and after. The convention-breaking files are listed in §2's erratum and documented in
> `src/lib/recruiting/README.md`.

## 2. The finding that changes the recommendation

Before proposing a tree I tested whether the current one actually holds its layering. It does —
mechanically, by naming convention, with **zero violations found**:

| Rule | Test | Result |
| --- | --- | --- |
| Client must not import server-only modules | `grep 'from "@/lib/recruiting/*.server"' src/components` | **0 files** |
| Pure domain must not import I/O | every plain `.ts` in `recruiting/` scanned for `from "./….server"` | **0 files** |
| Server-only access goes through a `*-api.ts` wrapper | `recruiting/api.ts` contains 22 `.server` imports; its consumers are 4 client files | holds |
| Routes may touch server code only in loaders/API routes | `src/routes/**` | only `api/queue/tick.ts` and a **dynamic** `await import("@/lib/auth/verify.server")` inside `__root.tsx:13`'s server function |

So the pain in this repo is **not** an architecture that has rotted — the boundaries are real and
respected. The pain is that the boundaries are encoded in a *filename suffix* inside one 100-file
directory, and that nothing (no CI, no lint rule, no folder) enforces them. A new recruiter-feature
author learns the convention by reading, and a mistake is invisible until runtime.

That reframes Phase 5: the maintainability win is in **making the existing convention enforced and
navigable**, not in relocating 100 files whose relative order is already correct.

> **Erratum, found while writing the Batch 6 rules (row 2 is narrower than it reads).**
> "Pure domain must not import I/O — 0 files" is true only of **static** imports, which is what that
> grep looked at. Plain domain files do reach I/O, and they reach it *on purpose*: **56 `await
> import("./….server")` sites across 8 files** — `batch.ts` (12), `benchmark/phases.ts` (10),
> `screen-session.ts` (9), `share.ts` (8), `labels.ts` (6), `portal.ts` (5), `live-pipeline.ts` (3),
> `harness/server.ts` (3) — plus ~20 more in `api.ts` itself, which is the wrapper tier and allowed.
> The split is therefore not "pure files never touch the DB" — it is "pure files touch it lazily, so
> importing them into the client bundle or a unit test stays cheap". That is a defensible design, but
> it is a different design, and a lint rule written against the sentence above would have fired 56
> times. Also: three server-side files are named by **folder**, not suffix (`harness/server.ts`,
> `harness/api.ts`, `benchmark/phases.ts`), which the `*.server.ts` / `*-api.ts` globs miss —
> `src/lib/auth/server.ts` and `src/routes/api/queue/tick.ts` are the same shape outside
> `recruiting/`.
>
> **What actually got frozen (Batch 6).** Two `no-restricted-imports` rules plus one
> `no-restricted-syntax` rule, each scoped to a boundary measured at zero violations, are now in
> `eslint.config.mjs`; `src/lib/recruiting/README.md` states the kinds and the direction. The
> lazy-`await import` behaviour is deliberately left legal — see the README's rule 3. Probing the
> rules before trusting them: `no-restricted-imports` does **not** inspect `await import()`, so the
> client-side rule needed `no-restricted-syntax` to close that vector (`__root.tsx:13` is exactly
> that shape, inside a server function, and is not a violation).

## 3. Logical domain boundaries — mapping to what exists today

The brief's 15 boundaries, each mapped to the files that actually carry it. "Owner" here means the
module a change to that domain starts in.

| Domain | Carried today by | Boundary quality |
| --- | --- | --- |
| Auth & authorization | `lib/auth/*` (19), `recruiting/rbac.{ts,server.ts}` | clean split — *policy* in `rbac.ts` (pure), *enforcement* in `rbac.server.ts` |
| Organizations / tenancy | `recruiting/org.server.ts`, `auth/isolation.server.ts`, `tenant-isolation.test.ts` | clean, small |
| Recruitment / job mgmt | `recruiting/api.ts` (roles), `role-form.tsx`, `rubric*.ts` (5 files) | rubric is a sub-domain hiding inside a flat list |
| Candidate management | `recruiting/query.ts`, `talent-pool.server.ts`, `duplicates.server.ts`, `candidate-panel.tsx` | clean |
| Resume ingestion & parsing | `recruiting/parse.server.ts`, `pdf.ts`, `resume-file.ts`, `sheet.ts`, `batch*.ts`, `normalize-screen.ts` | clean; the only place with 4 file-format branches |
| AI processing & providers | `recruiting/ai.server.ts`, `ai-retry.server.ts`, `ai-schema.ts`, `providers.server.ts`, `model-registry.ts`, `model-router.{ts,server.ts}` | **two generations coexist** (ladder + router) |
| Search & retrieval | `recruiting/search.server.ts`, `retrieve.ts`, `dedicated-search.server.ts`, `semantic-indexing.test.ts` | two search implementations, both live |
| Matching & ranking | `match-engine.ts`, `local-rank.ts`, `prescreen.ts`, `deepen.server.ts`, `rank-cache.server.ts` | the actual product core; pure + testable |
| Screening & assessments | `screen-session.ts`, `portal.ts`, `autonomous-portal.server.ts`, `normalize-screen.ts` | clean |
| Client collaboration / sharing | `collaboration.server.ts`, `share.ts`, `send-to-client-dialog.tsx`, `team-api.ts` | partially wired (team surface unwired) |
| Notifications | `routes/api/whatsapp/*` only | thin, fine |
| Analytics & reporting | `funnel-analytics.{ts,server.ts}`, `observability/*`, `outcome.*` | clean |
| Background processing / queues | `queue.server.ts`, `embedding-queue.server.ts`, `concurrency.{ts,server.ts}`, `routes/api/queue/tick.ts` | clean, but 3 process-global seams |
| Database infrastructure | `lib/db.ts`, `auth/pglite-dialect.ts`, `migrations/*`, `scripts/migrate.mjs` | clean; **dual-backend** is the constraint to respect |
| Observability & audit | `observability.server.ts`, `access-logger.server.ts`, `rank-provenance.test.ts` | clean |
| Consent / privacy / retention | `privacy.{ts,server.ts}`, `privacy-api.ts` | live server side, unwired client surface |

No domain needs a new module. Every one of them is already in files that belong together — they are
just not *grouped*.

## 4. Proposed structure — target, not this pass

```
src/lib/recruiting/
├── domain/          pure logic, no I/O: match-engine, local-rank, prescreen, retrieve, rubric-types,
│                    rubric-guardrails, model-router.ts, cost maths re-export, labels, origin, hash
├── ai/              providers.server, ai.server, ai-retry.server, ai-schema, model-registry,
│                    model-router.server, embed-text.server, domain-embed.*
├── ingest/          parse.server, pdf, resume-file, sheet, batch*, normalize-screen
├── ranking/         deepen.server, rank-cache.server, calibrate*, outcome*
├── pipeline/        queue.server, embedding-queue.server, concurrency.*, search.server, dedicated-search.server
├── people/          org.server, rbac.*, privacy.*, talent-pool.server, duplicates.server, collaboration.server,
│                    assignments.server, share, portal, autonomous-portal.*, screen-session
├── analytics/       funnel-analytics.*, observability-api
├── api/             the *-api.ts wrappers only  ← the single client-facing edge of the domain
└── *.test.ts        beside the module they test
```

Rules that make it worth having (and that are already true today):

1. **Dependency direction, one way:** `routes → components → api/ → {ai,pipeline,ranking,people,analytics} → domain → lib/{db,auth,observability}`. Nothing in `domain/` may import from a sibling folder. This is the current behaviour, promoted from convention to structure.
2. **Client/server separation by folder, not suffix:** anything under `api/` is `createServerFn`; anything importing it is client code; `domain/` is isomorphic. The suffix rule survives as a lint assertion, which is the part that actually prevents regressions.
3. **Shared infrastructure stays put** (`lib/db.ts`, `lib/auth/`, `lib/observability/`, `lib/utils.ts`). It is already correctly depended-upon and never depends on a domain.
4. **`lib/` must not import from `routes/` or `components/`** — true today, and the one rule worth putting in `eslint.config.mjs` immediately.

## 5. Why the move is deferred

> **Superseded 2026-11-07, on purpose — the reasoning stays as written.** Point 2 below was the load-bearing
> premise, and `git init` (restructure Batch 0) removed it: a revertible batch is a different risk class from
> a tar.gz. The move has since been executed as its own programme — feature-modular monolith, one commit per
> batch, `npm run check:tree` as the restructure's gate — so the tree described in §3–§4 and the paths in the
> rest of this file are the *pre-move* tree. Read §6 as history. Point 4 aged well: `live-pipeline.ts` is
> still parked in `src/lib/recruiting/`, undecided, exactly the wasted risk this section predicted.

1. The brief's own condition: *"Do not perform large-scale file movement unless the resulting structure offers a demonstrable maintainability benefit."* §2 shows the benefit of moving is **~0 for correctness** (0 violations today) and **modest for navigation** (one flat list becomes seven). The benefit of *enforcing* is large and costs one lint rule.
2. **There is no git.** Every `git mv` here is a copy + delete + 60 import rewrites with no `git diff -M` and no bisectable rollback; the safety net is a 97 MB tar.gz. A 100-file move under those conditions is exactly the "plausibly affects product behaviour" case the brief says to stop and report.
3. Rewriting imports touches `routeTree.gen.ts`-adjacent files, `tsconfigPaths` resolution, `.server.ts` runtime gating and the `npm test` whitelist — four mechanisms where a typo is a silent runtime failure, not a compile error. `getSql()` and the `*-api.ts` reachability rule both fail *quietly*.
4. Order of operations: delete the proven-dead first (Batches 1–4), *then* group what remains. Moving `live-pipeline.ts` into `pipeline/` and deleting it two weeks later is wasted risk.

## 6. What I do recommend structurally, now (cheap, no file movement)

| Step | Change | Cost | Benefit | Status |
| --- | --- | --- | --- | --- |
| S1 | Two ESLint rules: `no-restricted-imports` for `**/*.server` from `src/components/**`, and `no-restricted-modules` forbidding `@/lib/recruiting/*` from `src/lib/*` | 1 config file | Freezes the 0-violation state §2 measured; this is the enforcement the architecture is missing | **Done, differently.** The two rules as sketched would each have fired (`harness/server.ts` is a legal static server import; `observability.server.ts` lazily imports `../recruiting/queue.server.ts` twice to break a cycle). Landed instead: client→server (components + page routes, static *and* lazy) and `src/lib`→outward. 0 violations, proven to fire by probe files (§2 erratum). |
| S2 | One README in `src/lib/recruiting/` naming the four file kinds and the direction rule | 1 file | Replaces the "learn by reading 100 files" onboarding | **Done** — `src/lib/recruiting/README.md` |
| S3 | Rename-by-adding-alias, not moving: keep paths, and let new modules start in the §4 subfolders | 0 | Structure grows where work happens instead of being imposed on 100 unchanged files | Deferred (policy, not code) |
| S4 | Collapse the 5 §3.D/E dead `*-api.ts` decision into one of: wire them, or move them to `docs/audit/wishlist` notes | decision | Removes the "uncallable surface" class entirely | **Awaiting approval** (gate item 2) |
| S5 | Extend `npm test` to all suites | 1 line | The architecture stops being unverifiable | **Landed in full (Batches 7 + 8)** — `package.json:19` globs `"src/**/*.test.ts"` (24 suites / 208 tests) *and* `"scripts/**/*.test.mjs"`, the double quotes being what finally made the `scripts` half execute under `cmd.exe` instead of printing `# tests 0` and exiting 0. Both blockers §4a measured (the stale fallback assertion, the PGLite-contaminated timer count) were fixed first, in that order, and widening then surfaced the `with-app-env.mjs` quoting defect — reported, approved, fixed. Final: **403 / 403 pass, 0 `todo`**. See `07-regression-report.md` §4b–§4c. |

## 7. Scale path (the brief's "millions of candidate profiles, high concurrency")

Cleanup does not change this, but the audit is where the constraints get stated, so they are here in
one place and none of them require a file move:

1. **PGLite is per-process and in-memory-ish** (`lib/db.ts`): every dev restart loses rows, and no
   second worker can share it. Production must set `DATABASE_URL` → Neon path. Both backends already
   run the same `migrations/*.sql` glob, so this is a deploy-env change, not a code change.
2. **The queue is a single-process setTimeout chain** (`ensureQueueWorker`, `processQueueSlice` global
   mutex, 5 process-global `__vetta*` seams). It cannot scale horizontally as written; it would need a
   real broker or `LISTEN/NOTIFY` + `SELECT … FOR UPDATE SKIP LOCKED` claiming. `claimNextJob` already
   increments attempts, so the row-level protocol is close; the *seams* are what block multi-worker.
3. **Ranking is `parallelism ≈ 7.5` on one laptop with 116 ms/resume keyless** (baseline L5). At
   millions of resumes the cost is not the model calls, it is the PGLite-serialised ledger reads — the
   1 s belief cache in `model-router.server.ts` was measured as worth ~200× on that read and is the
   pattern any further scaling work should follow (cache *beliefs*, never *spend*).
4. **Embeddings**: `@xenova/transformers` runs locally; at scale this belongs in a worker with its own
   queue (already a separate module — `embedding-queue.server.ts` — so the boundary exists).
5. Nothing in §4–§6 needs to happen before 1–4. That asymmetry is the reason to stop moving files and
   start enforcing edges.
