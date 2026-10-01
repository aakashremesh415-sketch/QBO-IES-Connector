import type { Config } from "tailwindcss";

// Palette modelled on a QuickBooks Online-style workspace: green actions, dark navigation, light grey canvas.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#2ca01c", dark: "#108000", light: "#e8f5e4" },
        nav: { DEFAULT: "#21262a", hover: "#393f44", active: "#2f3539", text: "#d4d7dc" },
        canvas: "#f4f5f8",
        ink: { DEFAULT: "#393a3d", muted: "#6b6c72", faint: "#8d9096" },
        line: "#dcdee2",
        info: { DEFAULT: "#0077c5", light: "#e5f2fb" },
        warn: { DEFAULT: "#a35d00", light: "#fff4e0" },
        bad: { DEFAULT: "#d52b1e", light: "#fdecea" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Avenir Next", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: { card: "0 1px 2px rgba(0,0,0,.06), 0 1px 4px rgba(0,0,0,.04)" },
    },
  },
  plugins: [],
} satisfies Config;
