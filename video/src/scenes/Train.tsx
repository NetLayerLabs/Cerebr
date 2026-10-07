import React from "react";
import { K } from "../timing";
import { AbsoluteFill, Sequence, interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp, pop, ramp } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { LitPath, Neuron } from "../ui/Wire";
import data from "../data.json";
import { DotGrid, Label, useCue } from "./common";

/** Train: Horizontal vs Vertical; the exact search proves no single neuron fits, adds the hidden layer, compiles. */
export const Train: React.FC = () => {
  const { f, rel } = useCue("train");
  const tDraw = rel("Draw");
  const tProves = rel("proves");
  const tAdds = rel("adds");
  const tThen = rel("Then");
  const W = { left: 110, top: 176, width: 1220 };
  const cut = 300;
  const card = (at: number, children: React.ReactNode, accent = false) => {
    const p = Math.min(1, pop(f, at - 4));
    return (
      <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, marginBottom: 22, padding: "20px 24px", background: accent ? C.lime : C.panel2, color: accent ? C.ink : C.text, border: accent ? "none" : `1px solid ${C.lineDark}` }}>{children}</div>
    );
  };
  const hid = interpolate(f, [tAdds - 4, tAdds + 26], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.night, fontFamily: sans, color: C.text }}>
      <DotGrid />
      <div style={{ opacity: 1 - ramp(f, cut - 6, cut + 6) }}>
        <Browser name="train" url="cerebr.xyz/app#train" {...W} startFrom={20}
          cams={[{ f: 0 }, { f: 30, rect: { x: 76, y: 96, w: 716, h: 513 }, z: 1.5 }, { f: 150, rect: { x: 76, y: 96, w: 716, h: 513 }, z: 1.5 }, { f: 190, rect: { x: 808, y: 96, w: 716, h: 560 }, z: 1.55 }, { f: 240, rect: { x: 808, y: 96, w: 716, h: 560 }, z: 1.55 }, { f: 300, rect: { x: 808, y: 200, w: 716, h: 420 }, z: 1.6 }]} />
      </div>
      <Sequence from={Math.round((cut - 6) * K)} layout="none">
        <div style={{ opacity: ramp(f, cut - 6, cut + 6) }}>
          <Browser name="train" url="cerebr.xyz/app#train" {...W} startFrom={444}
            cams={[{ f: 0, rect: { x: 808, y: 96, w: 716, h: 460 }, z: 1.65 }]} />
        </div>
      </Sequence>
      <div style={{ position: "absolute", left: 1380, top: 176, width: 430 }}>
        <Label>Train · in your browser</Label>
        <div style={{ height: 22 }} />
        {card(tDraw, <><div style={{ fontSize: 28, letterSpacing: "-0.02em" }}>Draw examples</div><div style={{ fontFamily: mono, fontSize: 16, color: C.muted, marginTop: 6 }}>fire on horizontal strokes, silent on vertical</div></>)}
        {card(tProves, <><div style={{ fontSize: 28, letterSpacing: "-0.02em" }}>No single neuron fits</div><div style={{ fontFamily: mono, fontSize: 16, color: C.muted, marginTop: 6 }}>exact search: proven, every ternary weight checked</div></>)}
        {card(tAdds, (
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <svg width={150} height={110}>
              {[0, 1, 2].map((i) => <LitPath key={i} d={`M8 ${20 + i * 35} H70 L120 55`} p={hid} width={2} head={false} />)}
              {[0, 1, 2].map((i) => <Neuron key={`n${i}`} x={60} y={20 + i * 35} r={12} lit={interpolate(hid, [0.3 + i * 0.1, 0.5 + i * 0.1], [0, 1], clamp)} />)}
              <Neuron x={128} y={55} r={15} lit={interpolate(hid, [0.85, 1], [0, 1], clamp)} />
            </svg>
            <div><div style={{ fontSize: 28, letterSpacing: "-0.02em" }}>+ a hidden layer</div><div style={{ fontFamily: mono, fontSize: 16, color: C.muted, marginTop: 6 }}>3 neurons, joined by OR</div></div>
          </div>
        ))}
        {card(tThen, <><div style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.12em", opacity: 0.7 }}>COMPILED</div><div style={{ fontSize: 40, letterSpacing: "-0.03em", marginTop: 4 }}>{data.gates.trainedHvV} NAND</div><div style={{ fontFamily: mono, fontSize: 16, marginTop: 6 }}>verified on all {data.gates.trainedCases} inputs, ready to tape out</div></>, true)}
      </div>
    </AbsoluteFill>
  );
};
