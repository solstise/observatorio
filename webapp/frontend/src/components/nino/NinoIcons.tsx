import type { SVGProps } from "react";

// Íconos de trazo simple para la sala El Niño. Heredan el color del texto.
type IconName = "alert" | "storm" | "bolt" | "drop" | "rain" | "ground" | "river" | "clock" | "check" | "calendar" | "radar" | "phone";

const PATHS: Record<IconName, JSX.Element> = {
  alert: <><path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" /><path d="M12 10v4.2" /><path d="M12 17.2h.01" /></>,
  storm: <><path d="M7 15.5H6a4 4 0 0 1-.6-7.96A6 6 0 0 1 17 6.5h.5a4 4 0 0 1 .5 7.97" /><path d="m12.5 12-2.5 4.5h4L11.5 21" /></>,
  bolt: <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12l1-8Z" />,
  drop: <path d="M12 3c3.5 4.4 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.5-6.6 6-11Z" />,
  rain: <><path d="M7 14H6a4 4 0 0 1-.6-7.96A6 6 0 0 1 17 5h.5a4 4 0 0 1 0 8" /><path d="m9 17-1 3" /><path d="m13 16-1.5 4.5" /><path d="m17 16-1 3" /></>,
  ground: <><path d="M3 9h18" /><path d="M3 14h18" /><path d="M3 19h18" /><path d="M7 5.5c1-.7 2-.7 3 0s2 .7 3 0 2-.7 3 0" /></>,
  river: <><path d="M3 8c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0" /><path d="M3 13c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0" /><path d="M3 18c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 4.5 0 3 1.3 4.5 0" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.3 4.6-4.8" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16" /><path d="M8.5 3v4" /><path d="M15.5 3v4" /></>,
  radar: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12 18 6" /></>,
  phone: <path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z" />,
};

export function NinoIcon({ name, size = 24, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{PATHS[name]}</svg>;
}
