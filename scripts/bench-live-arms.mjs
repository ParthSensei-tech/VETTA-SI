#!/usr/bin/env node
/**
 * L7 — measure the arms that are actually live on this machine.
 *
 * Every other benchmark phase pre-opens the provider circuits, so it measures the decision to skip a
 * model rather than the model. This phase does the opposite: with real credentials in the shell
 * environment (and Ollama running, if you want the local arm), it ranks resumes through the product
 * path once per provider — with only that provider's keys visible, so the router cannot cheat by
 * falling back — reports what each one took, and leaves the rows in `model_cost_logs`, which is
 * what `routerHistory()` reads. The per-call timeouts derived in `model-router.ts` stop being my
 * laptop-CPU estimates and start being your machine's measurements.
 *
 *   node --experimental-strip-types --import ./scripts/bench-resolve-hooks.mjs \
 *       scripts/bench-live-arms.mjs --reps=3 --deepen-apps=30
 *
 * Nothing is called that has no key, so with an empty environment this costs nothing and says so.
 * xAI is skipped unless --allow-owner-quota, because that spend is the app owner's real quota.
 */

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.slice(name.length + 3);
};

const opts = {
  reps: Math.max(1, Number(flag("reps", 3))),
  slate: Math.max(6, Number(flag("slate", 12))),
  context: ["interactive", "bulk", "background"].includes(flag("context", ""))
    ? flag("context", "background")
    : "background",
  deadlineMs: Math.max(1_000, Number(flag("arm-deadline-ms", 240_000))),
  deepenApps: Math.max(0, Number(flag("deepen-apps", 0))),
  allowOwnerQuota: argv.includes("--allow-owner-quota"),
};

console.log(
  `live-arm benchmark — context=${opts.context}, deadline=${opts.deadlineMs}ms, reps=${opts.reps}` +
    `${opts.deepenApps ? `, deep-rank=${opts.deepenApps} apps` : ""}`,
);

const P = await import("../src/lib/recruiting/benchmark/phases.server.ts");
const ctx = await P.setupBench({
  slateSize: Math.max(opts.slate, opts.deepenApps) + 6,
  orgCoversTraining: false,
});
if (opts.deepenApps) {
  // The deepen walk is sequential on purpose: that is what a shortlist review does.
  console.log(
    `  ranking ${opts.deepenApps} more resumes one after another, through whichever arm wins...`,
  );
}

const L7 = await P.phaseLiveArms(ctx, {
  reps: opts.reps,
  context: opts.context,
  deadlineMs: opts.deadlineMs,
  allowOwnerQuota: opts.allowOwnerQuota,
  deepenApps: opts.deepenApps,
});

const pad = (s, n) => String(s).padEnd(n);

const promptSample = `${ctx.roles[0].jdText}\n\nResume:\n${ctx.resumes[0].resumeText}`;

/** What each real call site now pays: the arm, and the attempt budget derived from the new history. */
const CALL_SITES = [
  { label: "rerank one candidate", context: "interactive", deadlineMs: 16_000 },
  { label: "shortlist deepen (bulk)", context: "bulk", deadlineMs: 45_000 },
  { label: "detached auto-deepen", context: "background", deadlineMs: 120_000 },
];

if (L7.armsMeasured.length) {
  console.log(
    `\n${pad("provider", 20) + pad("reps", 6) + pad("served", 8) + pad("asked", 8)}` +
      `${pad("local", 8) + pad("err", 6) + pad("p50", 10) + pad("p95", 10)}total`,
  );
  console.log(
    "  served = the provider's own answer was used | asked = it was asked and did not land, " +
      "so the local engine finished | local = the router chose the free arm despite these keys",
  );
  for (const m of L7.armsMeasured) {
    console.log(
      pad(m.provider, 20) +
        pad(m.reps, 6) +
        pad(m.servedByProvider, 8) +
        pad(m.askedButFinishedLocal, 8) +
        pad(m.choseLocalAnyway, 8) +
        pad(m.errored, 6) +
        pad(`${m.stats.p50}ms`, 10) +
        pad(`${m.stats.p95}ms`, 10) +
        `${((m.stats.mean * m.reps) / 1000).toFixed(1)}s`,
    );
    console.log(`  offered: ${m.armsOffered.join(", ")}`);
  }
  // The ledger is the router's own view: these are the numbers the next timeout is computed from.
  console.log(
    "\nwhat the router now believes (per arm, straight from model_cost_logs):\n" +
      "  the table above is the whole product call; these are the model-only durations the router times against.",
  );
  for (const m of L7.armsMeasured) {
    console.log(`  ${m.provider}:`);
    if (!m.ledger.length) {
      console.log(
        "    no rank rows — every attempt fell back to the local arm before this one served",
      );
      continue;
    }
    for (const h of m.ledger) {
      console.log(
        `    ${pad(h.armId, 32)}${pad(`p50 ${h.p50DurationMs}ms`, 16)}` +
          `${pad(`tok/s ${h.tokensPerSec ?? "—"}`, 14)}` +
          `${pad(`${h.avgCostCents}c/rank`, 12)}` +
          `${pad(`success ${h.successRate}`, 14)}samples ${h.samples}`,
      );
      if (h.abortedSamples) {
        console.log(
          `      ${h.abortedSamples} aborted (up to ${h.abortedElapsedMaxMs}ms) — censored: our deadline set those, not the arm`,
        );
      }
    }
  }
  if (L7.deepen) {
    console.log(
      `\ndeep-rank walk: ${L7.deepen.apps} apps in ${(L7.deepen.wallMs / 1000).toFixed(1)} s ` +
        `(${L7.deepen.perAppMs} ms/app) -> 200 apps ≈ ${(L7.deepen.projected200Ms / 60000).toFixed(1)} min`,
    );
  }

  // The payoff: the same route decision, re-planned now that this machine's numbers are in the ledger.
  const { planRoute, clearRouterBeliefs } =
    await import("../src/lib/recruiting/model-router.server.ts");
  // `planRoute` reuses a one-second-old history window; the reps above just wrote a fresher one.
  clearRouterBeliefs();
  console.log("\nwhat the next rank call will actually be given (planned from the rows above):");
  for (const site of CALL_SITES) {
    try {
      const d = await planRoute({
        task: "rank",
        promptText: promptSample,
        requestedMaxTokens: 1_400,
        orgId: ctx.orgId,
        context: site.context,
        deadlineMs: site.deadlineMs,
        allowOwnerQuota: opts.allowOwnerQuota,
      });
      const clock = d.rejected.filter((r) => r.reason === "deadline").map((r) => r.armId);
      console.log(
        `  ${pad(site.label, 24)}${pad(d.chosen?.id ?? "none", 30)}` +
          `${pad(`timeout ${d.timeoutMs}ms`, 18)}` +
          `${pad(`tokens ${d.suggestedMaxTokens}/${d.maxTokens}`, 18)}` +
          (clock.length ? `excluded on the clock: ${clock.join(", ")}` : ""),
      );
    } catch (e) {
      console.log(
        `  ${pad(site.label, 24)}route plan failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
} else {
  console.log("\nNo live arm to measure.");
}
if (L7.armsSkipped.length) {
  console.log("\nskipped:");
  for (const s of L7.armsSkipped) console.log(`  ${pad(s.armId, 32)}${s.why}`);
}
console.log(`\n${L7.note}`);
console.log(
  "Supply keys in the shell only (never a .env file), e.g.\n" +
    "  export GROQ_API_KEY=... GEMINI_API_KEY=... && ollama serve\n" +
    "then re-run this command.",
);
