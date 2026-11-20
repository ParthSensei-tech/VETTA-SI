/** Landing QA shots: desktop + mobile, motion enabled, waits for the 3D chunk. */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const out = path.resolve(process.cwd(), "screenshots");
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
for (const vp of [
  { name: "landing-hero-desktop", width: 1440, height: 900 },
  { name: "landing-hero-mobile", width: 390, height: 844 },
]) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: "no-preference",
  });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: path.join(out, `${vp.name}.png`) });
  const info = await page.evaluate(() => ({
    canvas: !!document.querySelector("canvas"),
    cores: navigator.hardwareConcurrency,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  console.log(vp.name, JSON.stringify({ ...info, errors }));
  await page.close();
}
await browser.close();