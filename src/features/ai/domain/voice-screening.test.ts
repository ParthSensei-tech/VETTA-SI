import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseHinglishScreeningEntities,
  detectProxyAndCheatingAnomalies,
} from "../server/voice-screening.server.ts";

describe("Voice Screening Agent & Hinglish Entity Normalizer", () => {
  test("parseHinglishScreeningEntities correctly extracts notice and buyback", () => {
    const text = "Main abhi Swiggy me hu. Mera notice period 90 days ka hai, but agar team urgent hai toh buyback possible hai.";
    const entities = parseHinglishScreeningEntities(text);

    assert.equal(entities.noticeDays, 90);
    assert.equal(entities.buybackPossible, true);
  });

  test("parseHinglishScreeningEntities extracts already resigned paper-drop notice", () => {
    const text = "Maine already paper drop kar diya hai, 20 days bache hain.";
    const entities = parseHinglishScreeningEntities(text);

    assert.equal(entities.servingNotice, true);
    assert.equal(entities.noticeDays, 20);
  });

  test("parseHinglishScreeningEntities extracts fixed CTC and monthly in-hand in LPA", () => {
    const text = "Mera current package 32 ka hai jisme fixed component 26 LPA hai, aur in-hand 1.8 lakh milta hai.";
    const entities = parseHinglishScreeningEntities(text);

    assert.equal(entities.fixedLpa, 26);
    assert.equal(entities.inHandMonthlyLakh, 1.8);
  });

  test("detectProxyAndCheatingAnomalies flags prolonged response latency pauses", () => {
    const transcript = "So in Kafka, consumer groups allow multiple workers to read partitions concurrently.";
    const latencies = [5200, 6100, 5800, 1200]; // 3 latency pauses > 4.5s
    const res = detectProxyAndCheatingAnomalies({
      durationSeconds: 120,
      transcript,
      responseLatenciesMs: latencies,
    });

    assert.ok(res.proxyRiskScore >= 35);
    assert.ok(res.cheatingFlags.includes("LATENCY_JITTER_PROCTOR_WHISPER"));
  });

  test("detectProxyAndCheatingAnomalies flags verbatim LLM essay phrasing in spoken interview", () => {
    const transcript = "Firstly, microservices decouple deployments. Secondly, caching improves latency. In conclusion, it is important to remember that eventual consistency must be balanced with availability.";
    const res = detectProxyAndCheatingAnomalies({
      durationSeconds: 60,
      transcript,
    });

    assert.ok(res.cheatingFlags.includes("VERBATIM_LLM_SCRIPT_RECITATION"));
    assert.ok(res.proxyRiskScore >= 30);
  });
});
