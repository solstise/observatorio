"use client";

// Header global del Observatorio Urbano Posadas.
// Tipografia Inter, logo geometrico SVG sobrio (hexagono), sin logos institucionales.
//
// Responsive: en pantallas <768px colapsa a un menu hamburguesa accesible
// (aria-expanded, focus visible, cierre por Escape, foco devuelto al boton al
// cerrar). El menu se renderiza como panel debajo del header con click-outside
// implicito (al navegar). En desktop se mantiene la barra horizontal.
//
// Dark mode: el header expone un toggle sol/luna que alterna manualmente
// entre claro y oscuro. El estado lo gestiona useTheme (localStorage +
// MutationObserver sobre la clase del <html>). En SSR el script inline en
// <head> ya pintó la clase correcta, así que el botón se monta con el ícono
// y label correctos sin parpadeo.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { useTheme } from "@/hooks/useTheme";

// Re-arquitectura mayo 2026: 6 hubs top-level en vez de 17 rutas flat.
// Cada hub agrupa sub-páginas en un dropdown predecible (3-5 ítems).
// Las rutas viejas siguen funcionando vía 301 en next.config.mjs.
type NavItem = { href: string; label: string };
type NavGroup = { label: string; href: string; items?: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { label: "Mapa", href: "/" },
  {
    label: "Indicadores",
    href: "/indicadores",
    items: [
      { href: "/indicadores/tipologia", label: "Tipología urbana" },
      { href: "/indicadores/calor", label: "Calor & UHI" },
      { href: "/indicadores/aire", label: "Aire" },
      { href: "/indicadores/poblacion", label: "Población & densidad" },
      { href: "/indicadores/calidad-vida", label: "Calidad de vida" },
    ],
  },
  {
    label: "Pronóstico",
    href: "/pronostico",
    items: [
      { href: "/pronostico/riesgos", label: "Riesgos 14 días" },
      { href: "/pronostico/clima", label: "Clima 14 días" },
      { href: "/pronostico/proyecciones", label: "Proyecciones 2030+" },
    ],
  },
  {
    label: "Decisión",
    href: "/decision",
    items: [
      { href: "/decision/prioridades", label: "Prioridades de inversión" },
      { href: "/decision/comparar", label: "Comparador 2 barrios" },
    ],
  },
  {
    label: "Datos",
    href: "/datos",
    items: [
      { href: "/datos/descargas", label: "Descargas CSV" },
      { href: "/datos/metodologia", label: "Metodología" },
      { href: "/datos/glosario", label: "Glosario" },
      { href: "/datos/historia", label: "Línea de tiempo 1999-2026" },
      { href: "/datos/validacion", label: "Validación cruzada" },
      { href: "/datos/3d", label: "Visor 3D" },
      { href: "/datos/explorar", label: "Explorar" },
    ],
  },
];

