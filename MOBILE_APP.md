# Publishing BC Billing as an App Store / Play Store app

The web app at **bcbilling.cloud** is already installable to the phone home
screen (PWA). This doc covers turning it into a **real store app**.

There are two routes. Pick one.

---

## Route 1 — PWABuilder (easiest; no developer, no Mac)

Because the site already ships a web manifest + icons, this packages it into
store-ready apps from the URL.

1. Go to **https://www.pwabuilder.com** and enter `https://bcbilling.cloud`.
2. Click **Package for stores** → download the **iOS** and **Android** packages.
3. Publish them with the store accounts below.

This is the recommended route for a non-developer.

---

## Route 2 — Capacitor (already scaffolded in this repo)

This repo is configured with **Capacitor** (`capacitor.config.ts`) to wrap the
hosted site as native iOS/Android apps. A developer (or a cloud build service)
finishes the build + submission.

### One-time setup (on the build machine)
```bash
npm install
npm run app:add        # generates ios/ and android/ native projects
npm run app:sync       # copies config into them
```
> `cap add ios` and the iOS build require **macOS + Xcode + CocoaPods**.
> Android can be built on Windows/Mac/Linux with **Android Studio**.

### Build & open
```bash
npm run app:android    # opens the Android project in Android Studio
npm run app:ios        # opens the iOS project in Xcode (Mac only)
```
Then build/archive from Android Studio / Xcode and upload to the stores.

### No Mac? Use a cloud build service
- **Codemagic** — https://codemagic.io
- **Ionic Appflow** — https://ionic.io/appflow

They build the iOS app in the cloud (you still need an Apple Developer account).

### Notes
- The app loads `https://bcbilling.cloud` live, so it always shows the latest
  version — no resubmission needed for app *content* changes, only for native
  shell changes (icon, name, permissions).
- To point the app at a test build instead, change `server.url` in
  `capacitor.config.ts` and re-run `npm run app:sync`.

---

## Route 3 — Public App Store, no Mac (Codemagic cloud build)

You have an Apple Developer account but no Mac. This is the turnkey path. A
`codemagic.yaml` is already in the repo.

### Step 1 — App Store Connect (web, no Mac)
1. Go to **https://appstoreconnect.apple.com** and sign in.
2. **Users and Access → Integrations → App Store Connect API** → generate a key
   with the **App Manager** role. Download it and note the Key ID + Issuer ID.
3. **Certificates, Identifiers & Profiles → Identifiers → +** → register the
   App ID **cloud.bcbilling.app**.
4. **Apps → + → New App**: Platform iOS, Name **BC Billing**, Bundle ID
   **cloud.bcbilling.app**, pick an SKU (any text, e.g. `bcbilling01`).

### Step 2 — Codemagic (cloud build, no Mac)
1. Sign up at **https://codemagic.io** with GitHub and authorize this repo.
2. **Teams → Integrations → App Store Connect** → add the API key from Step 1.
   Name the integration exactly **`BC_BILLING_APP_STORE_KEY`** (the yaml
   references that name).
3. Open the app → it detects `codemagic.yaml` → run the **ios-app-store**
   workflow. It builds the signed app and pushes it to **TestFlight**.

### Step 3 — Submit for review
1. In App Store Connect, fill the listing: description, **screenshots**
   (required), **privacy policy URL**, category (Business), age rating.
2. ⚠️ Because the app is **login-only**, App Review needs a working account.
   Put a **test login** (email + password) in **App Review Information → Notes**,
   or they'll reject it as "unable to review."
3. Attach the TestFlight build → **Submit for Review** (1–3 days).

### ⚠️ Read this before submitting to the *public* store
Apple guideline **4.2** often rejects apps that are "just a website in a
wrapper." This is a login-gated business tool with live data entry, which
helps, but it's a real risk on the public store. Two ways to de-risk:
- **Add something native** (push notifications, Face ID login, offline) so it's
  more than the website.
- **Or distribute privately** to your staff via **Apple Business Manager →
  Custom Apps** — far lighter review for an internal tool:
  https://developer.apple.com/business/distribute/

---

## Store accounts (required for either route)

- **Apple Developer Program** — $99/year — https://developer.apple.com/programs/enroll/
- **Google Play Console** — $25 one-time — https://play.google.com/console/signup

### App identity (already set in capacitor.config.ts)
- App name: **BC Billing**
- Bundle / App ID: **cloud.bcbilling.app**
- Icons: `public/icon-512.png`, `public/icon-192.png`, `public/apple-touch-icon.png`

## Heads-up on Apple review
Apple sometimes rejects apps that are "just a website wrapper." Because this is
a real internal business tool (login + live data entry), it usually passes, but
if it's only for your staff, the cleanest path is **Apple Business Manager →
Custom Apps** (private distribution to your organization, lighter review):
https://developer.apple.com/business/distribute/
