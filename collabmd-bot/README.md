# CollaborateMD note bot

This little program logs the repetitive notes into CollaborateMD for you. You
log in yourself; the bot does the clicking. It reads a file called `notes.csv`
(one row per claim) and, for each claim, opens it in CollaborateMD and adds your
note.

It **shows you the browser the whole time** so you can watch, and it has a
**rehearsal mode** that does everything except the final Save.

---

## What it does, in plain English

For every row in `notes.csv` it:

1. Searches the **Claim ID** in CollaborateMD's Claim search.
2. Opens that claim.
3. Opens **Patient Notes → Add Note**, types your note, clicks **Done**.
4. Clicks **Save**.

It writes a `results.csv` telling you which claims succeeded and which need a
second look.

---

## One-time setup (about 10 minutes)

You only do this once.

### 1. Install Node.js
- Go to https://nodejs.org and install the **LTS** version (the big green
  button). Click through the installer with the defaults.

### 2. Open a terminal in this folder
- **Windows:** open this `collabmd-bot` folder in File Explorer, click the
  address bar, type `cmd`, and press Enter.
- **Mac:** open Terminal, type `cd ` (with a space), drag this folder onto the
  window, and press Enter.

### 3. Install the bot's helpers
Type these two lines, pressing Enter after each (they take a few minutes):

```
npm install
npx playwright install chromium
```

That's it — setup is done.

---

## Each time you want to push notes

### 1. Make your notes file
Create a file named `notes.csv` in this folder with two columns. The easiest
way: in Excel, put **claim_id** in column A and **note** in column B, then
"Save As" → CSV. It should look like `notes.example.csv`.

```
claim_id,note
297554670,"Called Horizon 7/1 - reprocessing, ETA 2 weeks. - BC"
294746976,"Payment posted, zero balance. - BC"
```

### 2. Do a rehearsal first (recommended)
This runs the whole thing but **never clicks Save** — a safe dry run:

```
npm run dry-run
```

A browser opens. **Log in to CollaborateMD yourself.** When you're on the home
screen, come back to the terminal and press **Enter**. Watch it open each claim
and fill the note. Nothing is saved.

### 3. Do it for real
When the rehearsal looks right:

```
npm run notes
```

Same thing, but it clicks **Save** on each claim. When it finishes, open
`results.csv` to see anything that failed.

---

## If a step can't find a button

CollaborateMD occasionally renames a button. If the bot stops on the same step
every time, we can capture the exact button in 2 minutes:

```
npx playwright codegen https://app.collaboratemd.com
```

A browser and a recorder window open. Do the note steps by hand once; the
recorder prints the exact button names. Send me that output and I'll drop the
precise names into the bot.

---

## Notes / safety
- The bot never stores your CollaborateMD password — **you** log in each run.
- `notes.csv` and `results.csv` stay on your computer (they're git-ignored).
- Start with a small `notes.csv` (2–3 claims) the first few times.
- Close other CollaborateMD tabs while it runs so it doesn't get confused.
