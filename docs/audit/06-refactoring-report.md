# Vetta — Refactoring Report (deliverable D)

Phase 6 says "perform changes in small, reversible batches", and the brief's Phase 5 says do not move
files without a demonstrable maintainability benefit. Both were followed, which makes this report
shorter than the title suggests: **no file was moved or renamed inside the repo.**

---

## 1. Files moved

**Inside the repository: none.** No `mv` touched `src/`, `scripts/`, `migrations/`, `server/` or
`public/`. The only movements were *out* of the repo, into the audit folder:

| From | To | Items |
| --- | --- | --- |
| `/**/*.pre-*.bak` | `C:/Users/punam/vetta-audit/99-bak/` (paths mirrored) | 32 |
| 8 dead source files | `C:/Users/punam/vetta-audit/20-batch3-removed/` (paths mirrored) | 8 |
| `package.json`, `package-lock.json`, `vite.config.ts` (copies) | `10-pre-batch/` | 3 |
| 14 pre-edit copies of Batch 4 files | `30-pre-batch4/` | 14 |

Why no relocation: `docs/audit/03-architecture-analysis.md` §2 measured **0 dependency-direction
violations** in the current layout. Moving 100 correctly-layered modules into `domain/ ai/ ingest/
ranking/ pipeline/ people/ analytics/ api/` would be a pure-navigation gain, obtained by rewriting
~60 imports with no git, no CI and a hand-maintained test whitelist as the only safety nets. That is
the brief's own "plausibly affects product behaviour → report instead of proceeding" case.

## 2. Modules reorganised

None. The target structure is documented (§4 of the architecture analysis) as a **grow-into** plan:
new modules start in the subfolder, existing ones move only when a change already touches them. The
cheaper equivalent — two ESLint rules that freeze the 0-violation state — is still sitting at the
approval gate as Batch 6, because adding lint rules introduces build-gate failures that did not exist
before.

## 3. Imports updated

12 identifiers, all removals (see the deletion report for the full list):

| File | Import/const removed | Reason |
| --- | --- | --- |
| `recruiting/ai-retry.server.ts` | `import type { z } from "zod"`, `extractAndValidateJson` | only `completeWithSchemaValidation` used them |
| `recruiting/harness/api.ts` | `fitSchema`, `verdictSchema` | only `labelRank` used them |
| `recruiting/api.ts` | `RoleInput`, `TalentRow` (type imports), `roleStatusSchema` (local const) | only `updateRole` / `listTalent` used them |
| `recruiting/collaboration.server.ts` | `updateWithOptimisticLock` | only `updateCandidateNote` used it |
| `recruiting/query.ts` | `listRoleShares` (from `./share`, keeping `getPublicShare`) | only `useRoleSharesQuery` used it |
| `recruiting/model-registry.ts` | `modelPriceFor` | only `armPrice` used it; the doc comment explaining why prices are not duplicated here was **kept** — it is still true, `cost.ts` remains the single source |
| `recruiting/portal.ts` | `ClientCard`, `ScreenQuestion` (type imports) | only `submitPortalScreen` used them |

No import path was rewritten, no alias changed, no module specifier altered, nothing renamed.

## 4. Dependencies removed (Phase 7)

63 `dependencies` → 36, 19 `devDependencies` → 13; npm reported 80 packages removed including
transitives. Manager (npm) and lockfile integrity preserved — the lockfile was rewritten by
`npm uninstall` / `npm install`, never hand-edited.

- **Wholly unused (28 manifest entries):** 11 Radix primitives with neither an importer nor a `ui/`
  wrapper (`accordion`, `alert-dialog`, `avatar`, `checkbox`, `collapsible`, `popover`, `radio-group`,
  `slider`, `switch`, `toggle`, `toggle-group`), `@hookform/resolvers`, `react-hook-form`,
  `@tanstack/react-table`, `cmdk`, `date-fns`, `react-day-picker`, `react-resizable-panels`,
  `recharts`, `vaul`, `zustand`, `tw-animate-css`, `sharp`, `@tanstack/router-plugin`, `lightningcss`,
  `eslint-plugin-prettier`, plus `@radix-ui/react-scroll-area` and `@radix-ui/react-separator` (freed
  by Batch 3).
