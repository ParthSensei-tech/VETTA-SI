# Vetta — Repository Health Report (Phase 1 + 2 output, deliverable A)

Read `docs/audit/01-baseline-report.md` first: it holds the rollback path, the command results and the
critical-workflow numbers this report is measured against. This document answers two questions only —
*what is here* and *what is provably not needed*. Nothing has been deleted; the deletion proposal with
its approval gate is `docs/audit/04-cleanup-plan.md`.

Method note: every count below comes from a script, not from reading, and every script excludes
`node_modules`, `*.bak`, build caches and generated output. Three counters are used — reference
(`audit-refs.mjs`), symbol (`audit-symbols.mjs`), dependency (`audit-deps.mjs`) — and each "0 refs"
verdict was then re-checked by hand with an exact-path grep, because the bare-stem matcher produces
false positives for names like `index`, `seed`, `types` and `login`. Where the manual check contradicted
the script, this report says what the manual check found.

---

## 1. What is actually here

| Surface | Size | Notes |
| --- | --- | --- |
| `src/` (excl. `.bak`) | 208 TS/TSX files | ~52.8k LOC across `src` + `scripts` |
| `src/lib/recruiting/` | 100 files | 30 `.server.ts`, 19 `.test.ts`, 11 `-api.ts`, 2 bare `api.ts`, 38 plain (2 of those 38 are server-side, named by folder) |
| `src/components/` | 21 + 17 `ui/` | `ui/` are shadcn primitives; 2 of 17 unused |
| `src/routes/` | 19 route files | 9 app pages, 3 API roots, portal/apply/jobs/login |
| `src/lib/auth/` | 19 files | Better Auth wiring + gate identity/session |
| `src/lib/app-data/` | 11 files | connector-gate plumbing; live except its barrel |
| `src/lib/observability/` | 5 files | cost model, event log, desk queries |
| `migrations/` | 26 + `auth/0001` | applied by glob, both backends |
| `scripts/` | ~20 files | migrate, bench, smoke, auth-invariant checks |
| `attachments/` | **91 MB** | 4 uploaded resume ZIPs |
| `.output/` | 90 MB | build artefact (now dev-server watch-ignored) |
| `*.bak` | 32 files, ~625 KB | my own pre-change backups, one per edited production file |

## 2. Architectural weaknesses (structural, not cosmetic)

1. **`src/lib/recruiting/` is a flat 100-module grab bag** (97 if you count only the files whose names
   match the four suffix conventions — see the Batch 6 correction in `03-architecture-analysis.md` §1). It mixes the matching engine, AI provider
   plumbing, queue workers, privacy/consent, RBAC, analytics, UI-facing server-fn wrappers, tests and
   two synthetic demo pipelines in one directory with no sub-boundaries. Naming is the only grouping
   signal, and it is inconsistent: `.server.ts`, `-api.ts`, `-server.ts` (none), plain `.ts`.
2. **Three different module-visibility conventions, one of them silently unusable.** `*-api.ts` files
   are `createServerFn` wrappers. TanStack resolves those only when a **client** module imports them.
   Five of eleven have zero importers, so they are not merely unread — they are *uncallable*, and no
   tool reports that. `search-api.ts` is imported only by a test, which means the test exercises a
   surface no user can reach.
3. **Two parallel model-selection paths still coexist.** The per-task router (`model-router.ts` +
   `.server.ts`) is what `completeWithRouter` uses; the retired ladder (`providers.server.ts`
   `completeWithLadder`) is still exported, still tested, and still the thing the orphaned
   `grounding-and-adversarial.test.ts:354` asserts against. That single test is the only remaining
   behavioural claim the product no longer honours.
4. **Cost maths has four independent implementations.** `predictCostUsd`, `calculateModelCost`'s
   inlined arithmetic, `model-router.ts`'s private `estimateTokens` (a second copy of
   `estimateTokensFromText`), plus a fourth cents→INR conversion and raw `* 100`-style multiplications
   in JSX. `formatCostInr` and its alias `formatCostRupees` (explicitly documented as an alias) are
   both used in the same screens. Prices are correct today; the duplication is how they drift.
