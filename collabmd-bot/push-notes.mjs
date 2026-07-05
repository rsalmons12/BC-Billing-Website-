// ===========================================================================
// CollaborateMD note bot
// ---------------------------------------------------------------------------
// Reads a list of { claim_id, facility, note } from notes.csv. Because
// CollaborateMD is multi-customer, a claim only appears in search when the
// app is set to the CUSTOMER (facility) that claim belongs to. So the bot:
//   0. groups the notes by facility, and before each facility's claims it
//      pauses so YOU switch CollaborateMD to that customer, then press Enter,
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
//   - YOU pick the customer/facility for each group (the bot never guesses
//     which practice a claim belongs to).
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
// DRY RUN can be turned on two ways so it works on every operating system:
//   Windows / Mac / Linux:  node push-notes.mjs --dry-run   (or: npm run dry-run)
//   Advanced:               DRY_RUN=1 node push-notes.mjs
const DRY_RUN = process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");
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
    console.error(`\n  Could not find ${NOTES_FILE}. Create it with three columns:\n  claim_id,facility,note\n`);
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(NOTES_FILE, "utf8")).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) { console.error("  notes.csv is empty."); process.exit(1); }
  // Detect + drop a header row.
  const header = rows[0].map((s) => (s || "").trim().toLowerCase());
  const hasHeader = header[0] === "claim_id" || header.includes("facility") || header.includes("note");
  // Support both the new 3-column layout (claim_id,facility,note) and the
  // old 2-column one (claim_id,note) so older files still run.
  const facilityIdx = header.indexOf("facility");
  const noteIdx = header.indexOf("note");
  return rows.slice(hasHeader ? 1 : 0)
    .map((r) => {
      if (r.length >= 3 || facilityIdx >= 0) {
        // 3-column: claim_id, facility, note  (or ordered by header names)
        const fi = facilityIdx >= 0 ? facilityIdx : 1;
        const ni = noteIdx >= 0 ? noteIdx : 2;
        return {
          claim_id: (r[0] || "").trim(),
          facility: (r[fi] || "").trim(),
          note: (r[ni] || "").trim(),
        };
      }
      // 2-column fallback: claim_id, note (facility unknown)
      return { claim_id: (r[0] || "").trim(), facility: "", note: (r[1] || "").trim() };
    })
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
// NOTE: the correct CollaborateMD customer (facility) must already be selected
// before this runs — the operator does that between facility groups. A claim
// only appears in Claim search under the customer it belongs to.
async function pushNote(page, claim_id, note) {
  // Tiny step tracker so a failure tells us EXACTLY which action timed out,
  // and we can screenshot the screen at that moment.
  const step = (name) => { page.__step = name; process.stdout.write(`\n      · ${name}`); };

  // 1) Make sure we're on the Claim search screen. Its search box placeholder
  //    is distinctive: "Search by name, DOB, account#, member ID, claim ID...".
  step("find claim search box");
  const searchBox = page.getByPlaceholder(/Search by name.*claim ID/i);
  if (!(await searchBox.isVisible().catch(() => false))) {
    // Not on the Claim screen — use the top-left "Find a Section" jump box.
    step("open Claim screen via Find a Section");
    const finder = page.getByPlaceholder(/Find a Section/i);
    await finder.click({ timeout: T });
    await finder.fill("Claim");
    await page.getByText("Claim", { exact: true }).first().click({ timeout: T });
    await searchBox.waitFor({ timeout: T });
  }
  step("type claim id");
  await searchBox.click({ timeout: T });
  await searchBox.fill(claim_id);
  // Trigger the search: press Enter AND click the Search button if present.
  await searchBox.press("Enter");
  const searchBtn = page.getByRole("button", { name: /^Search$/i }).first();
  if (await searchBtn.isVisible().catch(() => false)) {
    await searchBtn.click({ timeout: T }).catch(() => {});
  }
  await page.waitForTimeout(1200); // let results come back

  // 2) Open the matching claim. Results render as a table; the claim id shows
  //    in its own cell. Try a few ways to land on that row.
  step("open the claim row");
  const byRow = page.getByRole("row", { name: new RegExp(claim_id) }).first();
  const byCell = page.getByRole("cell", { name: claim_id, exact: true }).first();
  const byText = page.getByText(claim_id, { exact: true }).first();
  let opened = false;
  for (const target of [byRow, byCell, byText]) {
    if (await target.isVisible().catch(() => false)) {
      await target.click({ timeout: T });
      opened = true;
      break;
    }
  }
  if (!opened) {
    // Last resort: double-click the text (some grids open on double-click).
    await byText.dblclick({ timeout: T });
  }

  // 3) Expand the Patient Notes panel (right side). It's a collapsible header;
  //    only click it if Add Note isn't already showing, so we don't collapse a
  //    panel that a previous claim left open.
  step("open Patient Notes panel");
  const addNote = page.getByRole("button", { name: /Add Note/i });
  if (!(await addNote.isVisible().catch(() => false))) {
    await page.getByText("Patient Notes", { exact: false }).first().click({ timeout: T });
    await addNote.waitFor({ timeout: T });
  }

  // 4) Add Note -> type message -> Done.
  step("click Add Note");
  await addNote.click({ timeout: T });
  step("type the note");
  const dialog = page.getByRole("dialog");
  const message = (await dialog.locator("textarea").first().isVisible().catch(() => false))
    ? dialog.locator("textarea").first()
    : page.locator("textarea").last();
  await message.click({ timeout: T });
  await message.fill(note);
  step("click Done");
  await page.getByRole("button", { name: /^Done$/i }).click({ timeout: T });

  // 5) Save the claim.
  if (DRY_RUN) {
    console.log(`\n   [DRY RUN] would Save note on claim ${claim_id}`);
    // Leave the claim as-is; close it so the next claim starts clean.
    await page.getByRole("button", { name: /^Close$/i }).first().click({ timeout: T }).catch(() => {});
    return "dry-run";
  }
  step("click Save");
  await page.getByRole("button", { name: /^Save$/i }).first().click({ timeout: T });
  await page.waitForTimeout(1200); // let the save settle
  // Return to the claim list so the next search is clean.
  await page.getByRole("button", { name: /^Close$/i }).first().click({ timeout: T }).catch(() => {});
  return "ok";
}

