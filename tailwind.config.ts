import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        mist: "#f7f8fb",
        home: {
          50: "#eef7ff",
          100: "#d9edff",
          600: "#2563eb",
          700: "#1d4ed8"
        },
        work: {
          50: "#f5f0ff",
          100: "#eadcff",
          600: "#7c3aed",
          700: "#6d28d9"
        }
      },
      boxShadow: {
        soft: "0 12px 30px rgba(23, 32, 51, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