5. **Hashing is duplicated three ways.** `hashPrompt` (ai.server.ts), `sha12` (harness/server.ts), and
   `sha256Hex` in *two* files — sync in `recruiting/hash.ts`, async in `recruiting/privacy.ts`. Cache
   keys and audit digests pick different ones per call site.
6. **`cacheKey` declares a `rubricHash` input it does not put in the key**, with two separate
   hand-written invalidation blocks compensating. This is the highest-risk duplication in the repo: it
   is not a tidiness problem, it is a correctness-adjacent one. **Not fixed here** — changing it changes
   ranking cache behaviour, which the brief forbids. Reported as debt.
7. **No CI, no read-only format gate, and `npm test` executed only part of the repo on Windows**
   (as found in Phase 1; **both `npm test` halves fixed — `src` in Batch 7, `scripts` in Batch 8**).
   As shipped at audit time
   `package.json:19` named 15 of 24 `src` suites; the 9 unlisted ones were still real tests, and running
   them individually was the only way to see them. That is how the pre-existing failure in §3.6 stayed
   invisible. Measured properly in Batch 6 (`07-regression-report.md` §4a): the `scripts` half of the
   same script runs **zero** suites under cmd.exe because its single-quoted glob survives to node and
   matches nothing while still exiting 0, so on Windows the coverage was 180/402 = 44.8 % and on a POSIX
   shell 375/402 = 93 % — the green headline was partly an artefact of the host OS.
   Batch 7 replaced the 15-path list with `"src/**/*.test.ts"` (double-quoted, so it survives cmd.exe).
   **Batch 8 did the same to the `scripts` half**, which is what this item was really about: the repo
   stands at **403 tests = 208 `src` + 195 `scripts`, and `npm test` now executes all 403 on Windows —
   403/403 = 100 %, 403 pass, 0 `todo`.** The quoting bug is *not* unchanged any more: running those 195
   here surfaced 6 pre-existing OS-caused failures, 2 of which were stale tests corrected without
   weakening them and 4 of which were one real defect in `scripts/with-app-env.mjs` (unquoted `cmd.exe`
   tokens) — reported, approved, fixed, and re-verified on dev, build and preview. The measured history is
   in `07-regression-report.md` §4a–§4c; the finding worth keeping is that **a gate which silently runs
   nothing is how a defect in the app's own launch path survived to this audit.**
8. **Nothing enforced the architecture** (as found in Phase 5; **now enforced**). The layering is real
   and holds at 0 violations, but it lives entirely in filename suffixes with no lint rule, no folder
   and no CI to catch a breach. Batch 6 added the two `no-restricted-imports` rules plus a
   `no-restricted-syntax` companion (the core rule provably does not inspect `await import()`) and
   `src/lib/recruiting/README.md`; see `06-refactoring-report.md` §7.
9. **The template's game/app-data scaffolding is still shipped.** `src/lib/multiplayer/` (579 lines of
   WebRTC P2P), `preview-embedder-origin.ts`, and a second `preview-host-bridge.ts` in `src/lib/` all
   come from the app-builder scaffold, not from Vetta.
10. **Environment contract drift**: `.env.example` advertises `PORT=3000` while `vite.config.ts` fixes
   the live-preview contract at `0.0.0.0:8080`. Reported, not changed (§ env vars are frozen).

## 3. Classification

### A — Confirmed dead code (no reachable path, no dynamic/reflection/convention reference)

Evidence standard: 0 importers of the exact module path across `src`, `scripts`, `server`, `migrations`,
`docs`, `public`, `package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vercel.json`,
`startup.sh`, `AGENTS.md`, `.env.example` (281 documents scanned), plus no string/dynamic form of the
stem, plus not a framework convention file (route, middleware, manifest, migration, seed).

