/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        shell: "#f8fbff",
        line: "#dbe6f5",
      },
      boxShadow: {
        card: "0 12px 30px -14px rgba(15, 23, 42, 0.22)",
      },
      backgroundImage: {
        "orchestrator-gradient":
          "radial-gradient(circle at 8% -12%, #dbeafe 0%, #f8fbff 35%, #ffffff 70%)",
      },
    },
  },
  plugins: [],
};