- **Duplicate declarations (4):** `@vitejs/plugin-react`, `nitro`, `typescript`, `vite` were each listed
  in **both** sections because `vercel.json` installs with `--omit=dev`. The `dependencies` copies stay
  (deploy needs them at build time); the `devDependencies` copies were pure redundancy.
- **Two inference-based removals, settled by the build rather than by argument:** `lightningcss` (Vite
  only uses it if a transformer is configured; `vite.config.ts` configures none) and
  `@tanstack/router-plugin` (resolved internally by `tanstackStart()`). `npm run build` passing after
  both were removed is the proof.
- **No upgrades.** Not one version range changed.
- **Retained despite 0 imports**, because they are peer/toolchain requirements rather than imports:
  `react-dom`, `@types/node`, `@types/pg`, `@types/react`, `@types/react-dom`, `prettier` (used by
  `npm run format`), `playwright` (used by `browser-smoke.mjs` and `preview-thumbnail.mjs`).

## 5. Structural changes performed

| Change | Effect |
| --- | --- |
| 0-byte `{}` file removed from the repo root | removes an entry that looks like a build artefact to every tool that lists the root. **Provenance precision:** it came back once as a 0-byte file (an artefact of this session's own tooling, not the product), so it was removed again in Batch 8b and re-checked absent after a full `npm test` run |
| 32 `.bak` files relocated out of the tree | `src/` and `scripts/` now contain only code; directory listings are truthful again |
| `src/lib/multiplayer/` deleted | one whole dead subsystem gone, 579 lines |
| `src/lib/` root trimmed of 2 scaffold leftovers | `preview-host-bridge.ts`, `preview-embedder-origin.ts` |
| `src/components/ui/` 17 → 15 | every remaining primitive now has at least one consumer |
| `src/lib/recruiting/` 101 → 100 | `seed.ts` stub gone. (This row read "97 → 96"; the original figure came from a four-bucket count that silently missed three files not matching their own suffix — `recruiting/api.ts`, `harness/api.ts`, `harness/server.ts`. Corrected in Batch 6; see `03-architecture-analysis.md` §1.) |
| 410 lines of never-imported API surface removed from 13 live modules | the remaining exports of those modules are all reachable |

## 6. Repository shape, before → after

| Measure | Before | After |
| --- | --- | --- |
| `src` + `scripts` LOC | 52,812 | 51,716 |
| `src` TS/TSX files | 206 | 198 |
| `dependencies` / `devDependencies` | 63 / 19 | 36 / 13 |
| `*.bak` in tree | 32 | 0 |
| Unused `ui/` primitives | 2 | 0 |
| Dead exports in live files (unheld set) | 16 | 0 |
| Dependency-direction violations | 0 | 0 — and now **lint-enforced** (Batch 6, §7) |

## 7. Batch 6 — enforcement, not relocation (post-approval, no file moved)

Batches 1–4 removed code. Batch 6 changed the two things that let the remaining code drift, and added
no product surface.

| Change | File | Net effect |
| --- | --- | --- |
| `no-restricted-imports`: client (components + page routes, excluding `routes/api/**`) cannot import a server-only module | `eslint.config.mjs` | 0 violations; static + relative specifiers covered |
| `no-restricted-syntax`: same boundary for `await import()` and `require()` | `eslint.config.mjs` | closes the vector `no-restricted-imports` provably does not inspect (verified by probe) |
| `no-restricted-imports`: `src/lib/**` cannot import `routes/**` or `components/**` | `eslint.config.mjs` | 0 violations; freezes the layer below the app |
| Module-kind table + dependency direction + the `createServerFn` reachability trap | `src/lib/recruiting/README.md` (new) | replaces "learn it by reading 100 files" |
| `test:src` (glob over all 24 suites) and `test:all` (all 33 in one invocation) | `package.json` scripts | new commands only; `npm test` left byte-identical and still 180/180 |

Two rules were **not** written as originally sketched in §6/S1 of the architecture analysis, because
measuring them first showed each would fire on code that is correct as it stands:

- banning `*.server` static imports from all non-wrapper files would have flagged
  `harness/server.ts:4`, `src/lib/auth/server.ts:17` and `routes/api/queue/tick.ts:2` — three
  genuinely server-side modules, merely named by folder or by route instead of by suffix;
- banning `@/lib/recruiting/*` from `src/lib/*` would have flagged
  `observability.server.ts:450/492`, which lazily import `recruiting/queue.server.ts` while
  `queue.server.ts:356` lazily imports back into observability — a real bidirectional cycle that the
  lazy form is what keeps working.

Both are recorded in `03-architecture-analysis.md` §2's erratum instead of being silenced. Gates after
Batch 6: `lint` 1 error + 46 warnings (identical to baseline), `typecheck` clean, `build` exit 0,
`npm test` 180/180.

## 8. Batch 7 — the gate itself, widened

Enforcement that only covers 15 of 24 suites is enforcement with a blind spot, so Batch 7 removed the
blind spot rather than documenting it. Still no file moved and no product module edited.

| Change | File | What it replaced |
| --- | --- | --- |
| the 15-path whitelist → `"src/**/*.test.ts"` | `package.json:19` (`test`) | a hand-maintained list that had already silently dropped 9 suites, including the one carrying the only failing assertion in the repo |
| timer recording attributed to its call site | `src/lib/recruiting/resilience.test.ts:488` (`armedByProjectCode`) | a value-threshold filter (`>= 1_000` ms) that was counting PGLite's own Postgres interval timers as runner attempt budgets |
| keyless `mode: "full"` provenance assertions rewritten, plus a new 401-arm test | `src/lib/recruiting/grounding-and-adversarial.test.ts:418`, `:468` | an assertion of retired ladder semantics, and zero coverage of the `fallback: true` branch the desk and `trainOutcome` read |
| `'scripts/**'` → `"scripts/**"` in the `test` script | `package.json:19` (Batch 8) | a glob `cmd.exe` handed to node verbatim, so the scripts half printed `# tests 0` and exited 0 — 195 tests that had never run on this OS |
| directory links in tests use a win32 junction, and the `browser-smoke` guard assertions pin the shipped `allowedDirs` | `scripts/with-app-env.test.mjs`, `scripts/check-auth-invariant.test.mjs`, `scripts/browser-smoke-verdict.test.mjs` (Batch 8) | `symlinkSync` `EPERM` on Windows, and assertions pinned to a source shape that predates the audit snapshot |
| wrapped command tokens quoted for `cmd.exe` | `scripts/with-app-env.mjs` (`shellToken`, Batch 8b — **the only product-side change of the audit, applied after approval**) | `shell: true` joined command and args unquoted, so every wrapped path containing a space died before starting; POSIX branch and every space-free token are unchanged |

Gates after Batch 7: `npm test` **208 pass / 0 fail**, `npm run test:all` 403 / 397 pass / 6 fail (all 6
pre-existing and OS-caused), `lint` 1 error + 46 warnings (identical by file+rule+message), `typecheck`
clean, `build` exit 0, dev :8080 → 200. Evidence and reasoning: `07-regression-report.md` §4b,
`04-cleanup-plan.md` gate items 4–5.

Gates after Batch 8: `npm test` **403 tests / 403 pass / 0 fail / 0 `todo` / exit 0**, `typecheck` clean,
**`npm run lint` 0 errors + 46 warnings (the repo's only live error cleared)**, `eslint` and prettier clean
on every file touched. Six files: three suites, the `test` script, `scripts/with-app-env.mjs` and
`scripts/apply-200-candidates.mjs`. Two of those are behaviour-side and both are narrow: the `cmd.exe`
token quoting (reported before it was applied, approved, re-verified on dev, build and preview) and a
style-only ternary rewritten as the equivalent `if`/`else`. `src/` is untouched. `07-regression-report.md`
§4c.
