# Vetta — Phase 3 Baseline Report (pre-cleanup)

Date: 2026-11-03. Auditor: Qoder agent. State: **before any cleanup change** (the only prior
edits are the model-router work recorded separately in `docs/` and the `.pre-*.bak` cohort).

> **Read as the starting line, not the current one.** Every number below is the pre-cleanup measurement
> this audit was required to take before changing anything. The final measured state is in `README.md` and
> `07-regression-report.md` §4c — including the two figures that moved most: `npm test` **180 → 403 tests,
> all passing**, and `npm run lint` **1 error + 46 warnings → 0 errors + 46 warnings**.


## 0. Rollback path

This workspace is **not a git repository** (`git` would fail on every command in the brief's
Phase 6). A restorable snapshot was taken instead:

```
C:\Users\punam\vetta-audit\00-snapshot\vetta-source-pre-audit.tar.gz   (97 MB, all of .
except node_modules/.output/.cache/.tanstack/.vercel/.qoder)
restore: tar -xzf <snapshot> -C <target>
```

Per-file rollback copies already exist as 32 `*.pre-<change>.bak` files (625 KB) — see §7.

## 1. Repository at a glance

| Area | Files | Notes |
| --- | --- | --- |
| `src/` | 237 (206 `.ts`/`.tsx` excluding `.bak`, 29 `.bak`) | ~47,000 lines of TS/TSX |
| `src/lib/recruiting/` | 95 modules + `harness/` + `benchmark/` | flat directory, ~30k lines — core domain |
| `src/lib/auth/` | 19 | better-auth, gates, middleware, pglite dialect |
| `src/lib/app-data/` | 11 | connector-gated viewer data |
| `src/lib/observability/` | 5 | cost + telemetry server fns |
| `src/lib/multiplayer/` | 2 | WebRTC P2P island — **unreferenced** |
| `src/components/` | 20 + 17 `ui/` | feature components + shadcn primitives |
| `src/routes/` | 22 | TanStack file routes: `/`, `/login`, `/apply`, `/jobs`, `/jobs/$roleId`, `/portal/$slug`, `/screen/$token`, `/share/$token`, `/app/*` (8), `/api/{auth,queue,whatsapp}` |
| `migrations/` | 26 (`0001`–`0026`) + `auth/0001_auth.sql` | auto-applied under PGLite |
| `scripts/` | 32 (10 `*.test.mjs`) | build/QA/benchmark tooling |
| `docs/` | 1 (`pricing-tiers.md`, 26 KB) | not linked from `AGENTS.md` or `README.md` |
| `.grok/` | 94 | platform-owned skills/references — **out of scope** |

Runtime deps 63, dev deps 19 (5 packages appear in both — §6).

## 2. Command results

| Check | Command | Result |
| --- | --- | --- |
| Unit tests (as configured) | `npm test` | **180 pass / 0 fail**, 13 suites, 54 s |
| Type check | `npm run typecheck` (`tsc --noEmit`) | **clean** |
| Lint | `npm run lint` (`eslint .`) | **1 error, 46 warnings** |
| Production build | `npm run build` | **exit 0** (then `db:migrate`, skipped: no `DATABASE_URL`) |
| Route-clock replay | `npm run check:router-clock` | all invariants held |
| Benchmark | `npm run bench:match -- --slates=200 --n=25` | gate PASS, 200/200 completed |
| Format check | — | **no such script**; only `npm run format` (`prettier --write .`), which mutates |
| CI | — | **no CI configuration exists** (no `.github/`, `.gitlab*`, Circle, Jenkins) |

### Lint error (1)

- `scripts/apply-200-candidates.mjs:285` — `no-unused-expressions` (bare expression statement).

### Lint warnings (46)

All are `@typescript-eslint/no-unused-vars`. 5 of them are in `src/lib/recruiting/tenant-isolation.test.ts`
imports (`assertOrgMember`, `assertOrgPermission`, `getApplicationAssignments`, `updateTaskStatus`,
`deepenRoleTopN`) — imported-but-unused in a test that is itself excluded from `npm test`.
1 is `src/routes/app/observability.tsx:37` `formatCostSideBySide`. The rest are concentrated in
`src/lib/recruiting/api.ts` validator destructuring and route files.

## 3. Test surface actually executed — the most important baseline finding

