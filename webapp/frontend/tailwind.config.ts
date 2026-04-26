import type { Config } from "tailwindcss";

// Configuracion Tailwind del Observatorio Urbano Posadas.
// Paleta sobria inspirada en ONU/BID/Banco Mundial. Sin rojos.
//
// `darkMode: "class"` (no "media") permite alternar manualmente entre
// claro/oscuro/sistema desde la UI. El layout inyecta un <script> en el
// <head> para setear la clase `dark` antes de la hidratación de React y
// evitar el flash blanco en SSR.
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx,md,mdx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta institucional (light)
        primary: {
          DEFAULT: "#1a3a5c",
          50: "#f0f4f9",
          100: "#d9e3ef",
          200: "#b3c7df",
          300: "#8dabcf",
          400: "#5a7a9c",
          500: "#1a3a5c",
          600: "#152f4a",
          700: "#102338",
          800: "#0b1826",
          900: "#060d14",
        },
        secondary: {
          DEFAULT: "#5a7a9c",
        },
        accent: {
          DEFAULT: "#c97d3c",
          50: "#fbf3eb",
          100: "#f4dfc8",
          200: "#e9bf91",
          300: "#d9a05f",
          400: "#c97d3c",
          500: "#a96328",
          600: "#874e1f",
          700: "#653a17",
        },
        neutral: {
          bg: "#ffffff",
          text: "#222222",
          muted: "#6b7280",
          border: "#e5e7eb",
        },
        // Paleta dark — definida también como tokens con prefijo `dk` para
        // poder usarlos en componentes que necesitan un valor explícito (por
        // ejemplo, atributos style en SVG o backgrounds inline). En Tailwind
        // estándar usamos las utilidades `dark:bg-*` directamente.
        dk: {
          bg: "#0e1320", // fondo principal: azul muy oscuro
          surface: "#161d2f", // cards / superficies elevadas
          elevated: "#1c2540", // surface más elevada (popovers, hover)
          border: "#2a3247", // bordes / dividers
          text: "#e6ebf2", // texto principal (no blanco puro)
          muted: "#94a0b8", // texto secundario
          primary: "#7faed8", // azul claro (links, headings)
          accent: "#e0945c", // naranja cálido (acento)
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Escala tipografica conservadora
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.6rem" }],
        lg: ["1.125rem", { lineHeight: "1.75rem" }],
        xl: ["1.25rem", { lineHeight: "1.9rem" }],
        "2xl": ["1.5rem", { lineHeight: "2.1rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.35rem" }],
        "4xl": ["2.25rem", { lineHeight: "2.6rem" }],
      },
      maxWidth: {
        container: "72rem",
      },
    },
  },
  plugins: [],
};

export default config;
