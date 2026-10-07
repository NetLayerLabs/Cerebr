import React from "react";
import { evolvePath, getLength, getPointAtLength } from "@remotion/paths";
import { C } from "../theme";

/**
 * The film's motif, "the lit wire": a lime signal travelling gate by gate, exactly what a
 * TapeOut eval() does. A wire is drawn dim; `p` (0..1) lights it from its start, with a bright
 * head where the signal is. `off` dims it again from the start (the signal has passed).
 */
export const LitPath: React.FC<{
  d: string; p: number; width?: number; base?: string; lit?: string; head?: boolean; glow?: boolean; draw?: number; dash?: boolean;
}> = ({ d, p, width = 3, base = "rgba(236,237,238,0.16)", lit = C.lime, head = true, glow = true, draw = 1, dash }) => {
  const len = getLength(d);
  const shown = evolvePath(Math.max(0, Math.min(1, draw)), d);
  const ev = evolvePath(Math.max(0, Math.min(1, p)), d);
  const pt = p > 0 && p < 1 ? getPointAtLength(d, len * p) : null;
  return (
    <g>
      <path d={d} fill="none" stroke={base} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash ? "2 7" : shown.strokeDasharray} strokeDashoffset={dash ? 0 : shown.strokeDashoffset} />
      {p > 0 && (
        <path d={d} fill="none" stroke={lit} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset}
          style={glow ? { filter: `drop-shadow(0 0 ${width * 2.2}px ${lit})` } : undefined} />
      )}
      {head && pt && <circle cx={pt.x} cy={pt.y} r={width * 1.9} fill={lit} style={{ filter: `drop-shadow(0 0 ${width * 4}px ${lit})` }} />}
    </g>
  );
};

/**
 * A NAND gate glyph (inputs on the left, output on the right) centred at (x, y), `s` px wide.
 * `lit` 0..1 fills it lime (the gate has evaluated).
 */
export const Nand: React.FC<{ x: number; y: number; s?: number; lit?: number; ink?: string; fill?: string; label?: string; opacity?: number; scale?: number }> = ({ x, y, s = 80, lit = 0, ink = "rgba(236,237,238,0.7)", fill = C.lime, label, opacity = 1, scale = 1 }) => {
  const h = s * 0.8;
  const body = `M${-s / 2} ${-h / 2} H${0} A${h / 2} ${h / 2} 0 0 1 ${0} ${h / 2} H${-s / 2} Z`;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <path d={body} fill={lit > 0 ? fill : "none"} fillOpacity={lit} stroke={lit > 0.5 ? fill : ink} strokeWidth={2.5} strokeLinejoin="round" style={lit > 0.5 ? { filter: `drop-shadow(0 0 10px ${fill})` } : undefined} />
      <circle cx={h / 2 + s * 0.08} cy={0} r={s * 0.075} fill="none" stroke={lit > 0.5 ? fill : ink} strokeWidth={2.5} />
      {label && <text x={-s * 0.12} y={s * 0.07} textAnchor="middle" fontSize={s * 0.17} fontFamily="monospace" fill={lit > 0.5 ? C.ink : ink} letterSpacing="0.05em">{label}</text>}
    </g>
  );
};

/** A threshold neuron: a circle with its threshold inside; `lit` 0..1 fires it. */
export const Neuron: React.FC<{ x: number; y: number; r?: number; lit?: number; ink?: string; text?: string; fill?: string; fail?: number; textColor?: string; font?: string }> = ({ x, y, r = 60, lit = 0, ink = "rgba(236,237,238,0.75)", text, fill = C.lime, fail = 0, textColor, font }) => (
  <g transform={`translate(${x} ${y})`}>
    <circle r={r} fill={fill} fillOpacity={lit * 0.95} stroke={fail > 0 ? C.red : lit > 0.5 ? fill : ink} strokeWidth={3} style={lit > 0.5 ? { filter: `drop-shadow(0 0 18px ${fill})` } : undefined} />
    {text && <text y={r * 0.12} textAnchor="middle" fontSize={r * 0.36} fontFamily={font ?? "monospace"} fill={textColor ?? (lit > 0.5 ? C.ink : ink)}>{text}</text>}
  </g>
);
