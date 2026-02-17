/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "Segoe UI", "Tahoma", "Geneva", "Verdana", "sans-serif"],
        heading: ["Space Grotesk", "DM Sans", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
