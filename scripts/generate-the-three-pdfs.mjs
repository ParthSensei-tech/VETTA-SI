import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const ARTIFACT_DIR = 'C:\\Users\\punam\\.gemini\\antigravity\\brain\\f7498143-764f-4bb0-9bdd-8e4543329ac7';
const DOCS_DIR = path.resolve('docs');

const jobs = [
  {
    htmlFile: path.join(DOCS_DIR, 'vetta_product_bible_0_to_100.html'),
    pdfFile: path.join(DOCS_DIR, 'vetta_product_bible_0_to_100.pdf'),
    artifactPdf: path.join(ARTIFACT_DIR, 'vetta_product_bible_0_to_100.pdf'),
    format: 'A4',
    landscape: false,
    name: '1. Vetta Product Bible (0 to 100)',
  },
  {
    htmlFile: path.join(DOCS_DIR, 'vetta_founders_war_book.html'),
    pdfFile: path.join(DOCS_DIR, 'vetta_founders_war_book.pdf'),
    artifactPdf: path.join(ARTIFACT_DIR, 'vetta_founders_war_book.pdf'),
    format: 'A4',
    landscape: false,
    name: "2. The Founder's War Book ($10M MRR GTM)",
  },
  {
    htmlFile: path.join(DOCS_DIR, 'vetta_unicorn_pitch_deck.html'),
    pdfFile: path.join(DOCS_DIR, 'vetta_unicorn_pitch_deck.pdf'),
    artifactPdf: path.join(ARTIFACT_DIR, 'vetta_unicorn_pitch_deck.pdf'),
    format: 'A4',
    landscape: true,
    name: '3. YC Unicorn Pitch Deck (Jensen Huang Persona)',
  },
];

async function generateAll() {
  console.log('Starting Playwright Chromium PDF compilation...');
  const browser = await chromium.launch({ headless: true });

  for (const job of jobs) {
    console.log(`\nCompiling ${job.name}...`);
    const page = await browser.newPage();
    const fileUrl = 'file:///' + job.htmlFile.replace(/\\/g, '/');
    await page.goto(fileUrl, { waitUntil: 'networkidle' });

    await page.pdf({
      path: job.pdfFile,
      format: job.format,
      landscape: job.landscape,
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      preferCSSPageSize: true,
    });

    const stats = fs.statSync(job.pdfFile);
    console.log(`✔ Generated: ${job.pdfFile} (${(stats.size / 1024).toFixed(1)} KB)`);

    // Copy to artifact directory
    fs.copyFileSync(job.pdfFile, job.artifactPdf);
    console.log(`✔ Synced to Artifact Directory: ${job.artifactPdf}`);

    await page.close();
  }

  await browser.close();
  console.log('\nAll 3 PDFs compiled and verified successfully!');
}

generateAll().catch(err => {
  console.error('Fatal error generating PDFs:', err);
  process.exit(1);
});
