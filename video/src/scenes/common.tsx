import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { K, scene, wordAt } from "../timing";
import { C, mono } from "../theme";

/** Scene-local frame and word cues (30 fps units): rel("word", n) is when the nth "word" is spoken. */
export function useCue(id: string) {
  const s = scene(id);
  // All values in 30 fps units (fractional at 60 fps), so scene code is frame-rate independent.
  const f = useCurrentFrame() / K;
  const rel = (w: string, n = 0) => (wordAt(id, w, n) - s.from) / K;
  return { s, f, rel, dur: s.durationInFrames / K };
}

/** A faint dot grid, like the app's die-shot backdrop. */
export const DotGrid: React.FC<{ color?: string; gap?: number; opacity?: number }> = ({ color = "rgba(236,237,238,0.07)", gap = 32, opacity = 1 }) => (
  <AbsoluteFill style={{ opacity, backgroundImage: `radial-gradient(${color} 1.2px, transparent 1.3px)`, backgroundSize: `${gap}px ${gap}px` }} />
);

/** Small mono label with the app's square bullet (section heads in the dApp). */
export const Label: React.FC<{ children: React.ReactNode; color?: string; dot?: string; style?: React.CSSProperties }> = ({ children, color = C.muted, dot = C.lime, style }) => (
  <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: "0.14em", textTransform: "uppercase", color, display: "flex", alignItems: "center", gap: 12, ...style }}>
    <span style={{ width: 7, height: 7, background: dot, display: "inline-block" }} />{children}
  </div>
);
