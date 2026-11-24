import type { ReactNode } from 'react';

type P = { size?: number; className?: string };
const base = (size: number | undefined, className: string | undefined, children: ReactNode, vb = 24) => (
  <svg className={className} width={size ?? 24} height={size ?? 24} viewBox={`0 0 ${vb} ${vb}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

/** Bici en movimiento con líneas de velocidad (logo). */
export function BikeMotion({ size = 44, className }: P) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g stroke="#FF8A1F" strokeWidth={3.2}><path d="M3 30h11" /><path d="M1 38h9" /><path d="M5 46h8" /></g>
      <g stroke="#2F8F3E" strokeWidth={3.6}><circle cx="22" cy="44" r="10" /><circle cx="52" cy="44" r="10" /></g>
      <g stroke="#1F5F34" strokeWidth={3.6}><path d="M22 44l9-17h16l5 17" /><path d="M31 27l-4-6h-4" /><path d="M47 27l-3-8h-6" /><path d="M22 44h14l11-17" /></g>
      <circle cx="40" cy="12" r="4.2" fill="#FF8A1F" stroke="none" />
    </svg>
  );
}

export const IconRadar = ({ size, className }: P) => base(size, className, <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6-6" /></>);
export const IconRecord = ({ size, className }: P) => base(size, className, <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.6" fill="currentColor" /></>);
export const IconRoute = ({ size, className }: P) => base(size, className, <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3.5 3.5 0 000-7H9a3.5 3.5 0 010-7h6.5" /></>);
export const IconChart = ({ size, className }: P) => base(size, className, <><path d="M5 20V11" /><path d="M12 20V4" /><path d="M19 20v-7" /></>);
export const IconUsers = ({ size, className }: P) => base(size, className, <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 4.7a3.5 3.5 0 010 6.6" /><path d="M18 14.2a6.5 6.5 0 013.5 5.8" /></>);
export const IconPlay = ({ size, className }: P) => base(size, className, <path d="M7 4.5v15l12-7.5z" fill="currentColor" />);
export const IconPause = ({ size, className }: P) => base(size, className, <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></>);
export const IconStop = ({ size, className }: P) => base(size, className, <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />);
export const IconPin = ({ size, className }: P) => base(size, className, <><path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>);

export const tabIcon: Record<string, (p: P) => ReactNode> = { radar: IconRadar, record: IconRecord, history: IconRoute, performance: IconChart, group: IconUsers };
