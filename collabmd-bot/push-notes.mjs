// ===========================================================================
// CollaborateMD note bot
// ---------------------------------------------------------------------------
// Reads a list of { claim_id, note } from notes.csv and, for each one:
//   1. opens the Claim search in CollaborateMD,
//   2. searches the claim id and opens the claim,
//   3. expands Patient Notes -> Add Note, types the note, clicks Done,
//   4. clicks Save.
// It writes results.csv (one row per claim: ok / skipped / error).
//
// SAFETY:
//   - Runs in a VISIBLE browser window so you can watch every step.
//   - You log in yourself (handles any account picker / prompts); the bot
//     only does the repetitive note entry after you press Enter.
//   - Set DRY_RUN=1 to do everything EXCEPT the final Save (a safe rehearsal).
//
// This is a first version built from the walkthrough video. A couple of the
// on-screen button names may need a one-time tweak against the live site —
// see README.md ("If a step can't find a button").
// ===========================================================================

import { chromium } from "playwright";
import fs from "node:fs";
import readline from "node:readline";

const START_URL = process.env.CMD_URL || "https://app.collaboratemd.com/";
const DRY_RUN = process.env.DRY_RUN === "1";
const NOTES_FILE = process.env.NOTES_FILE || "notes.csv";
const RESULTS_FILE = "results.csv";
// Per-claim timeout for finding elements (ms). Bump if the site is slow.
const T = Number(process.env.STEP_TIMEOUT || 20000);

// ---- tiny CSV reader (handles quoted fields + newlines in notes) ----------
function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readNotes() {
  if (!fs.existsSync(NOTES_FILE)) {
    console.error(`\n  Could not find ${NOTES_FILE}. Create it with two columns:\n  claim_id,note\n`);
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(NOTES_FILE, "utf8")).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) { console.error("  notes.csv is empty."); process.exit(1); }
  // Detect + drop a header row.
  const [h0, h1] = rows[0].map((s) => (s || "").trim().toLowerCase());
  const start = h0 === "claim_id" || h1 === "note" ? 1 : 0;
  return rows.slice(start)
    .map((r) => ({ claim_id: (r[0] || "").trim(), note: (r[1] || "").trim() }))
    .filter((r) => r.claim_id && r.note);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a); }));
}

const results = [];
function record(claim_id, status, detail = "") {
  results.push({ claim_id, status, detail });
  const line = `${claim_id},${status},"${detail.replace(/"/g, "'")}"\n`;
  fs.appendFileSync(RESULTS_FILE, line);
}

// ---- the per-claim automation --------------------------------------------
async function pushNote(page, claim_id, note) {
  // 1) Open Claim search. The search box placeholder is distinctive.
  const searchBox = page.getByPlaceholder(/Search by name.*claim ID/i);
  if (!(await searchBox.isVisible().catch(() => false))) {
    // Not on the Claim screen — use the left-nav "Find a Section" jump box.
    const finder = page.getByPlaceholder(/Find a Section/i);
    await finder.click({ timeout: T });
    await finder.fill("Claim");
    await page.getByText("Claim", { exact: true }).first().click({ timeout: T });
  }
  await searchBox.click({ timeout: T });
  await searchBox.fill(claim_id);
  await searchBox.press("Enter");

  // 2) Open the matching claim row (the row that shows this claim id).
  const row = page.getByRole("row", { name: new RegExp(claim_id) }).first();
  const cell = (await row.isVisible().catch(() => false))
    ? row
    : page.getByText(claim_id, { exact: true }).first();
  await cell.click({ timeout: T });

  // 3) Confirm the claim opened (Claim # field carries the id).
  await page.getByText("Patient Notes", { exact: true }).first().click({ timeout: T });

  // 4) Add Note -> type message -> Done.
  await page.getByRole("button", { name: /Add Note/i }).click({ timeout: T });
  const dialog = page.getByRole("dialog");
  const message = (await dialog.locator("textarea").first().isVisible().catch(() => false))
    ? dialog.locator("textarea").first()
    : page.locator("textarea").last();
  await message.click({ timeout: T });
  await message.fill(note);
  await page.getByRole("button", { name: /^Done$/i }).click({ timeout: T });

  // 5) Save the claim.
  if (DRY_RUN) {
    console.log(`   [DRY RUN] would Save note on claim ${claim_id}`);
    return "dry-run";
  }
  await page.getByRole("button", { name: /^Save$/i }).first().click({ timeout: T });
  await page.waitForTimeout(1200); // let the save settle
  return "ok";
}

async function main() {
  const notes = readNotes();
  console.log(`\n  Loaded ${notes.length} note(s) from ${NOTES_FILE}.`);
  if (DRY_RUN) console.log("  DRY RUN: will do everything except the final Save.\n");

  if (!fs.existsSync(RESULTS_FILE)) fs.writeFileSync(RESULTS_FILE, "claim_id,status,detail\n");

  const browser = await chromium.launch({ headless: false, slowMo: 350 });
  const page = await browser.newPage({ viewport: null });
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  console.log("\n  A browser window opened. Log in to CollaborateMD yourself.");
  await ask("  When you are fully logged in and see the home screen, press Enter here to start... ");

  let ok = 0, fail = 0;
  for (let i = 0; i < notes.length; i++) {
    const { claim_id, note } = notes[i];
    process.stdout.write(`\n  (${i + 1}/${notes.length}) Claim ${claim_id}… `);
    try {
      const status = await pushNote(page, claim_id, note);
      record(claim_id, status);
      console.log(status === "ok" ? "✓ saved" : "✓ (dry run)");
      ok++;
    } catch (err) {
      const msg = (err && err.message ? err.message : String(err)).split("\n")[0];
      record(claim_id, "error", msg);
      console.log(`✗ ${msg}`);
      fail++;
      // Try to get back to a clean state for the next claim.
      await page.keyboard.press("Escape").catch(() => {});
    }
  }

  console.log(`\n  Done. ${ok} processed, ${fail} failed. See ${RESULTS_FILE}.`);
  await ask("  Press Enter to close the browser... ");
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