`package.json:19` hard-codes the list. It runs `scripts/**/*.test.mjs` plus **15 explicitly named
`src` test files**. The repository contains **24** `src/**.test.ts` files.

Nine suites exist but are never executed by `npm test`. Run individually for this baseline:

| Excluded suite | Result standalone |
| --- | --- |
| `src/lib/app-data/readiness-schedule.test.ts` | 3 pass |
| `src/lib/auth/sign-in-gate.test.ts` | 3 pass |
| `src/lib/recruiting/autonomous-portal.test.ts` | 5 pass |
| `src/lib/recruiting/calibrate-explain.test.ts` | 2 pass |
| `src/lib/recruiting/domain-embed.test.ts` | 2 pass |
| `src/lib/recruiting/grounding-and-adversarial.test.ts` | **4 pass, 1 FAIL** |
| `src/lib/recruiting/outcome.test.ts` | 3 pass |
| `src/lib/recruiting/prescreen.test.ts` | 2 pass |
| `src/lib/recruiting/retrieve.test.ts` | 2 pass |

**26** passing tests are therefore invisible to `npm test`, and one failing test is invisible too.

> Erratum, corrected after Batch 4: this line originally said 24. The per-suite column above sums to
> 26 passes + 1 failure = 27 tests, and re-running exactly these nine suites after cleanup reproduces
> `# tests 27 / # pass 26 / # fail 1`. The baseline conclusion (nine suites never run; one stale
> failure hidden by the whitelist) is unchanged.

**Pre-existing failure (not caused by cleanup):**
`grounding-and-adversarial.test.ts:354` "Provider Fallback Transparency" asserts
`provenance.fallback === true` when `mode:"full"` runs with no API keys. Under the per-task model
router, keyless traffic is *routed* to the local arm rather than *falling back* to it, so
`fallback` is `false` and `fallbackReason`/`originalProvider` are not set. The test encodes the
retired ladder's semantics. It is classified **C (obsolete) + replacement required**, not deleted —
see cleanup plan Batch 5. *(This section is the frozen "as found" state; both this failure and the
whitelist that hid it were closed in Batch 7 — `07-regression-report.md` §4b.)*

## 4. Database / migration state

- `DATABASE_URL` unset in this environment → app and scripts run on in-memory **PGLite**
  (one DB per process; dev-server data does not survive a restart).
- 26 numbered migrations, `NNNN_snake_case.sql`, monotonic, Oct 18 → Nov 2. `migrations/auth/0001_auth.sql`
  is deliberately excluded until copied up (`scripts/migrate.mjs:9-11`).
- Appliers glob non-recursively: `scripts/migrate.mjs:31` and `src/lib/db.ts:142`
  (`import.meta.glob("/migrations/*.sql")`), keyed by basename via `scripts/migration-plan.mjs`.
- **No migration is applied by name from code.** Named references are docs/tests only
  (`0001`, `0002`, `0016`, `0017`); the other 22 files are reached by glob only. Migrations are
  retained in full — deleting historical migrations is not proposed.

## 5. Environment variables in force (must not be renamed)

34 distinct names. Highest-value groups: provider keys and their model overrides
(`GROQ_API_KEY`/`GROQ_MODEL`, `GEMINI_API_KEY`/`GEMINI_MODEL`, `OPENAI_API_KEY`/`OPENAI_MODEL`,
`XAI_API_KEY`/`XAI_MODEL`, `OLLAMA_HOST`/`OLLAMA_BASE_URL`/`OLLAMA_MODEL`), platform identity
(`GROK_PROJECT_ID`, `GROK_GATE_ORIGIN`, `GROK_CONNECTOR_ACCESS_TOKEN`, `GROK_CONNECTORS_URL`,
`VITE_AUTH_ENABLED`, `VITE_PUBLIC_HOSTNAME`), routing/budget
(`ROUTER_DAILY_BUDGET_INR`, `ROUTER_MAX_TIMEOUT_*_MS`, `USD_TO_INR`), auth/ops
(`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_ISSUER`, `AUTH_CLIENT_ID`,
`AUTH_CLIENT_SECRET`, `PLATFORM_ADMIN_USER_ID`, `OPERATOR_USER_IDS`, `ALERT_WEBHOOK_URL`,
`WHATSAPP_VERIFY_TOKEN`), QA timeouts (`PREVIEW_*`, `BROWSER_SMOKE_TIMEOUT_MS`,
`BROWSER_ALLOW_EXTERNAL_HOST`).