export function Header() {
  const [open, setOpen] = useState(false);
  // Estado de dropdowns abiertos en desktop. Manejamos un único dropdown
  // abierto a la vez (string con el label del grupo abierto, o null).
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();
  const menuId = useId();

  // Cierra todo al cambiar de ruta.
  useEffect(() => {
    setOpen(false);
    setOpenGroup(null);
  }, [pathname]);

  // Cierre por Escape (mobile panel).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Cierre de dropdowns al clickear fuera o Escape.
  useEffect(() => {
    if (!openGroup) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!navRef.current) return;
      if (!navRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenGroup(null);
    };
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [openGroup]);

  // ¿Está activo un grupo? Sí si la ruta actual matchea el href del grupo
  // o alguno de sus items.
  function isGroupActive(g: NavGroup): boolean {
    if (!pathname) return false;
    if (g.href === "/" && pathname === "/") return true;
    if (g.href !== "/" && pathname.startsWith(g.href)) return true;
    return (g.items ?? []).some(
      (i) => pathname === i.href || pathname.startsWith(i.href + "/"),
    );
  }

  return (
    <header
      className="sticky top-0 z-40 border-b border-neutral-border bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 dark:border-dk-border dark:bg-dk-bg/90 dark:supports-[backdrop-filter]:bg-dk-bg/75"
      role="banner"
    >
      <div className="container-obs flex items-center justify-between gap-4 py-3 sm:py-4">
        <Link
          href="/"
          className="flex items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:focus-visible:ring-dk-primary dark:focus-visible:ring-offset-dk-bg"
          aria-label="Observatorio Urbano Posadas - volver al inicio"
        >
          <LogoMark />
          <div className="flex flex-col leading-tight">
            <span className="text-[0.66rem] sm:text-[0.72rem] uppercase tracking-[0.18em] text-secondary dark:text-dk-muted">
              Observatorio
            </span>
            <span className="text-sm sm:text-base font-bold text-primary dark:text-dk-primary">
              Urbano Posadas
            </span>
          </div>
        </Link>

        {/* Navegación desktop (md+) — 6 hubs como dropdowns */}
        <nav
          aria-label="Navegación principal"
          className="hidden md:block"
          ref={navRef}
        >
          <ul className="flex items-center gap-1 lg:gap-2">
            {NAV_GROUPS.map((group) => {
              const active = isGroupActive(group);
              const hasItems = !!group.items && group.items.length > 0;
              if (!hasItems) {
                // Hub sin dropdown (Mapa).
                return (
                  <li key={group.href}>
                    <Link
                      href={group.href}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "inline-flex min-h-[44px] items-center rounded px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-primary-50 text-primary dark:bg-dk-elevated dark:text-dk-primary"
                          : "text-primary hover:bg-primary-50 dark:text-dk-primary dark:hover:bg-dk-elevated",
                      ].join(" ")}
                    >
                      {group.label}
                    </Link>
                  </li>
                );
              }
              const isOpen = openGroup === group.label;
              return (
                <li key={group.label} className="relative">
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                    onClick={() => setOpenGroup(isOpen ? null : group.label)}
                    className={[
                      "inline-flex min-h-[44px] items-center gap-1 rounded px-3 py-2 text-sm font-medium transition-colors",
                      active || isOpen
                        ? "bg-primary-50 text-primary dark:bg-dk-elevated dark:text-dk-primary"
                        : "text-primary hover:bg-primary-50 dark:text-dk-primary dark:hover:bg-dk-elevated",
                    ].join(" ")}
                  >
                    {group.label}
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      aria-hidden="true"
                      className={[
                        "ml-0.5 transition-transform",
                        isOpen ? "rotate-180" : "rotate-0",
                      ].join(" ")}
                    >
                      <path
                        d="M1 3l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  {isOpen && (
                    <ul
                      role="menu"
                      className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-md border border-neutral-border bg-white py-1 shadow-lg dark:border-dk-border dark:bg-dk-surface"
                    >
                      {/* Primer item: ir al hub overview */}
                      <li role="none">
                        <Link
                          href={group.href}
                          role="menuitem"
                          onClick={() => setOpenGroup(null)}
                          className="flex min-h-[40px] items-center justify-between px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-50 dark:text-dk-primary dark:hover:bg-dk-elevated"
                        >
                          <span>Ver todo en {group.label}</span>
                          <span aria-hidden className="text-xs opacity-60">↗</span>
                        </Link>
                      </li>
                      <li
                        role="separator"
                        aria-hidden
                        className="my-1 border-t border-neutral-border/60 dark:border-dk-border/60"
                      />
                      {group.items!.map((item) => {
                        const itemActive =
                          pathname === item.href ||
                          pathname?.startsWith(item.href + "/");
                        return (
                          <li key={item.href} role="none">
                            <Link
                              href={item.href}
                              role="menuitem"
                              aria-current={itemActive ? "page" : undefined}
                              onClick={() => setOpenGroup(null)}
                              className={[
                                "flex min-h-[40px] items-center px-4 py-2 text-sm font-medium transition-colors",
                                itemActive
                                  ? "bg-primary-50 text-primary dark:bg-dk-elevated dark:text-dk-primary"
                                  : "text-primary hover:bg-primary-50 dark:text-dk-primary dark:hover:bg-dk-elevated",
                              ].join(" ")}
                            >
                              {item.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Acciones a la derecha: tema + hamburguesa */}
        <div className="flex items-center gap-1.5">
          <ThemeToggle />

          {/* Botón hamburguesa (mobile) */}
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-neutral-border text-primary transition-colors hover:bg-primary-50 dark:border-dk-border dark:text-dk-primary dark:hover:bg-dk-elevated md:hidden"
          >
            {open ? <IconClose /> : <IconBurger />}
          </button>
        </div>
      </div>

      {/* Panel mobile (slide-down). Cada hub se muestra como sección con
          su título + sub-items debajo. Más legible que el flat list
          gigante anterior. */}
      {open && (
        <nav
          id={menuId}
          aria-label="Navegación principal"
          className="border-t border-neutral-border bg-white dark:border-dk-border dark:bg-dk-surface md:hidden"
        >
          <ul className="container-obs flex flex-col py-2">
            {NAV_GROUPS.map((group, gi) => {
              const groupActive = isGroupActive(group);
              const hasItems = !!group.items && group.items.length > 0;
              return (
                <li key={group.label} className={gi > 0 ? "mt-1" : ""}>
                  <Link
                    href={group.href}
                    aria-current={groupActive ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={[
                      "flex min-h-[44px] items-center rounded-md px-3 py-3 text-base font-semibold transition-colors",
                      groupActive
                        ? "bg-primary-50 text-primary dark:bg-dk-elevated dark:text-dk-primary"
                        : "text-primary hover:bg-primary-50 dark:text-dk-primary dark:hover:bg-dk-elevated",
                    ].join(" ")}
                  >
                    {group.label}
                  </Link>
                  {hasItems && (
                    <ul className="ml-3 mt-0.5 border-l border-neutral-border pl-2 dark:border-dk-border">
                      {group.items!.map((item) => {
                        const itemActive =
                          pathname === item.href ||
                          pathname?.startsWith(item.href + "/");
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              aria-current={itemActive ? "page" : undefined}
                              onClick={() => setOpen(false)}
                              className={[
                                "flex min-h-[40px] items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                itemActive
                                  ? "bg-primary-50 text-primary dark:bg-dk-elevated dark:text-dk-primary"
                                  : "text-primary hover:bg-primary-50 dark:text-dk-primary dark:hover:bg-dk-elevated",
                              ].join(" ")}
                            >
                              {item.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}

// Toggle sol/luna. Se renderiza siempre el mismo botón, intercambiando el
// SVG según el tema resuelto. Usamos `useTheme` para obtener el resolved
// real (que ya está sincronizado con la clase del <html> via el script
// inline en layout.tsx, así que en el primer render no hay flash de ícono).
function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  // Estado para evitar flickering antes de la hidratación: hasta que el
  // efecto del hook corra, mostramos un placeholder neutro. En la práctica
  // el script inline ya pintó la clase, así que `resolved` es correcto desde
  // el primer render del cliente.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolved === "dark";
  const label = isDark ? "Activar tema claro" : "Activar tema oscuro";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-neutral-border text-primary transition-colors hover:bg-primary-50 dark:border-dk-border dark:text-dk-primary dark:hover:bg-dk-elevated"
    >
      {/* Sin mounted, podríamos pintar un ícono que no coincida con la
          clase ya seteada por el script inline si SSR difiere. Como el
          script ya pintó la clase, en el primer render `resolved` es
          correcto; pero el ícono sigue siendo visual y queremos asegurar
          que el aria-label haya sido actualizado por React. El check de
          mounted previene un breve mismatch en clientes muy lentos. */}
      {mounted ? (isDark ? <IconSun /> : <IconMoon />) : <IconMoon />}
    </button>
  );
}

// Logo: hexagono compuesto por triangulos, en azul primario.
// Evita parecer gubernamental; lee como "tecnico/independiente".
//
// En dark mode usamos el azul claro de la paleta dark para el polígono base
// y mantenemos el acento naranja (más cálido en dark) para conservar la
// identidad visual.
function LogoMark() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      role="img"
      aria-label="Logo Observatorio"
      className="shrink-0"
    >
      <polygon
        points="18,3 32,11 32,25 18,33 4,25 4,11"
        className="fill-[#1a3a5c] dark:fill-[#1c2540]"
      />
      <polyline
        points="10,14 18,18 26,14"
        fill="none"
        className="stroke-[#c97d3c] dark:stroke-[#e0945c]"
        strokeWidth="1.6"
      />
      <polyline
        points="10,22 18,18 26,22"
        fill="none"
        className="stroke-white dark:stroke-[#7faed8]"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function IconBurger() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function IconSun() {
  // Sol estilo "outline" minimalista para mantener consistencia con el
  // resto de íconos del header. 8 rayos cardinales + ordinales.
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

function IconMoon() {
  // Luna creciente clásica. Uso path con fill currentColor para que herede
  // el color del botón en cada tema sin necesidad de variantes específicas.
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </svg>
  );
}
