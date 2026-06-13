/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#1f2933",
        line: "#d8dee6",
        sage: "#4f7c6a",
        saffron: "#d79b2b",
        coral: "#c95d4f",
        steel: "#3d6272",
        paper: "#f7f4ed",
      },
      boxShadow: {
        soft: "0 12px 30px rgba(31, 41, 51, 0.08)",
      },
    },
  },
  plugins: [],
};