| File | Lines | Verdict detail |
| --- | --- | --- |
| `src/lib/recruiting/live-pipeline.ts` | 536 | one export, `runLivePipeline`; no importer; inserts synthetic "Northbeam"/"Lumenfold" applicants into **real** tables |
| `src/lib/multiplayer/p2p.ts` + `index.ts` | 579 | island; the two files reference only each other and a skill doc |
| `src/lib/recruiting/analytics-api.ts` | 173 | `createServerFn` wrapper, 4 fns, 0 client importers → uncallable |
| `src/lib/recruiting/embedding-api.ts` | 110 | 6 fns, 0 importers |
| `src/lib/recruiting/privacy-api.ts` | 101 | 5 fns (consent/erase/retention), 0 importers — see §3.F, this one is a *capability surface* |
| `src/lib/recruiting/dedicated-search-api.ts` | 90 | 3 fns, 0 importers |
| `src/lib/recruiting/backup-api.ts` | 43 | 2 fns, 0 importers |
| `src/lib/app-data/index.ts` | 21 | pure barrel; every app-data consumer imports the concrete file, not the barrel. The other 10 app-data files are **live** |
| `src/components/ui/scroll-area.tsx` | 23 | no consumer (the only "hit" was the radix package name in `package.json`) |
| `src/components/ui/separator.tsx` | 23 | same |
| `src/lib/preview-host-bridge.ts` | 18 | duplicate of `src/components/preview-host-bridge.tsx`, which is what `__root.tsx:4` imports. The lib copy is dead; **the mounted component is not** |
| `src/lib/preview-embedder-origin.ts` | 19 | scaffold leftover, 0 importers |
| `src/lib/recruiting/seed.ts` | 2 | body is `export {};` under a comment saying the demo seed was removed. The 89 "refs" the script reported were the English words "seed"/"seeded" in `role-form.tsx` |

### B — Duplicate implementations (both reachable; consolidation is a *behaviour* change)

| Duplicate | Where | Why it is not simply deleted |
| --- | --- | --- |
| Ladder vs router model selection | `providers.server.ts:403` `completeWithLadder` vs `model-router.server.ts:243` `planRoute` | Ladder has live tests (`resilience.test.ts`, 5 uses) and is the fallback semantics the orphaned test asserts. Router wins in production; deleting the ladder breaks 5 passing tests |
| `describeAi` default model `llama-3.3-70b-versatile` vs registry/provider default `openai/gpt-oss-20b` | `ai.server.ts:93` vs `providers.server.ts:156`, `model-registry.ts:298` | The desk label can name a different model than the call actually makes. Fixing it changes an externally-visible string → **needs approval** |
| `predictCostUsd` vs `calculateModelCost` inlined maths | `observability/cost.ts:84`, `:108` | Same table, two code paths; router uses the former, event writer uses the latter |
| `estimateTokensFromText` vs private `estimateTokens` | `cost.ts:100` vs `model-router.ts:247` | Different heuristics for the same quantity → different token trims |
| 4th cents→INR path + JSX multiplications | `cost.ts`, screens | Display-only, but a price round-trip differs per screen |
| `formatCostInr` / `formatCostRupees` alias | `cost.ts:201`, `:212` | Both used; alias is documented. Safe to collapse to one name |
| sync vs async `sha256Hex` | `recruiting/hash.ts:4` vs `recruiting/privacy.ts:122` | Same digest, two promise shapes; callers depend on which |
| `hashPrompt` vs `sha12` vs `sha256Hex` | `ai.server.ts:73`, `harness/server.ts:26`, `hash.ts:4` | Three different cache/audit key formats in use |
| `serializeCal`/`serializeHead` pair, `clip()` ×2 | `calibrate-explain.ts`, others | Small, local, both used |
| `deepenTopCandidates` (dead export) vs `rerankStaleApplications` (live) | `api.ts` | The former is a 1-copy export of nearly the same walk |
| `cacheKey` `rubricHash` omission + 2 invalidation blocks | `api.ts` | See §2.6 — correctness-adjacent, deliberately untouched |

