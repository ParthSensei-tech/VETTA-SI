import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("./screenshots", { recursive: true });

async function waitForServer(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 302) return true;
    } catch {
      // waiting
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

async function main() {
  console.log("=== Launching local dev server for full browser audit ===");
  const server = spawn("cmd.exe", ["/c", "npm", "run", "dev"], {
    stdio: "inherit",
    env: { ...process.env, PORT: "8080" },
  });

  const ready = await waitForServer("http://127.0.0.1:8080/", 45000);
  if (!ready) {
    console.error("Failed to connect to dev server on 8080");
    server.kill();
    process.exit(1);
  }
  console.log("Dev server listening on http://127.0.0.1:8080");

  const browser = await chromium.launch({ headless: true });
  const results = [];

  const targets = [
    {
      name: "1. Landing & Home",
      url: "http://127.0.0.1:8080/",
      screenshot: "./screenshots/01_home.png",
      check: async (page) => {
        const text = await page.locator("body").innerText();
        return text.includes("Vetta") || text.includes("Work is the Product");
      },
    },
    {
      name: "2. VIP Robinhood Waitlist & Referral",
      url: "http://127.0.0.1:8080/waitlist",
      screenshot: "./screenshots/02_waitlist.png",
      check: async (page) => {
        const text = await page.locator("body").innerText();
        return text.includes("Cohort 1") || text.includes("Waitlist") || text.includes("Queue");
      },
    },
    {
      name: "3. Founder WhatsApp Intake Slug (vetta.ai/f/anupam)",
      url: "http://127.0.0.1:8080/f/anupam",
      screenshot: "./screenshots/03_founder_slug.png",
      check: async (page) => {
        const text = await page.locator("body").innerText();
        return text.includes("Anupam") && text.includes("Apply via WhatsApp");
      },
    },
    {
      name: "4. Pricing Matrix & Economics",
      url: "http://127.0.0.1:8080/pricing",
      screenshot: "./screenshots/04_pricing.png",
      check: async (page) => {
        const text = await page.locator("body").innerText();
        return text.includes("2,499") || text.includes("Pricing") || text.includes("GaaS");
      },
    },
    {
      name: "5. Competitive Moat: vs Naukri",
      url: "http://127.0.0.1:8080/compare/naukri",
      screenshot: "./screenshots/05_compare_naukri.png",
      check: async (page) => {
        const text = await page.locator("body").innerText();
        return text.includes("Naukri") && text.includes("12-min Hinglish voice screen");
      },
    },
    {
      name: "6. Competitive Moat: vs LinkedIn",
      url: "http://127.0.0.1:8080/compare/linkedin",
      screenshot: "./screenshots/06_compare_linkedin.png",
      check: async (page) => {
        const text = await page.locator("body").innerText();
        return text.includes("LinkedIn") && text.includes("Offer Guard");
      },
    },
    {
      name: "7. Competitive Moat: vs Traditional Agency",
      url: "http://127.0.0.1:8080/compare/agency",
      screenshot: "./screenshots/07_compare_agency.png",
      check: async (page) => {
        const text = await page.locator("body").innerText();
        return text.includes("Agency") && text.includes("2,499 per verified finalist");
      },
    },
    {
      name: "8. 60-Second Inbox Zero Triage & Taste Flywheel",
      url: "http://127.0.0.1:8080/app/triage",
      screenshot: "./screenshots/08_app_triage.png",
      action: async (page) => {
        // Test interactive candidate pass & flywheel logging
        const passBtn = page.locator('button:has-text("Pass Candidate")');
        if (await passBtn.isVisible()) {
          await passBtn.click();
          await page.waitForTimeout(600);
        }
      },
      check: async (page) => {
        const text = await page.locator("body").innerText();
        return text.includes("Triage") || text.includes("Finalist") || text.includes("Match Score");
      },
    },
    {
      name: "9. Offer Guard Pre-boarding Radar",
      url: "http://127.0.0.1:8080/app/offer-guard",
      screenshot: "./screenshots/09_offer_guard.png",
      check: async (page) => {
        const text = await page.locator("body").innerText();
        return text.includes("Offer Guard") || text.includes("Ghosting") || text.includes("Dropout");
      },
    },
    {
      name: "10. Public Jobs Board",
      url: "http://127.0.0.1:8080/jobs",
      screenshot: "./screenshots/10_jobs.png",
      check: async (page) => {
        const text = await page.locator("body").innerText();
        return text.includes("Jobs") || text.includes("Roles") || text.includes("Vetta");
      },
    },
  ];

  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    console.log(`\nTesting: ${target.name} -> ${target.url}`);
    try {
      await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(1500);

      if (target.action) {
        await target.action(page);
      }

      await page.screenshot({ path: target.screenshot, fullPage: false });

      const passed = target.check ? await target.check(page) : true;
      const cleanConsole = errors.length === 0;

      results.push({
        name: target.name,
        url: target.url,
        passed,
        cleanConsole,
        errors,
        screenshot: target.screenshot,
      });

      console.log(`  Verdict: ${passed && cleanConsole ? "✅ PASS" : "⚠️ ISSUES DETECTED"}`);
      if (errors.length > 0) console.log(`  Console Errors:`, errors);
    } catch (err) {
      console.error(`  Failed on ${target.name}:`, err.message);
      results.push({
        name: target.name,
        url: target.url,
        passed: false,
        cleanConsole: false,
        errors: [err.message],
        screenshot: target.screenshot,
      });
    } finally {
      await page.close();
    }
  }

  await browser.close();
  server.kill();

  console.log("\n================ FULL TEST SUMMARY ================");
  console.log(JSON.stringify(results, null, 2));

  const allPassed = results.every((r) => r.passed && r.cleanConsole);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
