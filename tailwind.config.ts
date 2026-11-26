import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./context/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border, 218 20% 86%))",
        input: "hsl(var(--input, 218 20% 86%))",
        ring: "#059669",
        background: "hsl(var(--background, 0 0% 100%))",
        foreground: "hsl(var(--foreground, 222 35% 12%))",
        card: {
          DEFAULT: "hsl(var(--card, 0 0% 100%))",
          foreground: "hsl(var(--card-foreground, 222 35% 12%))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover, 0 0% 100%))",
          foreground: "hsl(var(--popover-foreground, 222 35% 12%))",
        },
        primary: {
          DEFAULT: "#059669",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary, 220 26% 95%))",
          foreground: "hsl(var(--secondary-foreground, 222 35% 12%))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted, 220 26% 95%))",
          foreground: "hsl(var(--muted-foreground, 218 24% 30%))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent, 220 26% 95%))",
          foreground: "hsl(var(--accent-foreground, 222 35% 12%))",
        },
        destructive: {
          DEFAULT: "#ef4444",
          foreground: "#ffffff",
        },
        ekms: {
          blue: "#065fd4",
          primary: "#1967d2",
          hover: "#f2f2f2",
          accent: "#ff9800",
          success: "#137333",
          danger: "#c5221f",
          border: "#e5e5e5",
          card: "#ffffff",
          muted: "#606060",
          main: "#0f0f0f",
          bg: "#f8f9fa",
        },
      },
      fontFamily: {
        sans: ["'Roboto'", "var(--font-roboto)", "Roboto", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Arial", "sans-serif"],
        display: ["'Roboto'", "var(--font-roboto)", "Roboto", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
