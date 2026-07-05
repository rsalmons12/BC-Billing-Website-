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

// The reports to pull, in order.
//   open      = the report name as it appears in CollaborateMD's report list
//   save      = filename stem for the downloaded Excel (today's date appended)
//   datePreset= which entry to pick in the date-range dropdown (General tab)
//   combine   = answer "No, Combine" (true) to the separate-per-customer prompt
const REPORTS = [
  { open: "Claims Billed Report", save: "Billed", datePreset: "This Week", combine: true },
  { open: "FACILITY PAID PER CPT LEVEL OF CARE 1", save: "Payment", datePreset: "This Month", combine: true },
  // Add later, once we film them:
  // { open: "Prefix Data",  save: "DataPrefix", datePreset: "This Week", combine: true },
  // { open: "<AR report name>", save: "AR", datePreset: "This Week", combine: true },
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

const step = (page, s) => { page.__step = s; process.stdout.write(`\n      · ${s}`); };

async function openReport(page, name) {
  // Get back to the report picker. Reports -> Viewer, then the "Run Report" tab
  // (a report opens as its own tab, so we must return to the picker each time).
  step(page, "open Reports -> Viewer");
  const reports = page.getByText("Reports", { exact: true }).first();
  if (await reports.isVisible().catch(() => false)) await reports.click({ timeout: T }).catch(() => {});
  const viewer = page.getByText("Viewer", { exact: true }).first();
  if (await viewer.isVisible().catch(() => false)) await viewer.click({ timeout: T }).catch(() => {});
  const runTab = page.getByText("Run Report", { exact: true }).first();
  if (await runTab.isVisible().catch(() => false)) await runTab.click({ timeout: T }).catch(() => {});

  step(page, `search for "${name}"`);
  // Type the FULL name into the report search box so the whole name matches as
  // one piece (a partial search leaves the name split across bold/normal spans,
  // which the click can't land on cleanly).
  const searchBox = page.getByPlaceholder(/Search for reports/i).first();
  if (await searchBox.isVisible().catch(() => false)) {
    await searchBox.click({ timeout: T });
    await searchBox.fill(name);
    await page.waitForTimeout(900);
  }

  step(page, `open report "${name}"`);
  const rx = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // Prefer the exact tree node; fall back to the "Recently Ran" row.
  const treeNode = page.getByText(name, { exact: true }).first();
  if (await treeNode.isVisible({ timeout: 5000 }).catch(() => false)) {
    await treeNode.click({ timeout: T });
  } else {
    await page.getByRole("row", { name: rx }).first().click({ timeout: T });
  }
  await page.getByRole("button", { name: /Run Report/i }).first().waitFor({ timeout: T });
}

// Set the date-range dropdown (General tab) to a preset like "This Week".
async function setDatePreset(page, preset) {
  step(page, `set date range = ${preset}`);
  const general = page.getByText("General", { exact: true }).first();
  if (await general.isVisible().catch(() => false)) await general.click({ timeout: T }).catch(() => {});
  await page.waitForTimeout(400);
  // The date range is a native <select>; find the one that offers this preset.
  const selects = page.locator("select");
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const opts = await selects.nth(i).locator("option").allTextContents().catch(() => []);
    if (opts.some((o) => o.trim().toLowerCase() === preset.toLowerCase())) {
      await selects.nth(i).selectOption({ label: preset }).catch(async () => {
        // Fallback: a custom dropdown — click it open, then click the option.
        await selects.nth(i).click({ timeout: T }).catch(() => {});
        await page.getByText(preset, { exact: true }).first().click({ timeout: T }).catch(() => {});
      });
      return true;
    }
  }
  console.log(`\n   ⚠ couldn't find a "${preset}" date option — leaving the default. Fix it in the browser if needed.`);
  return false;
}

// Select every customer (Customer tab -> "Select All").
async function selectAllCustomers(page) {
  step(page, "select all customers");
  const cust = page.getByText("Customer", { exact: true }).first();
  if (await cust.isVisible().catch(() => false)) await cust.click({ timeout: T }).catch(() => {});
  await page.waitForTimeout(400);
  const selectAll = page.getByText("Select All", { exact: true }).first();
  await selectAll.waitFor({ timeout: T });
  await selectAll.click({ timeout: T });
}

async function runAndExport(page, report) {
  step(page, "click Run Report");
  await page.getByRole("button", { name: /Run Report/i }).first().click({ timeout: T });

  // "Would you like to separate this report per customer?" -> No, Combine.
  step(page, "answer separate/combine");
  const combineBtn = page.getByRole("button", { name: /No,\s*Combine/i }).first();
  const separateBtn = page.getByRole("button", { name: /Yes,\s*Separate/i }).first();
  if (await combineBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
    await (report.combine ? combineBtn : separateBtn).click({ timeout: T }).catch(() => {});
  }

  // Wait for the report to finish rendering (the Print/Export button appears).
  step(page, "wait for report to render");
  const exportMenu = page.getByRole("button", { name: /Print.*Export/i }).first();
  await exportMenu.waitFor({ timeout: T });

  step(page, "Print/Export -> Export as Excel");
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
      // Best-effort auto-fill; if a control isn't standard it just leaves it
      // for you to set during the pause below (never blocks the run).
      await setDatePreset(page, report.datePreset).catch(() => {});
      await selectAllCustomers(page).catch(() => {});
      console.log(
        `\n\n  ▶ The ${report.open} is open. In the browser, make sure:` +
          `\n     1. Date range  =  ${report.datePreset}   (General tab)` +
          `\n     2. Customers   =  Select All             (Customer tab)`
      );
      await ask("  Once those two are set, press Enter and I'll run + export it... ");
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
