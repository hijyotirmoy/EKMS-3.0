import type { Config } from "tailwindcss";

const config: Config = {
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