### C — Obsolete

- `src/lib/recruiting/grounding-and-adversarial.test.ts` — "Provider Fallback Transparency": asserted
  `fallback === true` whenever a call did not use the primary provider. The router legitimately selects
  keyless `local` **instead of** falling back, so the assertion failed against correct current
  behaviour. This is a stale requirement, not a broken product. It was in none of the `npm test`
  whitelists, which is why the suite looked green. **Replaced in Batch 7** (gated item 4): the keyless
  case now asserts the decision (`fallback: false`, `null` reason, `null` original provider) and a new
  second test drives a keyed arm to a 401 to cover the `fallback: true` branch with its reason and
  provider named — `07-regression-report.md` §4b. The suite is now in the gate and green.
- The 32 `*.bak` files: each is the pre-edit copy of a file whose edit is already verified by tests and
  build. Obsolete as backups, retained by me as the only rollback path (no git). See §3.F.
- `attachments/*.zip` (91 MB) and `bench-run-{1,2,3}.log`: inputs/outputs of finished work.

### D — Unnecessary dependencies (0 importers, verified package-specifier-only)

Runtime, unused by code, build, tests, scripts and CSS:
`@hookform/resolvers`, `react-hook-form`, `@tanstack/react-table`, `cmdk`, `date-fns`,
`react-day-picker`, `react-resizable-panels`, `recharts`, `vaul`, `zustand`, `tw-animate-css`
(`src/styles.css` imports only `tailwindcss`), `sharp` (no importer; the OG pipeline it would serve is
just `src/lib/og/site.json`), `eslint-plugin-prettier` (`eslint.config.mjs` imports
`eslint-config-prettier`, a different package), and 11 radix packages: `accordion`, `alert-dialog`,
`avatar`, `checkbox`, `collapsible`, `popover`, `radio-group`, `slider`, `switch`, `toggle`,
`toggle-group` — each 0 importers (their `ui/` wrappers do not exist or do not import them).

Additionally: 5 packages declared in **both** `dependencies` and `devDependencies`
(`@vitejs/plugin-react`, `lightningcss`, `nitro`, `typescript`, `vite`). That duplication is explained
by `vercel.json`'s `installCommand: "npm install --omit=dev"`, so the `dependencies` copy must stay;
the `devDependencies` copies are redundant. `lightningcss` is *both* duplicated and imported nowhere,
and `vite.config.ts` sets no lightningcss transformer.

Explicitly **not** in the removal list despite 0 importers, because they are peer/toolchain
requirements rather than imports: `react-dom` (React 19 renders via `@tanstack/react-start`),
`@types/node`, `@types/pg`, `@types/react`, `@types/react-dom`, `prettier` (used by `npm run format`),
`@tanstack/router-plugin` (resolved by `tanstackStart()`). `@tanstack/router-plugin` and `lightningcss`
are the two I would want a build to confirm rather than reason about — both are marked for verification
in Batch 2.

### E — Structural clutter

`attachments/` 91 MB · `.output/` 90 MB (regenerated by `npm run build`) · 32 `*.bak` 625 KB ·
`bench-run-{1,2,3}.log` 199 KB (nothing references them; they are Nov 1 console captures) ·
`scratch/burst-*.json` 4 KB (my own measurement intermediates) · `screenshots/` 1.2 MB, **23 of 26**
unreferenced — the 3 that matter (`app-builder-preview.png`, `app-builder-built.png`,
`app-builder-preview.json`) are the output paths `scripts/browser-smoke.mjs` is invoked with in
`.grok/references/browser-qa.md`, so the whole folder is retained as regression evidence · 160 KB `artifacts/benchmarks/` (referenced by the pricing doc — keep) · a **0-byte file
literally named `{}`** at the repo root (Oct 30, a shell redirection accident) · `.cache/` (0 bytes,
huggingface mirror stub) · `.node_modules.lock`, `.project_id` (platform files — keep).

### F — Uncertain: retained, and why (nothing here is deleted)

