# iOS App Store — final handoff (≈30 minutes)

This app is a Next.js web app (hosted at **https://bcbilling.cloud**) wrapped as
an iOS app with **Capacitor**, built in the cloud with **Codemagic** (no Mac
needed). Almost everything is already set up. A developer just needs to finish
the steps below.

## Already done by the owner
- Apple Developer Program — **active** (enrolled as Individual).
- App ID **`cloud.bcbilling.app`** registered in Certificates, IDs & Profiles.
- App record created in **App Store Connect** (name: **BC Billing**).
- An **App Store Connect API key** (`.p8`) was generated — the owner has the
  file, its **Key ID**, and the account **Issuer ID**.
- **Codemagic** account created and this GitHub repo connected.
- **`codemagic.yaml`** is in the repo root (workflow: *BC Billing iOS (App Store)*).
- Public **Privacy Policy** live at **https://bcbilling.cloud/privacy**.

## What's left

### 1. Add the App Store Connect API key to Codemagic
In Codemagic → **Team/User settings → Integrations → App Store Connect**
(or **Code signing identities → App Store Connect API keys**), add the key:
- **Name (must match exactly):** `BC_BILLING_APP_STORE_KEY`
- **Issuer ID**, **Key ID**, and the **`.p8` file** — all from the owner.

> `codemagic.yaml` references this key by that exact name and uses automatic
> signing for bundle id `cloud.bcbilling.app`, distribution type `app_store`.

### 2. Run the build
Codemagic → app **bc-billing-website-** → **Start new build** → branch **main**,
workflow **BC Billing iOS (App Store)**. It runs `cap add ios` / `cap sync`,
`pod install`, signs, builds the `.ipa`, and uploads to **TestFlight**.

### 3. Complete the App Store listing
In App Store Connect → the BC Billing app:
- Screenshots (6.7" + 6.5" iPhone), description, keywords, support URL.
- **Privacy Policy URL:** `https://bcbilling.cloud/privacy`
- App Privacy questionnaire (collects account/contact info; handles PHI as a
  HIPAA business associate — no tracking, no ads).
- Category: **Business**.

### 4. Provide a demo login (required)
The app is login-only. Put a working **test email + password** in
**App Review Information → Notes**, or Apple will reject it as un-reviewable.

### 5. Submit for review
Attach the TestFlight build → **Submit for Review** (1–3 days).

## Known risk — guideline 4.2 ("website wrapper")
Apple may reject a thin web wrapper on the public store. The app's login +
live data entry helps. If rejected, either add a native capability (push
notifications / Face ID) to clear 4.2, or distribute privately via **Apple
Business Manager → Custom Apps** (lighter review for an internal tool).

## Key facts
- **Bundle ID:** `cloud.bcbilling.app`
- **App name:** BC Billing
- **Loads:** `https://bcbilling.cloud` (live; content updates need no resubmission)
- **Build config:** `codemagic.yaml` (repo root)
- **Capacitor config:** `capacitor.config.ts`
- Fuller background: `MOBILE_APP.md`
