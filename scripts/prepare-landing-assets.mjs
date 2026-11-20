/**
 * Converts generated brand art into web-ready assets and renders PWA icons.
 * Run: node scripts/prepare-landing-assets.mjs
 */
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const abs = (p) => path.resolve(root, p);

const JOBS = [
  {
    src: "vibe_images/vetta-hero-poster_1794381696217_cec852ce.png",
    out: "public/hero-poster.webp",
    type: "image/webp",
    quality: 0.82,
    width: 1600,
  },
  {
    src: "vibe_images/vetta-bust-silhouette_1794381718038_0429d67a.png",
    out: "public/bust-mask.webp",
    type: "image/webp",
    quality: 0.9,
    width: 512,
    alphaFromLuma: true,
  },
  {
    src: "vibe_images/vetta-og-card_1794381741104_3a20850b.png",
    out: "public/og.jpg",
    type: "image/jpeg",
    quality: 0.85,
    crop: { w: 1200, h: 630 },
  },
];

const ICONS = [
  { size: 192, out: "public/icon-192.png" },
  { size: 512, out: "public/icon-512.png" },
];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const job of JOBS) {
    await page.goto("file://" + abs(job.src));
    const dataUrl = await page.evaluate(async (opts) => {
      const img = document.querySelector("img");
      await img.decode();
      const sw = img.naturalWidth;
      const sh = img.naturalHeight;
      let sx = 0;
      let sy = 0;
      let cw = sw;
      let ch = sh;
      let dw;
      let dh;
      if (opts.crop) {
        const scale = Math.max(opts.crop.w / sw, opts.crop.h / sh);
        cw = opts.crop.w / scale;
        ch = opts.crop.h / scale;
        sx = (sw - cw) / 2;
        sy = (sh - ch) / 2;
        dw = opts.crop.w;
        dh = opts.crop.h;
      } else {
        dw = opts.width;
        dh = Math.round((sh / sw) * opts.width);
      }
      const canvas = document.createElement("canvas");
      canvas.width = dw;
      canvas.height = dh;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, sx, sy, cw, ch, 0, 0, dw, dh);
      if (opts.alphaFromLuma) {
        const data = ctx.getImageData(0, 0, dw, dh);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          px[i + 3] = px[i];
        }
        ctx.putImageData(data, 0, 0);
      }
      return canvas.toDataURL(opts.type, opts.quality);
    }, job);
    await writeFile(abs(job.out), Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log("wrote", job.out);
  }

  const favicon = await readFile(abs("public/favicon.svg"), "utf8");
  const faviconUrl = "data:image/svg+xml;base64," + Buffer.from(favicon).toString("base64");
  for (const icon of ICONS) {
    await page.goto("about:blank");
    const dataUrl = await page.evaluate(async ({ size, faviconUrl }) => {
      const img = new Image();
      img.src = faviconUrl;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#07100F";
      ctx.fillRect(0, 0, size, size);
      const inner = size * 0.72;
      const offset = (size - inner) / 2;
      ctx.drawImage(img, offset, offset, inner, inner);
      return canvas.toDataURL("image/png");
    }, { size: icon.size, faviconUrl });
    await writeFile(abs(icon.out), Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log("wrote", icon.out);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});