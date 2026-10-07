import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { K, T } from "../timing";
import { mono, SCENE_LABEL, SCENE_TONE, TONE } from "../theme";
import { clamp } from "./motion";

const tc = (f: number) => {
  const s = Math.floor(f / T.fps);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `00:${pad(Math.floor(s / 60))}:${pad(s % 60)}:${pad(f % T.fps)}`;
};

/** Corner furniture, datasheet style: part number and scene tag, the file and its timecode. */
export const Chrome: React.FC<{ hideAfter?: number }> = ({ hideAfter }) => {
  const f = useCurrentFrame();
  const sc = T.scenes.find((s) => f >= s.from && f < s.from + s.durationInFrames) ?? T.scenes[T.scenes.length - 1];
  const tone = TONE[SCENE_TONE[sc.id] ?? "dark"];
  const local = f - sc.from;
  const tagIn = interpolate(local / K, [4, 16], [0, 1], clamp);
  const op = (hideAfter != null ? interpolate(f, [hideAfter, hideAfter + 12 * K], [1, 0], clamp) : 1) * interpolate(f, [0, 10 * K], [0, 1], clamp);
  const base: React.CSSProperties = { position: "absolute", fontFamily: mono, fontSize: 15, letterSpacing: "0.06em", color: tone.muted, opacity: op, textTransform: "uppercase" };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ ...base, left: 48, top: 36 }}>
        <span style={{ opacity: 0.85 }}>CRB-1 // cerebr</span>
        <span style={{ marginLeft: 22, opacity: tagIn }}>{SCENE_LABEL[sc.id]}</span>
      </div>
      <div style={{ ...base, right: 48, top: 36 }}>CEREBR_DEMO.MOV&nbsp;&nbsp;{tc(f)}</div>
      <div style={{ ...base, left: 48, bottom: 34, fontSize: 13 }}>tapeout genesis transistor hackathon · ignix · x layer</div>
      <div style={{ ...base, right: 48, bottom: 34, fontSize: 13 }}>cerebr.xyz</div>
    </AbsoluteFill>
  );
};
