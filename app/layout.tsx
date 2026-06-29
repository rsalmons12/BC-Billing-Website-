import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recovery Desk — BC Billing Solutions",
  description: "Multi-tenant revenue cycle management for BC Billing Solutions.",
  manifest: "/manifest.webmanifest",
  applicationName: "BC Billing",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "BC Billing",
  },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e1118",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
