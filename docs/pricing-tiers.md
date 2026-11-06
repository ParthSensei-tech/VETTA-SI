# Vetta — measured performance, per-resume cost, and the free/premium line

**Status: decision document.** No entitlement or gating code was written for this; see
§9 for what must be built before any of these caps can actually ship.
Data source: `scripts/benchmark-resume-match.mjs` → `artifacts/benchmarks/latest.json`
(three runs, 2026-11-01). Benchmarks are reproducible with `npm run bench:match`.

---

## 1. What was measured, and how much to trust it

All numbers below are **local engine only** (`mode: "fast"`). No provider API keys were
configured in the benchmark environment, so the LLM ladder was never actually called;
provider *latency* is not measured anywhere in this document, and provider *cost* is
estimated from the repo's own pricing table (`src/lib/observability/cost.ts`).

| | value |
|---|---|
| Backend | PGLite (in-process Postgres WASM), because `DATABASE_URL` was unset |
| Runtime | Node v22.16.0, win32, 12 logical cores |
| Corpus | 8 gold cases × 5 variants = 40 unique resumes (`src/lib/recruiting/benchmark/corpus.ts`), uniqueness verified pre-run (40/40 distinct emails, texts, hashes) and 200 distinct candidates post-run — i.e. no measurement silently collapsed into the dedupe path |
| Slates | 25 and 200 resumes per batch, against 4 roles |
| Process | `boot` 2.8 s is reported separately and excluded from per-resume figures |

**Repeatability.** Runs 2 and 3, on identical flags, agree within ~6%. Run 1 is 3.4×
slower across the board and is the cold process (first JIT compile, first query-plan
build). Both are reported, because the free tier is defined against the *pessimistic*
column:

| metric | warm (runs 2–3) | cold (run 1) |
|---|---|---|
| L1 pure match engine, p50 | 0.16–0.20 ms | 0.58 ms |
| L2 full fast-path rank, p50 / p95 / p99 | 21.0–21.5 / 26.5–30.1 / 115–116 ms | 73.4 / 88.5 / 456 ms |
| L3 cache hit, process-local / DB tier, p50 | 3.05–3.07 / 5.50–5.80 ms | 13.2 / 21.9 ms |
| L4 ingest round-trip, p50 | 15.8–16.5 ms | 63.5 ms |
| L5 25-resume slate, wall | 458–472 ms | 1,751 ms |
| L5 200-resume slate, wall | 6.89–7.28 s | 24.14 s |
| L5 200-resume slate, per resume | 34.4–36.4 ms | 120.7 ms |
| L5 200-resume slate, last candidate ranked (queue-age p95) | 6.32–6.45 s | 22.2 s |

Treat the warm column as "a tenant on a warm server" and the cold column as the
upper bound you must still satisfy for the first slate of the day.

> **Read defect 1 in §8 before quoting these figures.** `parseAndRank` currently throws on
> `createHash` before it can rank anything; the benchmark only runs because the harness
> injects that global. These are post-fix numbers.

> **Not yet valid for production pricing:** PGLite has zero network round-trip. On Neon,
> every statement in `persistRanked` (`src/lib/recruiting/queue.server.ts:127`, ~6
> statements per resume) pays RTT, so L2/L4/L5 will grow while **L1 will not move at
> all**. A Neon-backed re-run is a prerequisite for locking any numeric cap; see §10.

---

## 2. Where the time actually goes

Answer to "where is time being spent": **not in the matcher.**

```
L1 pure engine          0.16 ms   ─ 0.8 % of a rank
L2 fast path (total)   21.0 ms
  ├─ engine (L1)        0.16 ms
  └─ DB + augmentation ~20.8 ms   ← dominantLayer = "L2_fast_path_db_work"
L4 ingest round-trip   16.5 ms   (persist + re-read)
L5 amortised wall      34.4 ms / resume on a 200-slate
```

