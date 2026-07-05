// ===========================================================================
// CollaborateMD report puller
// ---------------------------------------------------------------------------
// Downloads the daily reports out of CollaborateMD as Excel files, ready to
// import into BC Billing. Built from the walkthrough videos.
//
// It handles the repetitive part; YOU handle the two things that change each
// day (the date range and which customers), because picking those wrong would
// pull the wrong numbers.
//
// For each report the bot:
//   1. opens the report in Reports -> Viewer,
//   2. PAUSES so you set the date range + select customers,
//   3. clicks Run Report,
//   4. answers "Separate per customer?" with "No, Combine",
//   5. Print/Export -> Export as Excel,
//   6. saves the download into the  reports\  folder with today's date.
//
// SAFETY: visible browser, you log in yourself, nothing is changed in
// CollaborateMD (reports are read-only). Files are only downloaded.
//
// Run:  node pull-reports.mjs
// ===========================================================================

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const START_URL = process.env.CMD_URL || "https://app.collaboratemd.com/";
const OUT_DIR = process.env.REPORTS_DIR || "reports";
const T = Number(process.env.STEP_TIMEOUT || 30000);

// The reports to pull, in order. `open` is the exact report name as it appears
// in CollaborateMD's report list / "Recently Ran". `save` is the filename stem
// used for the downloaded Excel (today's date is appended).
const REPORTS = [
  { open: "Claims Billed Report", save: "Billed", combine: true },
  { open: "FACILITY PAID PER CPT LEVEL OF CARE 1", save: "Payment", combine: true },
  // Add later, once we film them:
  // { open: "Prefix Data",  save: "DataPrefix", combine: true },
  // { open: "<AR report name>", save: "AR", combine: true },
];

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a); }));
}

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

async function openReport(page, name) {
  // Go to Reports -> Viewer.
  const step = (s) => { page.__step = s; process.stdout.write(`\n      · ${s}`); };

  step("open Reports menu");
  // The left-nav "Reports" item; then its "Viewer" child.
  const reports = page.getByText("Reports", { exact: true }).first();
  if (await reports.isVisible().catch(() => false)) {
    await reports.click({ timeout: T }).catch(() => {});
  }
  const viewer = page.getByText("Viewer", { exact: true }).first();
  if (await viewer.isVisible().catch(() => false)) {
    await viewer.click({ timeout: T }).catch(() => {});
  }

  step(`find report "${name}"`);
  // The report can be opened from the search box or the Recently Ran list.
  // Clicking its name anywhere in the report list opens its filter tab.
  const link = page.getByText(name, { exact: true }).first();
  await link.waitFor({ timeout: T });
  await link.click({ timeout: T });
  // The report's filter tab opens with a Run Report button.
  await page.getByRole("button", { name: /Run Report/i }).first().waitFor({ timeout: T });
}

async function runAndExport(page, report) {
  const step = (s) => { page.__step = s; process.stdout.write(`\n      · ${s}`); };

  step("click Run Report");
  await page.getByRole("button", { name: /Run Report/i }).first().click({ timeout: T });

  // "Would you like to separate this report per customer?" -> No, Combine.
  step("answer separate/combine");
  const combineBtn = page.getByRole("button", { name: /No,\s*Combine/i }).first();
  const separateBtn = page.getByRole("button", { name: /Yes,\s*Separate/i }).first();
  if (await combineBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
    await (report.combine ? combineBtn : separateBtn).click({ timeout: T }).catch(() => {});
  }

  // Wait for the report to finish rendering (the Print/Export button appears).
  step("wait for report to render");
  const exportMenu = page.getByRole("button", { name: /Print.*Export/i }).first();
  await exportMenu.waitFor({ timeout: T });

  step("Print/Export -> Export as Excel");
  await exportMenu.click({ timeout: T });
  const excel = page.getByText(/Export as Excel/i).first();
  await excel.waitFor({ timeout: T });

  // Catch the download that the click triggers.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: T }),
    excel.click({ timeout: T }),
  ]);

  const file = path.join(OUT_DIR, `${report.save}_${todayStamp()}.xlsx`);
  await download.saveAs(file);
  return file;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`\n  Will pull ${REPORTS.length} report(s): ${REPORTS.map((r) => r.save).join(", ")}`);
  console.log(`  Saving Excel files into the  ${OUT_DIR}\\  folder.\n`);

  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const page = await browser.newPage({ viewport: null, acceptDownloads: true });
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  console.log("  A browser window opened. Log in to CollaborateMD yourself.");
  await ask("  When you see the home screen, press Enter here to start... ");

  const results = [];
  for (const report of REPORTS) {
    console.log(`\n  ────────────────────────────────────────────────────────`);
    console.log(`  Report: ${report.open}`);
    console.log(`  ────────────────────────────────────────────────────────`);
    try {
      await openReport(page, report.open);
      console.log(
        `\n\n  ▶ The report is open. Now, in the browser:` +
          `\n     1. Set the DATE RANGE (General tab).` +
          `\n     2. Select the CUSTOMERS you want (Customer tab).`
      );
      await ask("  Then press Enter here and I'll run + export it... ");
      const file = await runAndExport(page, report);
      console.log(`\n   ✓ Saved ${file}`);
      results.push({ report: report.save, file, ok: true });
    } catch (err) {
      const msg = (err && err.message ? err.message : String(err)).split("\n")[0];
      const shot = path.join(OUT_DIR, `error-${report.save}-${todayStamp()}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      console.log(`\n   ✗ FAILED [at: ${page.__step || "?"}]: ${msg}`);
      console.log(`   📸 Saved a screenshot to ${shot} — send me that image.`);
      results.push({ report: report.save, ok: false, step: page.__step, msg });
    }
  }

  console.log(`\n  ────────────────────────────────────────────────────────`);
  console.log("  Done. Summary:");
  for (const r of results) {
    console.log(r.ok ? `   ✓ ${r.report} -> ${r.file}` : `   ✗ ${r.report} (${r.step}: ${r.msg})`);
  }
  console.log(`\n  Next: import these Excel files into BC Billing (Billed tab, Payments tab).`);
  await ask("  Press Enter to close the browser... ");
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