| Item | Reason for doubt |
| --- | --- |
| The 5 unwired `*-api.ts` files, `team-api.ts`, `search-api.ts` | Each wraps a **live** `.server.ts` capability (analytics, backup, dedicated search, embeddings, privacy consent/erase, team RBAC shares). They read as planned-not-yet-built UI, and the brief forbids removing public capability surfaces on the strength of an absent import. `privacy-api.ts` in particular is the consent/erasure surface — deleting it would reduce auditability while looking like a cleanup |
| `live-pipeline.ts` | Confirmed unreferenced **and** writes synthetic rows into real tables; its deletion is safe, but a demo/e2e harness could plausibly invoke it by path from outside the scanned surface |
| `src/lib/multiplayer/` | Confirmed island, but it is the platform scaffold the app-builder contract says to keep additive; deleting costs nothing and buys nothing either |
| The 9 orphaned test suites | Failing-to-untouched ≠ dead. They are evidence about behaviour, and one of them contains the §3.C stale assertion. **Done in Batch 7**: the assertion was replaced, its suite given a second test for the branch it never covered, and all 24 suites wired into `npm test` by glob |
| `*.bak` cohort | My own rollback path. Move to an out-of-repo folder rather than delete |
| `startup.sh`, `vercel.json`, `.grok/**`, `server/`, `public/__grok/`, `scripts/grok-pwa-*` | Platform contract files, explicitly protected by `AGENTS.md` |
| All 27 migrations, `.env.example`, 34 env var names | Frozen by the brief (no schema, no env-name changes) |
| `deepenTopCandidates`, `hasActiveConsent`, `setOrgRetentionDays`, `restoreEmbeddingWorker` | 1 occurrence each, but each is a *documented* operation whose absence a future caller would notice; and `restoreEmbeddingWorker` is queue-recovery code in the §8-sensitive set |

### Dead exports (exactly 1 occurrence = the definition line, verified symbol-by-symbol)

`updateRole`, `listTalent`, `calibrationStatus`, `updateCandidateNote`, `APP_TAGLINE`,
`embeddingModelName`, `labelRank`, `ensureHarnessReady`, `jobApplyPath`, `localFollowUp`, `armPrice`,
`submitPortalScreen`, `useRoleSharesQuery`, `weightToNumber`, `loadRubricById`,
`completeWithSchemaValidation` — plus `deepenTopCandidates`, `hasActiveConsent`, `setOrgRetentionDays`,
`restoreEmbeddingWorker` (held in §F), `formatRupees` (imported only by its own test) and
`completeWithLadder` (held in §B; its comment claims the benchmark uses it, which `phases.ts` does not).

The counter now reads `docs/audit/*.md` too (I re-ran it after writing this file), so the five symbols
below show 2 occurrences where the true count is 1 definition plus 1 mention in this report:
`SignedIn`, `SignedOut`, `SignInGate` (all three exported from `src/lib/auth/gates.tsx` with no
consumer), `readSessionToken` (`auth/server.ts`), `getConnectorAccessToken`
(`app-data/client.server.ts`). They are genuinely unreferenced — but `SignInGate` wraps
`resolveSignInGateState`, which *is* used inside `gates.tsx` and covered by
`auth/sign-in-gate.test.ts`, and all five sit on the auth/session surface that §8 of the brief puts
under extra scrutiny. They are therefore held in §F and **not** proposed for deletion.

## 4. Technical debt this pass deliberately does not touch

`cacheKey`/`rubricHash` (§2.6) · ladder-vs-router default model divergence (§2.3) · three hashing
schemes (§2.5) · four cost paths (§2.4) · PGLite per-process data (dev restart loses rows) · no CI ·
no `format:check` (measured in `08` §2: red on 730 files as of Batch 8, so it needs a ratchet or a
scoped pass, not an addition) · 46 `no-unused-vars` warnings. ~~1 live lint error at
`scripts/apply-200-candidates.mjs:285`~~ **cleared in Batch 8b** — `npm run lint` is now 0 errors.
