import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recovery Desk — BC Billing Solutions",
  description: "Multi-tenant revenue cycle management for BC Billing Solutions.",
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
