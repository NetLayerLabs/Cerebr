import React from "react";
import { AbsoluteFill } from "remotion";
import { C, mono, sans, serif } from "./theme";
import { Mark, Wordmark } from "./ui/Mark";
import { IgnixLogo, TapeOutIcon, XLayerLogo } from "./ui/Logos";
import { LitPath, Nand } from "./ui/Wire";
import { DotGrid } from "./scenes/common";

/** Thumbnail: the lit wire runs through NAND gates into the mark; the line; the event. */
export const Poster: React.FC = () => (
  <AbsoluteFill style={{ background: C.night, fontFamily: sans, color: C.text }}>
    <DotGrid />
    <AbsoluteFill style={{ background: "radial-gradient(45% 55% at 50% 40%, rgba(212,255,63,0.13), transparent 70%)" }} />
    <svg width={1920} height={1080} style={{ position: "absolute" }}>
      <LitPath d="M0 330 H160 L230 330 M300 330 H392 M462 330 H520" p={0.999} width={5} head={false} />
      <Nand x={230} y={330} s={84} lit={1} />
      <Nand x={430} y={330} s={84} lit={1} />
    </svg>
    <div style={{ position: "absolute", left: 540, top: 200, display: "flex", alignItems: "center", gap: 48 }}>
      <Mark size={260} ink={C.lime} sig={1} litAfter lit={C.lime} />
      <Wordmark size={168} color={C.text} font={mono} />
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 560, textAlign: "center", fontSize: 104, fontWeight: 400, letterSpacing: "-0.04em" }}>
      A neural processor, <span style={{ fontFamily: serif, fontStyle: "italic", color: C.lime, fontSize: "1.12em" }}>taped out</span> onchain.
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 740, textAlign: "center", fontFamily: mono, fontSize: 30, letterSpacing: "0.08em", color: C.muted }}>
      16 CIRCUITS · 1 AGENT · 0 HUMAN WINS · LIVE ON X LAYER MAINNET
    </div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 880, display: "flex", justifyContent: "center", alignItems: "center", gap: 46 }}>
      <XLayerLogo height={40} />
      <div style={{ width: 1, height: 50, background: C.lineDark }} />
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}><TapeOutIcon size={54} /><span style={{ fontSize: 30 }}>TapeOut</span></div>
      <div style={{ width: 1, height: 50, background: C.lineDark }} />
      <div style={{ background: C.paper, width: 150, height: 80, position: "relative", overflow: "hidden" }}>
        <IgnixLogo size={155} style={{ position: "absolute", left: -5.5, top: -35.6 }} />
      </div>
      <span style={{ fontFamily: mono, fontSize: 18, letterSpacing: "0.12em", color: C.muted, lineHeight: 1.4 }}>TAPEOUT GENESIS<br />TRANSISTOR HACKATHON</span>
    </div>
  </AbsoluteFill>
);
