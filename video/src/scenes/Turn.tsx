import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp, expo, ramp } from "../ui/motion";
import { Mark, Wordmark } from "../ui/Mark";
import { LitPath } from "../ui/Wire";
import { Words } from "../ui/Words";
import { useCue } from "./common";

/** Full-bleed lime: the lit wire runs in and becomes the Cerebr mark; the line the product rests on. */
export const Turn: React.FC = () => {
  const { f, rel } = useCue("turn");
  const tMeet = rel("Meet");
  const tName = rel("Cerebr.");
  const tA = rel("A");
  const wire = interpolate(f, [0, tName - 2], [0, 1], { ...clamp, easing: expo });
  const p = interpolate(f, [tMeet - 4, tName + 22], [0, 1], clamp);
  const word = interpolate(f, [tName - 2, tName + 16], [0, 1], { ...clamp, easing: expo });
  const lift = interpolate(f, [tA - 10, tA + 10], [0, -90], { ...clamp, easing: expo });
  const words = ["A", "neural", "processor,", "taped", "out", "onchain."];
  const at2 = words.map((w, i) => rel(w) - 3 + (i === 0 ? 0 : 0));
  return (
    <AbsoluteFill style={{ background: C.lime, fontFamily: sans, color: C.ink }}>
      <svg width={1920} height={1080} style={{ position: "absolute", transform: `translateY(${lift}px)` }}>
        <LitPath d="M0 540 H466" p={wire} width={5} base="rgba(17,18,20,0.12)" lit={C.ink} glow={false} head={wire < 1} />
      </svg>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translateY(${lift}px)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
          <Mark size={220} p={p} ink={C.ink} sig={interpolate(f, [tName - 4, tName + 18], [0, 1], clamp)} lit={C.ink} />
          <div style={{ opacity: word, clipPath: `inset(0 ${(1 - word) * 100}% 0 0)` }}>
            <Wordmark size={150} color={C.ink} font={mono} />
          </div>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 650, textAlign: "center", fontSize: 76, fontWeight: 400, letterSpacing: "-0.035em" }}>
        <Words text={words.join(" ")} at={tA} at2={at2} accent={{ taped: C.ink, out: C.ink }} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 800, textAlign: "center", fontFamily: mono, fontSize: 18, letterSpacing: "0.16em", color: "rgba(17,18,20,0.6)", opacity: ramp(f, tA + 30, tA + 50) }}>
        CRB-1 // NEURAL PROCESSOR · X LAYER MAINNET
      </div>
    </AbsoluteFill>
  );
};
