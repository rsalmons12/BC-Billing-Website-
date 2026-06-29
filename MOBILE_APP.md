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
