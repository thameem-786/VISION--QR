import { useMemo } from 'react';

interface BubbleSpec {
  id: number;
  leftPct: number;
  sizePx: number;
  durationSec: number;
  delaySec: number;
  driftPx: number;
  opacity: number;
}

interface BubbleFieldProps {
  variant?: 'ambient' | 'terminal' | 'burst';
  tone?: 'neutral' | 'emerald' | 'crimson' | 'blue';
  count?: number;
  className?: string;
}

const TONE_STYLES: Record<NonNullable<BubbleFieldProps['tone']>, string> = {
  neutral:
    'border-slate-300/60 bg-gradient-to-br from-white/50 to-slate-200/30',
  emerald:
    'border-emerald-400/50 bg-gradient-to-br from-emerald-300/35 to-emerald-500/15',
  crimson:
    'border-red-400/50 bg-gradient-to-br from-red-300/35 to-red-500/15',
  blue:
    'border-sky-400/45 bg-gradient-to-br from-sky-300/30 to-blue-500/15',
};

const TERMINAL_TONE_STYLES: Record<NonNullable<BubbleFieldProps['tone']>, string> = {
  neutral:
    'border-sky-400/30 bg-gradient-to-br from-sky-400/20 to-indigo-500/10 shadow-[0_0_12px_rgba(56,189,248,0.12)]',
  emerald:
    'border-emerald-400/40 bg-gradient-to-br from-emerald-400/25 to-teal-500/10 shadow-[0_0_14px_rgba(52,211,153,0.18)]',
  crimson:
    'border-red-400/40 bg-gradient-to-br from-red-400/25 to-rose-500/10 shadow-[0_0_14px_rgba(248,113,113,0.18)]',
  blue:
    'border-sky-400/35 bg-gradient-to-br from-sky-400/25 to-blue-500/10 shadow-[0_0_14px_rgba(56,189,248,0.18)]',
};

export function BubbleField({
  variant = 'ambient',
  tone = 'neutral',
  count,
  className = '',
}: BubbleFieldProps) {
  const bubbleCount = count ?? (variant === 'terminal' ? 14 : variant === 'burst' ? 10 : 12);

  const bubbles = useMemo<BubbleSpec[]>(() => {
    const items: BubbleSpec[] = [];
    for (let i = 0; i < bubbleCount; i++) {
      // Deterministic pseudo-random distribution so hydration/re-renders never jump
      const seed = (i * 37 + 13) % 97;
      const sizeBase = variant === 'terminal' ? 8 : variant === 'burst' ? 10 : 18;
      const sizeRange = variant === 'terminal' ? 22 : variant === 'burst' ? 16 : 38;
      items.push({
        id: i,
        leftPct: 4 + ((i * 89 + seed) % 92),
        sizePx: sizeBase + (seed % sizeRange),
        durationSec:
          variant === 'burst'
            ? 1.8 + (seed % 14) * 0.1
            : variant === 'terminal'
              ? 5 + (seed % 6)
              : 10 + (seed % 10),
        delaySec: variant === 'burst' ? (i % 5) * 0.12 : -((seed % 10) * 1.1),
        driftPx: ((seed % 2 === 0 ? 1 : -1) * (10 + (seed % 18))),
        opacity: variant === 'terminal' ? 0.65 : variant === 'burst' ? 0.75 : 0.45,
      });
    }
    return items;
  }, [bubbleCount, variant]);

  const styleClass =
    variant === 'terminal' ? TERMINAL_TONE_STYLES[tone] : TONE_STYLES[tone];

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {bubbles.map((b) => (
        <span
          key={b.id}
          className={`bubble-particle absolute bottom-[-48px] rounded-full border backdrop-blur-[1px] ${styleClass} ${
            variant === 'burst' ? 'bubble-burst-anim' : 'bubble-rise-anim'
          }`}
          style={
            {
              left: `${b.leftPct}%`,
              width: `${b.sizePx}px`,
              height: `${b.sizePx}px`,
              '--bubble-duration': `${b.durationSec}s`,
              '--bubble-delay': `${b.delaySec}s`,
              '--bubble-drift': `${b.driftPx}px`,
              '--bubble-opacity': b.opacity,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
