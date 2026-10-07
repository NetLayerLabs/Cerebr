import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp, expo, ramp } from "../ui/motion";
import { Mark, Wordmark } from "../ui/Mark";
import { IgnixLogo, TapeOutIcon, XLayerLogo } from "../ui/Logos";
import { LitPath } from "../ui/Wire";
import { Words } from "../ui/Words";
import { DotGrid, useCue } from "./common";

/** The card: the lit wire resolves into the mark; tagline, URL, the event and the partners' official logos. */
export const Close: React.FC = () => {
  const { f, rel, dur } = useCue("close");
  const tName = rel("Cerebr.");
  const tNeurons = rel("Neurons,");
  const tTry = rel("Try");
  const wire = interpolate(f, [0, tName + 6], [0, 1], { ...clamp, easing: expo });
  const p = interpolate(f, [0, tName + 24], [0, 1], clamp);
  const word = interpolate(f, [tName - 2, tName + 16], [0, 1], { ...clamp, easing: expo });
  const end = interpolate(f, [dur - 24, dur], [1, 0], clamp);
  const partners = ramp(f, tTry + 24, tTry + 44);
  return (
    <AbsoluteFill style={{ background: C.night, fontFamily: sans, color: C.text, opacity: end }}>
      <DotGrid />
      <AbsoluteFill style={{ background: "radial-gradient(40% 50% at 50% 38%, rgba(212,255,63,0.10), transparent 70%)" }} />
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        <LitPath d="M0 330 H532" p={wire} width={4} head={wire < 1} />
      </svg>
      <AbsoluteFill style={{ alignItems: "center", flexDirection: "column", paddingTop: 230 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <Mark size={200} p={p} ink={C.lime} sig={interpolate(f, [tName, tName + 24], [0, 1], clamp)} litAfter lit={C.lime} />
          <div style={{ opacity: word, clipPath: `inset(0 ${(1 - word) * 100}% 0 0)` }}><Wordmark size={128} color={C.text} font={mono} /></div>
        </div>
        <div style={{ marginTop: 50, fontSize: 76, fontWeight: 400, letterSpacing: "-0.035em" }}>
          <Words text="Neurons, taped out onchain." at={tNeurons} at2={[tNeurons, rel("taped") - 2, rel("out") - 2, rel("onchain.") - 2]} accent={{ taped: C.lime, out: C.lime }} />
        </div>
        <div style={{ marginTop: 40, opacity: ramp(f, tTry - 2, tTry + 14), padding: "16px 34px", background: C.lime, color: C.ink, fontFamily: mono, fontSize: 30, letterSpacing: "0.02em" }}>cerebr.xyz</div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 850, display: "flex", justifyContent: "center", alignItems: "center", gap: 46, opacity: partners }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.12em", color: C.muted }}>LIVE ON</span>
          <XLayerLogo height={34} />
        </div>
        <div style={{ width: 1, height: 44, background: C.lineDark }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.12em", color: C.muted }}>BUILT ON</span>
          <TapeOutIcon size={46} />
          <span style={{ fontSize: 24, letterSpacing: "-0.01em" }}>TapeOut</span>
        </div>
        <div style={{ width: 1, height: 44, background: C.lineDark }} />
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.12em", color: C.muted, textAlign: "right", lineHeight: 1.4 }}>TAPEOUT GENESIS TRANSISTOR<br />HACKATHON BY</span>
          <div style={{ background: C.paper, width: 150, height: 80, position: "relative", overflow: "hidden" }}>
            <IgnixLogo size={155} style={{ position: "absolute", left: -5.5, top: -35.6 }} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
