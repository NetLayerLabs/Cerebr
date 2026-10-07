import React from "react";
import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import footage from "../footage.json";
import { C, mono, sans } from "../theme";
import { clamp, soft } from "./motion";
import { K } from "../timing";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Clip { file: string; width: number; height: number; durationFrames: number; marks?: Record<string, number>; rects?: Record<string, Rect>; rectsAt?: Record<string, Record<string, Rect>> }
const LIB = footage as unknown as Record<string, Clip>;
export const clip = (name: string): Clip | undefined => LIB[name];
/** A clip mark in 30 fps units (footage is encoded at the composition rate). */
export const markOf = (name: string, m: string) => (clip(name)?.marks?.[m] ?? 0) / K;
/** startFrom so that clip mark `m` lands on local frame `at` of the parent sequence. */
export const syncTo = (name: string, m: string, at: number) => Math.max(0, markOf(name, m) - at);

/** The page the footage was recorded at, in CSS pixels. */
export const PAGE = { w: 1600, h: 900 };

/** A camera keyframe: at local frame `f`, centre on `rect` (page CSS px) at `z` times the fit. */
export interface Cam { f: number; rect?: Rect; z?: number }

function camAt(f: number, cams: Cam[]) {
  const pts = cams.map((c) => ({ f: c.f, z: c.z ?? (c.rect ? 1.6 : 1), cx: c.rect ? c.rect.x + c.rect.w / 2 : PAGE.w / 2, cy: c.rect ? c.rect.y + c.rect.h / 2 : PAGE.h / 2 }));
  if (!pts.length) return { z: 1, cx: PAGE.w / 2, cy: PAGE.h / 2 };
  if (f <= pts[0].f) return pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (f <= pts[i].f) {
      const a = pts[i - 1], b = pts[i];
      const t = interpolate(f, [a.f, b.f], [0, 1], { ...clamp, easing: soft });
      return { z: a.z + (b.z - a.z) * t, cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
    }
  }
  return pts[pts.length - 1];
}

/**
 * A browser window playing a recorded clip of the live app, with a camera that moves between
 * keyframes (`cams`). The clip holds its last frame if the scene outlasts it.
 */
export const Browser: React.FC<{
  name: string; url: string; width: number; left: number; top: number;
  startFrom?: number; cams?: Cam[]; enter?: number; tilt?: number; light?: boolean; style?: React.CSSProperties;
  /** Local frames to hold the clip's first frame before it plays. */ hold?: number;
  /** Clip frame to stop (freeze) at. */ stopAt?: number;
}> = ({ name, url, width, left, top, startFrom = 0, cams = [], enter = 0, tilt = 0, light, style, hold = 0, stopAt }) => {
  const frame = useCurrentFrame();
  const f = frame / K; // 30 fps units for cams, hold, enter
  const c = clip(name);
  const bar = 44;
  const vh = (width * PAGE.h) / PAGE.w;
  const k = width / PAGE.w;
  const cam = camAt(f, cams);
  const s = cam.z;
  const tx = Math.min(0, Math.max(width - PAGE.w * k * s, width / 2 - cam.cx * k * s));
  const ty = Math.min(0, Math.max(vh - PAGE.h * k * s, vh / 2 - cam.cy * k * s));
  const inP = interpolate(f, [enter, enter + 18], [0, 1], { ...clamp, easing: soft });
  // startFrom, hold and stopAt are in 30 fps units; the clip plays at the composition rate.
  const sf = Math.round(startFrom * K), hf = Math.round(hold * K);
  const last = Math.min(c ? c.durationFrames - 2 : 0, stopAt != null ? Math.round(stopAt * K) : Infinity);
  const pos = Math.max(0, frame - hf) + sf;
  const video = c ? <OffthreadVideo src={staticFile(c.file)} startFrom={sf} muted style={{ width: PAGE.w, height: PAGE.h }} /> : null;
  const player = frame < hf ? <Freeze frame={0}>{video}</Freeze> : pos >= last ? <Freeze frame={last - sf}>{video}</Freeze> : <Sequence from={hf} layout="none">{video}</Sequence>;
  return (
    <div style={{
      position: "absolute", left, top, width, height: vh + bar, borderRadius: 16, overflow: "hidden", background: C.night,
      boxShadow: light ? "0 0 0 1px rgba(17,18,20,0.16), 0 40px 90px rgba(17,18,20,0.28)" : "0 0 0 1px rgba(236,237,238,0.14), 0 40px 90px rgba(0,0,0,0.55)",
      opacity: inP, transform: `translateY(${(1 - inP) * 40}px) perspective(2400px) rotateX(${tilt * (1 - inP)}deg)`, ...style,
    }}>
      <div style={{ height: bar, display: "flex", alignItems: "center", gap: 9, padding: "0 18px", background: "#16181b", borderBottom: "1px solid rgba(236,237,238,0.08)" }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 11, height: 11, borderRadius: 6, background: "rgba(236,237,238,0.18)" }} />)}
        <div style={{ marginLeft: 16, flex: 1, height: 26, borderRadius: 6, background: "rgba(236,237,238,0.06)", display: "flex", alignItems: "center", padding: "0 14px", fontFamily: mono, fontSize: 14, color: C.muted, letterSpacing: "0.02em" }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: C.lime, marginRight: 10 }} />{url}
        </div>
      </div>
      <div style={{ position: "relative", width, height: vh, overflow: "hidden", background: C.night }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: PAGE.w, height: PAGE.h, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${k * s})` }}>
          {c ? player : (
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: sans, color: C.muted, fontSize: 28 }}>footage “{name}” pending</AbsoluteFill>
          )}
        </div>
      </div>
    </div>
  );
};
