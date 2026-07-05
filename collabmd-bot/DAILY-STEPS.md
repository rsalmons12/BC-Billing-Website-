# Daily steps — push collector notes into CollaborateMD

A simple checklist for running the note bot each day. Non-technical; just
follow in order.

## Two rules that keep it smooth
1. **Only type into the black window (PowerShell) what is given to you in a
   box.** Never copy text *out* of the black window and paste it back in — that
   causes the confusing red errors.
2. **Log in inside the browser window the bot opens**, not your normal browser.

---

## 1. Export the notes from BC Billing
- Open bcbilling.cloud → **Collector Status** tab.
- Click **"↓ Export notes → CollaborateMD."**
- A file `notes.csv` downloads into your `OneDrive\Documents`.

## 2. Open PowerShell in the bot folder
- File Explorer → **Documents → collabmdbot → collabmd-bot**.
- Click the address bar, type `powershell`, press **Enter**.
  (A black window opens already in the right folder.)

## 3. Copy the exported file into the bot folder
Type this one line, press Enter:

    Get-ChildItem "$HOME\OneDrive\Documents\notes*.csv" | Sort-Object LastWriteTime | Select-Object -Last 1 | Copy-Item -Destination ".\notes.csv" -Force

## 4. Start the bot
Type this one line, press Enter:

    node push-notes.mjs

(To do a safe rehearsal that never saves, add ` --dry-run` on the end:
`node push-notes.mjs --dry-run`)

## 5. Log in — inside the window the bot opens
- A browser window opens on the CollaborateMD login page. **Use this window.**
- Type username + password, click **Log In**, wait for the **Welcome** screen.

## 6. Work each facility the bot names
For every facility group, the black window pauses and tells you the customer:
- Browser: top-right → **Switch Customers → Show All →** click that facility.
- Left menu → **Claim → Claim** (so the search box shows at the top).
- Back in the black window, press **Enter** once.
- The bot searches each claim, adds the note, clicks **Save**, and repeats.
- When that facility's notes are done it moves to the next facility and pauses.

## 7. Done
- It prints **"Done. X processed, 0 failed."** — every note is saved.
- Anything that failed is listed in `results.csv` in this folder.

---

## The notes file format (if you ever make it by hand)
Three columns: `claim_id,facility,note` — one claim per line. The **facility**
must match the CollaborateMD customer name you'd pick on screen. Example:

    claim_id,facility,note
    271712274,NJ Recovery Solutions,Called payer 7/1 - reprocessing. - BC
