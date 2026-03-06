import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          lime: "#CDFF00",
          pink: "#FF69B4",
          navy: "#1A1A4E",
          lavender: "#C8B8F0",
        },
      },
    },
  },
  plugins: [],
}

export default config