Baseline inconsistency (reported, not changed): `.env.example` sets `PORT=3000`, while
`vite.config.ts:202` fixes the preview contract at `8080` and `AGENTS.md` states `0.0.0.0:8080`.

## 6. Deployment surface

`vercel.json` = `{ "installCommand": "npm install --omit=dev --no-audit --no-fund" }`.
That flag is why 5 packages (`vite`, `typescript`, `nitro`, `lightningcss`,
`@vitejs/plugin-react`) are duplicated in `dependencies` **and** `devDependencies` — build-time
packages must survive `--omit=dev`. Any dependency removal has to preserve that reasoning.

## 7. Non-source artefacts present at baseline

| Path | Size | Referenced by |
| --- | --- | --- |
| `attachments/*.zip` (2 workspace exports) | 91 MB | nothing |
| `screenshots/` (26 files) | 1.2 MB | 11 of them are the QA harness contract (`scripts/browser-smoke-verdict.mjs:38`, `.grok/references/browser-qa.md`, `AGENTS.md`); 15 session screenshots are not |
| `artifacts/benchmarks/*.json` (9) | 160 KB | written by `scripts/benchmark-resume-match.mjs:334`; cited by `docs/pricing-tiers.md` |
| `scratch/burst-*.json` (3) | 4 KB | nothing — session burst records |
| `bench-run-{1,2,3}.log` | 199 KB | nothing (Nov 1) |
| `*.pre-*.bak` (32) | 625 KB | nothing (not TS-importable; outside `tsconfig` include and `eslint` globs) — manual rollback because there is no git |
| `{}` (0-byte file at repo root, literally named `{}`) | 0 B | nothing |
| `.cache/huggingface` | 0 B | default `@xenova/transformers` model cache location; unreferenced by name |
| `startup.sh` | 272 B | sandbox contract (`cd /workspace`, `npm run dev`) — referenced by `AGENTS.md`; **retained regardless of findings** |

## 8. Critical workflow behaviour recorded (for before/after comparison)

Keyless (no provider keys, no Ollama), single laptop, from `npm run bench:match -- --slates=200 --n=25`
(artifact `artifacts/benchmarks/resume-match-2026-11-03T14-21-42-279Z.json`):

- L1 pure match engine: p50 0.46 ms
- L2 fast path, forced cache miss: p50 65.7 ms
- L3 cache hit: p50 12.3 ms (mem) / 19.0 ms (DB tier)
- L4 full ingest (`persistRanked`): p50 58.1 ms, 0 errors
- **L5 200-application slate through the production queue: 23.2 s wall, 116 ms/resume, 8.6 apps/s,
  200/200 completed, 0 failed, derived parallelism 7.50**
- L6 routing decision overhead with circuits pre-opened: p50 28.3 ms
- Per-rank cost band (pricing table, L2 output): ₹0.029–₹0.622 for a typical 4 k resume + 3 k JD

Deterministic outputs that must be byte-identical after cleanup: `rankLocally` scores for the
benchmark corpus, `hashResumeText`, `cacheKey`, `extractAndValidateJson`, `calculateModelCost`,
`predictCostUsd`, and every route/API signature in `src/routes/**` and wired `*-api.ts`.

Model-driven outputs cannot be compared exactly in this environment (no keys), so the AI path is
guarded by `npm run check:router-clock` (offline route replay) and the router unit tests instead.

## 9. Limitations of this baseline (stated, not hidden)

1. No browser verification of authenticated screens: Playwright's browser binaries are not
   installed on this machine (`scripts/browser-smoke.mjs` fails with
   `Executable doesn't exist … chrome-headless-shell.exe`), and `npm run preview:restart` targets
   the sandbox layout. UI changes are therefore verified by typecheck, build and in-process
   `routerStatus()` contract checks only.
2. No `DATABASE_URL`, so all numbers are PGLite (single-writer, in-memory) — not Neon.
3. No CI, so `npm test`'s hard-coded whitelist (§3) is the only gate that exists.
4. `npm run format` is write-only; no read-only format check was available to baseline.
