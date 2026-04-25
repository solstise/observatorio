// Header global del Observatorio Urbano Posadas.
// Tipografia Inter, logo geometrico SVG sobrio (hexagono), sin logos institucionales.

import Link from "next/link";

const NAV = [
  { href: "/", label: "Mapa" },
  { href: "/calor", label: "Calor" },
  { href: "/comparar", label: "Comparar" },
  { href: "/metodologia", label: "Metodologia" },
  { href: "/descargas", label: "Descargas" },
];

export function Header() {
  return (
    <header
      className="border-b border-neutral-border bg-white"
      role="banner"
    >
      <div className="container-obs flex items-center justify-between gap-4 py-4">
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label="Observatorio Urbano Posadas - volver al inicio"
        >
          <LogoMark />
          <div className="flex flex-col leading-tight">
            <span className="text-[0.72rem] uppercase tracking-[0.18em] text-secondary">
              Observatorio
            </span>
            <span className="text-base font-bold text-primary">
              Urbano Posadas
            </span>
          </div>
        </Link>

        <nav aria-label="Navegacion principal">
          <ul className="flex items-center gap-1 md:gap-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded px-3 py-2 text-sm font-medium text-primary hover:bg-primary-50"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

// Logo: hexagono compuesto por triangulos, en azul primario.
// Evita parecer gubernamental; lee como "tecnico/independiente".
function LogoMark() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      role="img"
      aria-label="Logo Observatorio"
    >
      <polygon
        points="18,3 32,11 32,25 18,33 4,25 4,11"
        fill="#1a3a5c"
      />
      <polyline
        points="10,14 18,18 26,14"
        fill="none"
        stroke="#c97d3c"
        strokeWidth="1.6"
      />
      <polyline
        points="10,22 18,18 26,22"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.6"
      />
    </svg>
  );
}
