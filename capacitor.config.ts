import type { CapacitorConfig } from "@capacitor/cli";

// Wraps the hosted Recovery Desk web app as native iOS/Android apps.
// The app is a server-rendered Next.js site, so the native shell loads the
// live URL rather than a static bundle. Change `server.url` if your domain
// changes (or to a Vercel preview while testing).
const config: CapacitorConfig = {
  appId: "cloud.bcbilling.app",
  appName: "BC Billing",
  webDir: "public",
  server: {
    url: "https://bcbilling.cloud",
    cleartext: false,
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
