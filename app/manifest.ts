import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest with the correct content-type and a complete
// set of fields (so packaging tools like PWABuilder validate cleanly).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BC Billing Solutions — Recovery Desk",
    short_name: "BC Billing",
    description:
      "Recovery Desk by BC Billing Solutions — revenue cycle management: collections, authorizations, negotiations, payments, repricing and reporting for behavioral health facilities.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0e1118",
    theme_color: "#0e1118",
    lang: "en",
    dir: "ltr",
    categories: ["business", "medical", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