async function main() {
  const notes = readNotes();
  const facilities = [...new Set(notes.map((n) => n.facility || "(facility not set)"))];
  console.log(`\n  Loaded ${notes.length} note(s) from ${NOTES_FILE}, across ${facilities.length} facility group(s).`);
  if (DRY_RUN) console.log("  DRY RUN: will do everything except the final Save.\n");

  if (!fs.existsSync(RESULTS_FILE)) fs.writeFileSync(RESULTS_FILE, "claim_id,status,detail\n");

  const browser = await chromium.launch({ headless: false, slowMo: 350 });
  const page = await browser.newPage({ viewport: null });
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  console.log("\n  A browser window opened. Log in to CollaborateMD yourself.");
  await ask("  When you are fully logged in and see the home screen, press Enter here to start... ");

  // Group the claims by facility, preserving order, so we switch the
  // CollaborateMD customer as few times as possible.
  const groups = [];
  const byFacility = new Map();
  for (const n of notes) {
    const key = n.facility || "(facility not set)";
    if (!byFacility.has(key)) { byFacility.set(key, []); groups.push(key); }
    byFacility.get(key).push(n);
  }

  let ok = 0, fail = 0, done = 0;
  for (const facility of groups) {
    const items = byFacility.get(facility);
    console.log(`\n  ────────────────────────────────────────────────────────`);
    console.log(`  Next: ${items.length} claim(s) for customer: ${facility}`);
    console.log(`  ────────────────────────────────────────────────────────`);
    console.log(`  1. Switch CollaborateMD to the customer "${facility}".`);
    console.log(`  2. Open the Claim screen (left menu → Claim → Claim) so you`);
    console.log(`     see the claim search box at the top.`);
    await ask(`  Then press Enter here to run this group... `);

    // Confirm we're actually on the Claim search screen before firing off
    // clicks — a clear message beats a 20-second mystery timeout.
    const ready = page.getByPlaceholder(/Search by name.*claim ID/i);
    if (!(await ready.isVisible().catch(() => false))) {
      console.log(
        `  ⚠ I don't see the claim search box yet. Open the Claim screen`
      );
      console.log(`     (left menu → Claim → Claim), then press Enter again.`);
      await ask("  Press Enter once you see the claim search box... ");
    }

    for (const { claim_id, note } of items) {
      done++;
      process.stdout.write(`\n  (${done}/${notes.length}) [${facility}] Claim ${claim_id}… `);
      try {
        const status = await pushNote(page, claim_id, note);
        record(claim_id, status, facility);
        console.log(status === "ok" ? "✓ saved" : "✓ (dry run)");
        ok++;
      } catch (err) {
        const msg = (err && err.message ? err.message : String(err)).split("\n")[0];
        const at = page.__step ? ` [at step: ${page.__step}]` : "";
        record(claim_id, "error", `${facility}: ${page.__step || "?"}: ${msg}`);
        console.log(`\n   ✗ FAILED${at}: ${msg}`);
        // Save a screenshot of the exact screen where it stopped, so we can
        // see what CollaborateMD was showing and fix the step.
        const shot = `error-${claim_id}.png`;
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        console.log(`   📸 Saved a screenshot to ${shot} — send me that image.`);
        fail++;
        // Try to get back to a clean state for the next claim.
        await page.keyboard.press("Escape").catch(() => {});
      }
    }
  }

  console.log(`\n  Done. ${ok} processed, ${fail} failed. See ${RESULTS_FILE}.`);
  await ask("  Press Enter to close the browser... ");
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
