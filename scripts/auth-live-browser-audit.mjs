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
      // wait
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

async function main() {
  console.log("=== Launching local dev server for authenticated audit ===");
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
  console.log("Dev server ready on http://127.0.0.1:8080");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log("\n--- Authenticating Session on /login ---");
  await page.goto("http://127.0.0.1:8080/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  // Switch to sign-up tab and create ephemeral session
  const testEmail = `founder_${Date.now()}@nexuscore.tech`;
  const testPass = "NexusFounder2026!";

  // Click Sign up button
  const signUpTab = page.locator('button:has-text("Sign up")');
  if (await signUpTab.isVisible()) {
    await signUpTab.click();
    await page.waitForTimeout(400);
  }

  await page.fill('input[type="email"]', testEmail);
  await page.fill('input[type="password"]', testPass);
  const nameInput = page.locator('input[placeholder*="Name"], input[name="name"]');
  if (await nameInput.isVisible()) {
    await nameInput.fill("Anupam Founder");
  }

  console.log(`Submitting auth for ${testEmail}...`);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);

  console.log("\n--- Testing 8. 60-Second Inbox Zero Triage (/app/triage) ---");
  await page.goto("http://127.0.0.1:8080/app/triage", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "./screenshots/08_app_triage_authed.png" });

  const triageText = await page.locator("body").innerText();
  console.log("Triage page title visible:", triageText.includes("Triage") || triageText.includes("Inbox Zero"));

  // Click "Pass Candidate" to verify taste flywheel action
  const passBtn = page.locator('button:has-text("Pass Candidate")');
  if (await passBtn.isVisible()) {
    console.log("Found Pass Candidate button — clicking to verify flywheel telemetry...");
    await passBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "./screenshots/08_app_triage_after_action.png" });
    console.log("Action captured and screenshot saved.");
  }

  console.log("\n--- Testing 9. Offer Guard Pre-boarding Radar (/app/offer-guard) ---");
  await page.goto("http://127.0.0.1:8080/app/offer-guard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "./screenshots/09_offer_guard_authed.png" });

  const guardText = await page.locator("body").innerText();
  console.log("Offer Guard visible:", guardText.includes("Offer Guard") || guardText.includes("Pre-boarding") || guardText.includes("Hazard"));

  await browser.close();
  server.kill();

  console.log("\nAuthenticated tests completed successfully.");
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