The engine is roughly **1/130th** of the work surrounding it (`src/lib/recruiting/match-engine.ts:557`).
Everything else is Postgres writes, the rank-cache tier, the domain-embedding
augmentation, the explanation attach, and the outcome forecast — all reached from the
fast branch at `src/lib/recruiting/ai.server.ts:540-652`.

Three consequences that shape pricing:

1. **Throughput is a database budget, not an AI budget.** 29 resumes/s warm on a
   200-slate at configured concurrency 8, with *derived* parallelism 7.5
   (`sum(jobMs)/wall`, the honest version of a metric that first read as "1 slice, so
   concurrency 1"). Raising concurrency buys little until the DB write path is cheaper.
2. **The cache is not free.** A DB-tier cache hit costs 5.5 ms — it short-circuits the
   engine but still reads rubric and provenance rows. So "cache hit" is a ~4× win, not
   an ~100× win; you cannot monetise cache misses by pretending they are instant.
3. **Tail risk is queue age, not per-resume time.** On a 200-slate the median candidate
   waits 2.9 s and the p95 waits 6.3 s to even *start*. Any "your slate is ranked in
   seconds" promise must be quoted as last-candidate-in, not per-resume.

`L6` (provider ladder, p50 8.3 ms) is **ladder overhead with all circuits pre-opened** —
it measures how fast Vetta gives up, not how fast a provider is. It is not evidence for
any latency claim.

---

## 3. What one resume costs

### Local (fast-path) rank: ₹0 external COGS

Measured and asserted in the artifact (`costCentsPerRankLocal: 0`). The only cost is
your own CPU/DB time: a 200-resume slate consumes ~7 s warm, ~24 s cold, of wall-clock
queue capacity. **This is the single most important fact in this document** — it means
local ranking can be given away almost without limit, and the free tier does not have
to be stingy where the product is most felt.

### Deep (LLM `mode: "full"`) rank: ₹0.02 – ₹4.18 each

Estimated from `MODEL_PRICING_TABLE` at `estimateTokensFromText` (chars/3.8), prompt
sized from the real corpus, completion priced **twice**: "typical" at 250 tokens and
"capped" at the actual `maxTokens: 2200` in `src/lib/recruiting/ai.server.ts:672`. The
capped column is what a provider bill shows if the model rambles; an earlier draft of
this analysis priced only the typical case and understated the worst case ~9×.

| resume / JD | Gemini 2.0 Flash | gpt-4o-mini | Groq llama-3.3-70b | xAI grok-4.5 |
|---|---|---|---|---|
| 4k / 3k chars (typical Indian resume + JD) | ₹0.029 → 0.096 | ₹0.043 → 0.145 | ₹0.137 → 0.270 | ₹0.622 → 2.308 |
| 4k / 8k chars (JD at `MAX_JD_CHARS`) | ₹0.040 → 0.108 | ₹0.060 → 0.162 | ₹0.204 → 0.337 | ₹0.849 → 2.536 |
| 40k / 8k (PDF at the 40k ingest cap) | ₹0.122 → 0.190 | ₹0.183 → 0.285 | ₹0.687 → 0.821 | ₹2.488 → 4.175 |

*(typical → capped; 12k-char resumes sit between rows 1–2 and 3–4, at ₹0.047–1.21 per rank.)*

The provider spread is **20–40×** for identical work. Any per-rank price is therefore a
statement about ladder order, not about the product; the ladder in
`src/lib/recruiting/providers.server.ts` must be pinned (cheapest-first) before caps
based on ₹/rank are trustworthy.

### A single auto-deepen run costs ₹0.35 → ₹50

`deepenRoleTopN` defaults to `topN: 12` (`src/lib/recruiting/deepen.server.ts:16`), each
rank at `mode: "full"` (`deepen.server.ts:97`). Twelve ranks is therefore:

| | gemini | openai | groq | xai |
|---|---|---|---|---|
| typical resume, typical completion | ₹0.35 | ₹0.52 | ₹1.64 | ₹7.46 |
| 40k resume, capped completion | ₹2.28 | ₹3.42 | ₹9.85 | **₹50.10** |

### Async screen generation: ₹0.08 – ₹1.90 per call, and it fires on public traffic

`generateScreen` (`src/lib/recruiting/ai.server.ts:1057`) goes through `complete()` →
`completeWithLadder` with **`maxTokens: 1800`** (`ai.server.ts:1073`, ladder invoked at
`ai.server.ts:249-256`). Priced at 2,000 prompt tokens (role + JD + rank summary + the
instruction block) against the 1,800-token cap, from the same `MODEL_PRICING_TABLE`:

| model | at cap | typical (~700 completion tok) |
|---|---|---|
| gemini-2.0-flash | ₹0.080 | ₹0.034 |
| gpt-4o-mini | ₹0.119 | ₹0.052 |
| groq llama-3.3-70b | ₹0.224 | ₹0.113 |
| xAI grok-4.5 | ₹1.903 | ₹0.754 |

This matters more than its unit price suggests, because **it is reachable without a
login** — see leak §8.1. 1,000 anonymous applications in a month on one free tenant's
portal is ₹80 → ₹1,900 of platform money.

*(Derived by hand from the pricing table rather than emitted by the benchmark artifact;
`tokensEstimated` applies. Validate against real `model_cost_logs` rows.)*

---

## 4. What the economics imply about the free/paid line

Because local ranking costs ₹0 and the LLM ladder costs up to ₹4.18 per call, the
natural seam is **not** "how many resumes" — it is **`fast` → `full`**, which happens to
be exactly where the user feels a quality jump (evidence-based score vs. reasoned rank
with grounded explanation). Three rules follow:

- **Be generous where COGS is zero.** Volume of local ranks is the thing that makes the
  product stick, and it is the thing that costs nothing. Do not meter it tightly.
- **Meter the ladder, and never let the ladder fire by itself on a free plan.** Every
  automatic `mode: "full"` path is a leak (see §8), and free tier is where leaks are
  fatal because revenue is zero by definition.
- **The free career portal is money-negative today, for the wrong reason.** Its ranking is
  `mode: "fast"` (₹0), but each anonymous application also generates 6 LLM screen questions
  (₹0.08–₹1.90 — §3). The portal should stay free *after* that call is made plan-gated;
  today it is the acquisition surface and the largest unauthenticated bill at once.

---

## 5. Tiers

Pricing numbers below are **assumptions to validate**, not measured. The *caps* are
traceable; the *rupee amounts* are not.

### Free — "Desk" (1 recruiter, self-serve)

| | cap | basis |
|---|---|---|
| Local ranks | **1,000 / month** | 1,000 × cold per-resume 120.7 ms ≈ 2 min of queue CPU/month. ₹0 external COGS; costs us a rounding error, feels unlimited to a solo recruiter. **Assumption to validate: 1,000 vs 500 — depends on Neon write cost.** |
| Batch slate size | **200 resumes** | Exactly the largest slate measured: 24.1 s cold worst case, 6.9 s warm. Above 200 the *user-visible* wait grows linearly and support tickets arrive before revenue does. |
| Active roles | **5** | Product judgement. **Assumption, to validate.** |
| Deep (`full`) ranks | **10 / month, manually triggered only** | 10 × gemini typical ≈ ₹0.4/mo; worst provider+casing 10 × ₹4.18 = ₹41.8/mo ceiling. Deliberately tiny: it is the taste that sells the upgrade. |
| LLM-generated screens | **No** (local question set only) | Otherwise leak §8.1 makes every stranger who applies a cost. The transition to paid should be "sharper questions", not "questions at all". |
| Seats | **3** | Team loop needs ≥3 to be viral (inviter + 2). |
| Career portal | **Yes, on `vetta.app/portal/<slug>`** | `src/routes/portal/$slug.tsx`; ranking is `mode: "fast"` (`src/lib/recruiting/portal.ts:346` → ₹0), and it is the acquisition surface. Never paywall the thing that recruits *for* you — but close §8.1 first. |
| Shortlist share page | **Yes, watermarked** | `src/routes/share.$token.tsx` |
| Exports (XLSX/PDF pack) | **No** | `sheet.ts` / `pdf.ts` — the pack is what an agency hands a client, so it is the paid artifact. |

### Agency Premium — per seat + volume (primary motion)

Agencies are the lead segment because they have *mandates*, which is Vetta's unit of
volume, and because each agency brings its own candidate supply (loop 2).

- Seats: priced per recruiter seat. **Assumption, to validate — needs seat accounting,
  which does not exist yet** (no seat concept anywhere; RBAC has 7 roles / 22 permissions
  in `src/lib/recruiting/rbac.ts` but counts nothing).
- Volume: unlimited local ranks; deep ranks included per-seat with an org-level ₹
  ceiling enforced against `model_cost_logs` (`migrations/0016_observability.sql:20`
  already stores `cost_cents`, `provider`, `task_type` and is indexed by time — **the
  metering substrate for credits already exists, no new instrumentation needed**).
- Adds: own domain portal (drops the `vetta.app` watermark), LLM-generated async screens
  (`generateScreen`, `ai.server.ts:1057`), ATS webhook relay, HITL
  checkpoints (`autonomous-portal-api.ts:102-160`), client packs without watermark,
  rubric versioning (`rubric-version.server.ts`), outcome calibration
  (`outcome.server.ts`), the eval harness (`app/harness.tsx`), multi-org per seat.
- **Concurrency is a paid feature with a real lever:** `processQueueSlice` accepts
  `maxJobs ≤ 64`, `concurrency ≤ 16` (`queue.server.ts:419`). Free stays at 8; agency
  gets 16. Measured derived parallelism was 7.5 against a configured 8, so doubling the
  setting only pays if the DB write path improves — sell it as "priority queue" and
  instrument before promising 2×.

### In-house TA Premium — flat per-seat, unlimited mandates

Same feature wall, different shape: in-house recruiters run *few* roles with *many*
applicants, so caps on roles (5) hurt agencies and caps on volume hurt them not at all.
Package: per-seat, unlimited roles and local ranks, deep-rank credits per seat/month,
SSO + DPDP consent/retention/erasure (`privacy.server.ts`, migration 0015), talent-pool
semantic search (`search.server.ts`), no watermark on the careers portal because it is
their brand anyway. Enterprise (above ~50 seats) is the only place to introduce
custom rubrics, dedicated capacity, and audit export — do not build it before the
first 10 paying logos.

---

## 6. The four viral loops, wired to real files

| # | loop | mechanic | code that must exist / does exist |
|---|---|---|---|
| 1 | **Candidate-facing pages** | Every applicant who submits sees a live status page. That page is read by people who are *also* recruiters at other firms. Add "this is what I use — 200 CVs ranked in 7 seconds" CTA on `src/routes/apply/$applicationId.tsx` and `src/routes/portal/$slug.tsx`. | Routes exist; the CTA does not. The free portal is served at `vetta.app/portal/<slug>`, so every shared link is an ad. |
| 2 | **Client / hiring-manager share page** | An agency sends a shortlist to its client. The client sees ranked candidates with evidence and a "run your own mandate" button. Same for the PDF/XLSX pack footer. | `src/routes/share.$token.tsx`, `share.ts`, `sheet.ts`, `pdf.ts` all exist; watermark is the loop. |
| 3 | **Team invites / seats** | Free tier allows 3 seats, so a second recruiter is *invited* rather than churned. The 4th seat is the paywall, and it arrives at the moment of maximum collaboration. | Real, not stubbed: `rbac.server.ts:140` + `inviteOrgMemberFn` in `src/lib/recruiting/team-api.ts:43`. |
| 4 | **Referral credits** | Credit measured in the currency the product actually spends: **1 referral = 50 deep ranks** for the referee, 10 for the referrer. Cost: 50 × gemini typical ≈ ₹1.45, capped-worst ≈ ₹4.8; against 10 × gemini typical ≈ ₹0.29 for the referrer. Both sides are near-zero unless the ladder lands on xAI — so pin the ladder order first (§3). | Needs a `referrals` table and a credit ledger. `model_cost_logs` gives you the debit side; nothing exists for the grant side. |

Loop 1 and 2 are the ones that compound: candidates and clients are *new accounts per
use*, whereas loops 3 and 4 only deepen accounts you already have.

---

## 7. The forced-upgrade sequence

Virality brings them in; these are the four walls they hit **in order**, each placed so
the value is already proven when the ask arrives. The ordering is deliberate: every step
is a *quality* wall before it is a *quantity* wall, because quantity is what costs ₹0.

| step | trigger | why it converts | measured basis |
|---|---|---|---|
| 1 | **Second seat** | Their colleague is already doing the same drop on the same role; the alternative is emailing spreadsheets. Free allows 3, so this arrives *with* them, not against them — the 4th seat is the ask. | Invite path is real (`rbac.server.ts:140`, `team-api.ts:43`); no cap exists to enforce it yet. |
| 2 | **First deep rank on a live slate** | They have seen a 0.16 ms evidence score (`L1` p50 0.16 ms) on 1,000 resumes; the 10 free `mode:"full"` ranks are the only place they see reasoning + grounded explanation. 10 is enough to feel the difference and not enough to build a workflow on. | ₹0 local vs ₹0.029–₹4.18 per deep rank (§3). |
| 3 | **6th role, or a 201st resume in one drop** | The only purely-numeric walls, placed where the *product* reason exists: role 6 means a real mandate book, and slate 201 means the 24 s cold tail (`queueAge` p95 6.3–22.2 s on exactly 200) becomes user-visible. | L5 200-slate: 6.89 s warm / 24.14 s cold wall, 34.4–120.7 ms per resume. |
| 4 | **First client deliverable** | They try to hand a shortlist to a hiring manager. It carries a `vetta.app` watermark and there is no XLSX/PDF pack on free. For an agency this is not a feature gap, it is embarrassment — which is why agency is the lead segment. | `share.$token.tsx`, `sheet.ts`, `pdf.ts` exist and are ungated today. |

Then, for agencies only, a fifth wall that is pure money: **the org-level monthly ₹
ceiling on ladder spend.** At ₹0.35–₹50 per auto-deepen run (§3) a serious agency's COGS
varies by three orders of magnitude with volume; a ceiling plus overage is how that
becomes margin instead of risk.

**Anti-pattern to avoid:** do not put the first wall on resume volume. Measured local
ranking costs ₹0 external and 34 ms amortised; a free user at 1,000 resumes/month consumes
about two minutes of queue CPU. Metering that feels petty, costs nothing to give away, and
pushes the viral loop out before it has produced value.

---

## 8. Money leaks — and the four blocking defects found on the way

These are the paths where Vetta can spend money (or compute) without a user asking, and
none of them has an entitlement check because **no enforcement exists anywhere today**:
`tier: "freemium" | "premium"` (`src/lib/recruiting/types.ts:691`) is written at
`autonomous-portal.server.ts:496-579` and rendered as static copy in
`src/routes/app/portal.tsx:118-132`, but **nothing reads it before an operation.** The
"Premium Feature / Tier Status: Active" badge a user sees today is hardcoded.

1. **Anonymous portal applications generate paid AI screens — leak #1, and the only one
   reachable with no credentials at all.**
   `applyToJob` (`src/lib/recruiting/portal.ts:289`) is a public POST. Its ranking call is
   `mode: "fast"` (`portal.ts:346`), which costs nothing — but it then calls
   `ensureScreen` **unconditionally** at `portal.ts:452` (and again at `portal.ts:311` for a
   re-applicant), and `ensureScreen` (`portal.ts:231`) imports and runs `generateScreen`
   (`portal.ts:247`) on the provider ladder with `maxTokens: 1800`.
   **Cost: ₹0.08 → ₹1.90 per applicant, forever, on the free plan, triggered by strangers.**
   A single bot, or one viral job posting, converts the free tier's best acquisition surface
   into an uncapped bill.
   *Fix: default free-plan screens to a local/template question set (the question schema is
   already structured, so this is content, not architecture); reserve LLM-generated screens
   for paid plans and behind a per-org monthly ceiling.*
2. **Auto-deepen on batch completion.**
   `queue.server.ts:106-124` fires `deepenRoleTopN({ topN: min(12, ranked) })` the moment
   a batch flips to `completed`, with `mode: "full"` at `deepen.server.ts:97`. No user
   action, no opt-out, no cap. Per batch: ₹0.35 typical → **₹50 worst case** (§3).
   A free user who drops 100 resumes a day, 10 times, is ₹3.5–500/day of your money.
   *Fix: gate on plan, make it opt-in for paid plans, and put an org-level monthly ₹
   ceiling on it, read from `model_cost_logs`.*
3. **`/api/queue/tick` is unauthenticated.** `src/routes/api/queue/tick.ts:12-15` exposes
   GET **and** POST to `processQueueSlice({maxJobs: 4, budgetMs: 50_000})` with no auth.
   An anonymous caller can force queue drains — and, combined with (2), can trigger other
   tenants' LLM spend on demand. *Fix: require an internal secret, or move to a
   server-side cron.*
4. **Public applicants reach the network on the hot path.** Because (1) already puts
   anonymous traffic inside `parseAndRank`, the fast branch's probabilistic outbound
   `fetch` calls at `ai.server.ts:564-574` → `domain-embed.server.ts:172` and
   `calibrate.server.ts:79` (8% of ranks, to third-party URLs) also run for strangers:
   unbounded egress plus a hard dependency on other people's sites, inside the request
   path. *Fix: rate-limit by IP, and move both refreshes off the request path to a timer.*
5. **WhatsApp webhook accepts unverified bodies.**
   `src/routes/api/whatsapp/webhook.ts` is env-gated but does not verify the POST payload,
   and reaches screen turns via `postScreenTurn` (`src/lib/recruiting/screen-session.ts:258`),
   which is token-auth only.
   **Still untraced:** whether a token-link visitor can cause further LLM calls through the
   screen-answer path — `generateAsyncScreen` at `api.ts:980` *is* auth-gated to the
   recruiter, so the exposure is `ensureScreen`'s call chain above, not that route.
6. For completeness, the recruiter-initiated ladder paths (not leaks, but the metered
   surface): `ingestResume` (`api.ts:685`), rerank/deepen (`api.ts:814, 889, 916`),
   `generateAsyncScreen` (`api.ts:980`).

Also, unrelated to pricing but found while building the benchmark and **not patched**
(this checkout is not a git repository, so there is no undo — these need a decision):

1. **`createHash` is not imported in `ai.server.ts`, and every rank throws.**
   `hashPrompt` (`src/lib/recruiting/ai.server.ts:77`) calls bare `createHash`; the file
   has no `node:crypto` import. It is reached from `parseAndRank` at `ai.server.ts:424`,
   i.e. **before** the fast/full branch, so *both* modes die. Confirmed three ways:
   `npm run typecheck` → `TS2304: Cannot find name 'createHash'` (line 78);
   `npm test` → 2 of 146 tests fail with
   `ReferenceError: createHash is not defined` (`resilience.test.ts:125` via
   `queue.server.ts:150` `persistRanked`, and `resilience.test.ts:319`); and my benchmark
   harness had to inject the global to run at all
   (`scripts/bench-resolve-hooks.mjs:24`).
   Fix is the same line `hash.ts:1` already uses: `import { createHash } from "node:crypto";`.
   **Measurement caveat:** the L2/L4/L5 figures in §1 are therefore the cost of the
   pipeline *once this is fixed* — today the code fails in ~0 ms because it never gets to
   any work. The shim is semantically identical to the intended import, so the numbers are
   valid as post-fix figures, not as a description of current behaviour.
   (My earlier working theory — "the bundler resolves this via scope merging" — is
   disproved: it throws in the project's own test suite.)
2. **`ai.server.ts` is not valid UTF-8, and `npm run build` fails because of it.**
   `[UNLOADABLE_DEPENDENCY] Could not load src/lib/recruiting/ai.server.ts — stream did
   not contain valid UTF-8`, from the dynamic import at `screen-session.ts:124`. It is the
   only such file: 1 of 204 scanned under `src/`. It also makes the file uneditable by
   normal tooling. A legacy-encoding (cp1252) byte in a `—`/`₹`-adjacent comment; converting
   that one file to UTF-8 is the fix, and it must be done encoding-preserving rather than
   by re-typing content. **Until then there is no production build, so nothing in §7 or §8
   can be shipped or measured on the deployed path.**
3. `ClientCard` is referenced but not imported at `ai.server.ts:1235`
   (`TS2304`) — a missing type import, harmless at runtime, but it keeps typecheck red.
4. **`rubric_hash` NOT NULL violation.** `deepen.server.ts:132` and `api.ts:873` write
   `rubric_hash = ${ranked.rubricHash || null}` while
   `migrations/0017_rank_provenance_and_stale.sql:17` declares the column
   `not null default ''`. Any deepen whose rubric hash is empty writes NULL and fails.

---

## 9. Out of scope for this document

Stated plainly so nobody reads the tiers above as implementable today:

- **No billing provider exists.** `package.json` has no Stripe, Razorpay, or any payment
  dependency. India-first means Razorpay (+ Stripe for agency clients abroad) is a decision
  to make, not a fact.
- **No entitlement enforcement.** Not a flag system to extend — there is nothing. A
  `plan_entitlements` table plus a server-side check at each `createServerFn` entry is
  prerequisite to every cap in §5.
- **No credit ledger or referral table.** Only the debit side (`model_cost_logs`) exists.
- **No seat counting.** §5 prices per seat; nothing counts seats.
- **The invite flow is real but has no expiry, no cap, and no plan check**
  (`rbac.server.ts:140`).
- **No watermark primitive** for loops 1 and 2.

## 10. Validation checklist before locking numbers

1. **Green the repo first:** add the `node:crypto` import and re-encode `ai.server.ts` as
   UTF-8 (defects 1–2 in §8) so `npm run build`, `npm run typecheck` and `npm test` pass.
   Nothing in §5–§7 is shippable, and no deployed-path measurement is possible, until then.
2. Re-run `npm run bench:match` against **Neon** (`DATABASE_URL` set). L1 should not move;
   L2/L4/L5 will. Every cap in §5 that is expressed in wall-time or DB work is provisional
   until then.
3. Pin the ladder order in `providers.server.ts`, then re-measure ₹/rank against real
   completion lengths — replace the typical/capped pair with actual `model_cost_logs`
   rows from production traffic.
4. Measure the **90th-percentile real resume length** from production `candidates.resume_text`
   and re-price; the 4k/12k/40k buckets here are corpus-shaped, not market-shaped.
5. Instrument queue-age p95 per tenant (already written by `recordQueueMetric` from
   `processOne`, `src/lib/recruiting/queue.server.ts:348`) to decide whether the free slate
   cap is 200 or 100.
6. Add `npm run bench:match` to CI with the regression gate (`--freeze-baseline`,
   `--max-drift`; currently `mode: "vs-in-file-targets"`, gate PASS) so a DB-path
   regression that eats the free-tier margin is caught in review, not in billing.
