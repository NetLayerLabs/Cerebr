import React from "react";
import { AbsoluteFill, Sequence, interpolate } from "remotion";
import { K } from "../timing";
import { C, mono, sans } from "../theme";
import { clamp, pop, ramp } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { Count } from "../ui/Count";
import { XLayerLogo } from "../ui/Logos";
import { Nand } from "../ui/Wire";
import data from "../data.json";
import { DotGrid, Label, useCue } from "./common";

/**
 * The die lights one cell per taped-out circuit (16); landing hero and its live table, the
 * Inference gate trace for "gate by gate", then the Genesis Drop.
 */
export const Tapeout: React.FC = () => {
  const { f, rel } = useCue("tapeout");
  const tEach = rel("Each");
  const t16 = rel("Sixteen");
  const tFree = rel("free");
  const tNew = rel("New");
  const tClaim = rel("claim");
  const cellAt = (i: number) => t16 - 6 + i * 3;
  const lit = (i: number) => ramp(f, cellAt(i), cellAt(i) + 6);
  const burn = interpolate(f, [tEach + 10, tEach + 30, rel("transistor") + 10], [0, 1, 1], clamp);
  const row = (at: number, children: React.ReactNode, out?: number) => {
    const p = Math.min(1, pop(f, at - 4));
    const o = out != null ? 1 - ramp(f, out, out + 12) * 0.6 : 1;
    return <div style={{ opacity: p * o, transform: `translateX(${(1 - p) * -30}px)`, marginTop: 30 }}>{children}</div>;
  };
  // Right-hand footage windows (local frames)
  const W = { left: 640, top: 196, width: 1160 };
  const segA = 240, segB = 330;
  const xIn = (a: number) => ramp(f, a, a + 12);
  return (
    <AbsoluteFill style={{ background: C.night, fontFamily: sans, color: C.text }}>
      <DotGrid />
      <div style={{ position: "absolute", left: 110, top: 160, width: 470 }}>
        <Label>Cerebr processor · {data.processor.short}</Label>
        {/* the die: one cell per circuit */}
        <div style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 26 }}>
          <div style={{ position: "relative", width: 196, height: 196, border: "2px solid rgba(236,237,238,0.35)", padding: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 9 }}>
            {Array.from({ length: 16 }, (_, i) => (
              <div key={i} style={{ background: lit(i) > 0.5 ? C.lime : "rgba(236,237,238,0.08)", boxShadow: lit(i) > 0.5 ? `0 0 14px ${C.lime}` : "none", opacity: 0.35 + 0.65 * lit(i) }} />
            ))}
            {[0, 1, 2, 3, 4].map((k) => <div key={`p${k}`} style={{ position: "absolute", left: -14, top: 22 + k * 36, width: 12, height: 3, background: "rgba(236,237,238,0.35)" }} />)}
            {[0, 1, 2, 3, 4].map((k) => <div key={`q${k}`} style={{ position: "absolute", right: -14, top: 22 + k * 36, width: 12, height: 3, background: lit(15) > 0.5 ? C.lime : "rgba(236,237,238,0.35)" }} />)}
          </div>
          <div style={{ opacity: ramp(f, t16 - 4, t16 + 10) }}>
            <Count to={16} at={t16 - 4} dur={16 * 3 + 6} style={{ fontSize: 120, fontWeight: 400, letterSpacing: "-0.04em", lineHeight: 0.9, color: C.lime }} />
            <div style={{ fontFamily: mono, fontSize: 18, color: C.muted, marginTop: 6 }}>circuits live</div>
          </div>
        </div>
        {row(tEach, (
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <svg width={90} height={64}><Nand x={44} y={32} s={62} lit={burn} /></svg>
            <div>
              <div style={{ fontSize: 30, letterSpacing: "-0.02em" }}>1 gate = 1 transistor burned</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                <span style={{ fontFamily: mono, fontSize: 16, color: C.muted }}>on</span>
                <XLayerLogo height={20} />
                <span style={{ fontFamily: mono, fontSize: 16, color: C.muted }}>mainnet</span>
              </div>
            </div>
          </div>
        ), tNew)}
        {row(tFree, (
          <div>
            <div style={{ fontSize: 30, letterSpacing: "-0.02em" }}><span style={{ fontFamily: mono, color: C.lime }}>eval()</span> is free</div>
            <div style={{ fontFamily: mono, fontSize: 16, color: C.muted, marginTop: 6 }}>a view call, gate by gate, onchain</div>
          </div>
        ), tNew)}
        {row(tClaim, (
          <div style={{ borderTop: `1px solid ${C.lineDark}`, paddingTop: 22 }}>
            <Label>Genesis Drop #1</Label>
            <div style={{ fontSize: 44, letterSpacing: "-0.03em", marginTop: 10 }}><span style={{ color: C.lime }}>{data.drop.perClaim} NAND</span> free</div>
            <div style={{ fontFamily: mono, fontSize: 16, color: C.muted, marginTop: 6 }}>per builder · {data.drop.claimsLeft} of {data.drop.of} claims left</div>
          </div>
        ))}
      </div>
      {/* A: the landing page, hero then its live table */}
      <div style={{ opacity: 1 - ramp(f, segA - 8, segA + 4) }}>
        <Browser name="landing" url="cerebr.xyz" {...W} startFrom={200}
          cams={[{ f: 0 }, { f: 120 }, { f: 200, rect: { x: 76, y: 380, w: 900, h: 500 }, z: 1.45 }]} />
      </div>
      {/* B: Inference on #5 with the gate animation */}
      <Sequence from={Math.round((segA - 8) * K)} durationInFrames={Math.round((segB - segA + 20) * K)} layout="none">
        <div style={{ opacity: xIn(0) * (1 - ramp(f, segB - 8, segB + 4)) }}>
          <Browser name="infer" url="cerebr.xyz/app#playground/5" {...W} startFrom={70} cams={[{ f: 0, rect: { x: 808, y: 96, w: 716, h: 400 }, z: 1.75 }]} />
        </div>
      </Sequence>
      {/* C: the Genesis Drop card */}
      <Sequence from={Math.round((segB - 8) * K)} layout="none">
        <div style={{ opacity: xIn(segB - 8) }}>
          <Browser name="drop" url="cerebr.xyz/app#processor" {...W} startFrom={0}
            cams={[{ f: 0, rect: { x: 76, y: 96, w: 1448, h: 446 }, z: 1.08 }, { f: tClaim - segB - 6, rect: { x: 76, y: 96, w: 1448, h: 446 }, z: 1.08 }, { f: tClaim - segB + 22, rect: { x: 860, y: 150, w: 640, h: 230 }, z: 1.9 }]} />
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
