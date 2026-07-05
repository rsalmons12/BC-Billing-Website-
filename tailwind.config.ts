import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Archivo", "Inter", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      colors: {
        // dark command sidebar
        command: {
          DEFAULT: "#0e1118",
          surface: "#161b26",
          border: "#252c3a",
          muted: "#8a93a6",
          text: "#e6eaf2",
        },
        // light work surface
        surface: {
          DEFAULT: "#f6f7f9",
          card: "#ffffff",
          border: "#e3e7ee",
          muted: "#6b7280",
          ink: "#1a1f2b",
        },
        // brand (BC Billing Solutions)
        brand: {
          blue: "#19a8e0",
          green: "#37a635",
        },
        // signal palette
        gold: "#d9a441",
        recovered: "#1f9d6b",
        risk: "#d6453d",
        secured: "#7c5cff",
        // age tiers: watch (yellow) / warn (orange) / risk (red = priority)
        watch: "#eab308",
        warn: "#f97316",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)",
      },
      keyframes: {
        agepulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        agepulse: "agepulse 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
