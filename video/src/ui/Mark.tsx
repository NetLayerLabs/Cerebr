import React from "react";
import { interpolate } from "remotion";
import { evolvePath, getLength, getPointAtLength } from "@remotion/paths";
import { C } from "../theme";
import { clamp, expo } from "./motion";

// The Cerebr chip mark (app/public/brand, source art ~/Downloads/cerebr-logo.png), redrawn on a
// 100-unit grid: a die outline, an "E" bus (spine and two stubs) and two double rails with pads.
const FRAME = "M14.8 14.8 H85.2 V85.2 H14.8 Z";
const SPINE = "M38 32.9 H26.8 V64.8 H38";
const STUBS = ["M26.8 45.5 H42.2", "M26.8 52.7 H42.2"];
const RAILS = ["M38 26.5 H68", "M38 32.9 H68", "M38 64.8 H68", "M38 71.2 H68"];
const PADS = [[31.3, 23.1], [67.8, 23.1], [31.3, 61.4], [67.8, 61.4]] as const;
/** The path the lit signal runs along: in on the top rail, down the spine, out along the bottom rail. */
export const SIGNAL = "M68 32.9 H26.8 V64.8 H68";

/**
 * `p` 0..1 draws the mark (die, bus, rails, pads). `sig` 0..1 runs the lime signal along SIGNAL;
 * once it has run (`sig` = 1) the bus stays lit when `litAfter` is set.
 */
export const Mark: React.FC<{ size: number; p?: number; ink?: string; sig?: number; lit?: string; litAfter?: boolean; style?: React.CSSProperties }> = ({ size, p = 1, ink = C.lime, sig = 0, lit = C.lime, litAfter = false, style }) => {
  const seg = (a: number, b: number) => interpolate(p, [a, b], [0, 1], { ...clamp, easing: expo });
  const st = (d: string, q: number, w: number, color = ink) => {
    const e = evolvePath(q, d);
    return <path key={d} d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="butt" strokeLinejoin="round" strokeDasharray={e.strokeDasharray} strokeDashoffset={e.strokeDashoffset} />;
  };
  const sigE = evolvePath(Math.max(0, Math.min(1, sig)), SIGNAL);
  const head = sig > 0 && sig < 1 ? getPointAtLength(SIGNAL, getLength(SIGNAL) * sig) : null;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ overflow: "visible", ...style }}>
      {st(FRAME, seg(0, 0.45), 4.6)}
      {st(SPINE, seg(0.2, 0.62), 4.6)}
      {STUBS.map((d, i) => st(d, seg(0.4 + i * 0.06, 0.7 + i * 0.06), 4.6))}
      {RAILS.map((d, i) => st(d, seg(0.45 + (i % 2) * 0.05, 0.85 + (i % 2) * 0.05), 4))}
      {PADS.map(([x, y], i) => {
        const q = seg(0.62 + i * 0.05, 0.9 + i * 0.025);
        return <rect key={i} x={x + 3.4 * (1 - q)} y={y + 6.5 * (1 - q)} width={6.8 * q} height={13 * q} rx={1.3} fill={ink} />;
      })}
      {sig > 0 && (
        <path d={SIGNAL} fill="none" stroke={lit} strokeWidth={4.6} strokeLinejoin="round" strokeDasharray={litAfter || sig < 1 ? sigE.strokeDasharray : undefined} strokeDashoffset={litAfter || sig < 1 ? sigE.strokeDashoffset : undefined}
          opacity={sig >= 1 && !litAfter ? 0 : 1} style={{ filter: `drop-shadow(0 0 2.5px ${lit})` }} />
      )}
      {head && <circle cx={head.x} cy={head.y} r={4.2} fill={lit} style={{ filter: `drop-shadow(0 0 4px ${lit})` }} />}
    </svg>
  );
};

/** The wordmark as the app sets it: CEREBR in wide-tracked caps. */
export const Wordmark: React.FC<{ size: number; color: string; font: string; style?: React.CSSProperties }> = ({ size, color, font, style }) => (
  <div style={{ fontFamily: font, fontWeight: 500, fontSize: size, letterSpacing: "0.32em", color, marginRight: "-0.32em", ...style }}>CEREBR</div>
);
