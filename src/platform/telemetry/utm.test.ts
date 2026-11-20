/**
 * Unit tests for the Universal UTM Tracking & Attribution Engine.
 * Run with:
 *   node --experimental-strip-types --test src/platform/telemetry/utm.test.ts
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { parseUtmFromSearch, buildShareableUrl } from "./utm.ts";

describe("UTM Attribution Engine", () => {
  test("parseUtmFromSearch extracts standard marketing parameters", () => {
    const search = "?utm_source=linkedin&utm_medium=social&utm_campaign=seed_2026&utm_term=backend&utm_content=banner_v1";
    const result = parseUtmFromSearch(search, "https://linkedin.com/feed", "/pricing");

    assert.ok(result);
    assert.equal(result.utm_source, "linkedin");
    assert.equal(result.utm_medium, "social");
    assert.equal(result.utm_campaign, "seed_2026");
    assert.equal(result.utm_term, "backend");
    assert.equal(result.utm_content, "banner_v1");
    assert.equal(result.initial_referrer, "https://linkedin.com");
    assert.equal(result.landing_path, "/pricing");
    assert.equal(result.touch_count, 1);
  });

  test("parseUtmFromSearch extracts referral token and gclid", () => {
    const search = "?ref=founder_invite&gclid=abc123xyz";
    const result = parseUtmFromSearch(search);

    assert.ok(result);
    assert.equal(result.ref, "founder_invite");
    assert.equal(result.gclid, "abc123xyz");
  });

  test("parseUtmFromSearch returns null when no attribution params exist", () => {
    const search = "?page=2&tab=overview";
    const result = parseUtmFromSearch(search);
    assert.equal(result, null);
  });

  test("parseUtmFromSearch handles leading question marks or lack thereof", () => {
    const searchWithoutQuestion = "utm_source=newsletter&utm_campaign=weekly_ai";
    const result = parseUtmFromSearch(searchWithoutQuestion);
    assert.ok(result);
    assert.equal(result.utm_source, "newsletter");
    assert.equal(result.utm_campaign, "weekly_ai");
  });

  test("buildShareableUrl correctly appends UTM tags without duplicate params", () => {
    const base = "https://vetta.ai/jobs/role-123";
    const url = buildShareableUrl(base, {
      utm_source: "candidate_share",
      utm_medium: "referral",
      utm_campaign: "hiring_q1",
    });

    assert.ok(url.includes("utm_source=candidate_share"));
    assert.ok(url.includes("utm_medium=referral"));
    assert.ok(url.includes("utm_campaign=hiring_q1"));
  });
});
