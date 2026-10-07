import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp, expo, ramp } from "../ui/motion";
import { LitPath } from "../ui/Wire";
import { Mark } from "../ui/Mark";
import { Words } from "../ui/Words";
import data from "../data.json";
import { useCue } from "./common";

/** Full-bleed lime: three claims, each with its proof, strung on the lit wire. */
export const Unique: React.FC = () => {
  const { f, rel } = useCue("unique");
  const rows = [
    { at: rel("It's"), word: "Verifiable.", proof: `every answer is an eval() anyone can rerun · ${data.agent.verified} / ${data.agent.replayed} agent decisions replayed` },
    { at: rel("It's", 1), word: "Composable.", proof: "neurons are building blocks: XOR #5 = 3 REFs, 0 transistors" },
    { at: rel("And"), word: "Live.", proof: "3 verified contracts (Sourcify exact match) · no admin · no funds held" },
  ];
  const lift = interpolate(f, [rows[0].at - 14, rows[0].at + 6], [0, 1], { ...clamp, easing: expo });
  const Y = [380, 580, 780];
  const wireP = (i: number) => interpolate(f, [rows[i].at - 12, rows[i].at + 4], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.lime, fontFamily: sans, color: C.ink }}>
      <div style={{ position: "absolute", left: 150, top: interpolate(lift, [0, 1], [430, 150]), fontSize: interpolate(lift, [0, 1], [110, 48]), fontWeight: 400, letterSpacing: "-0.035em", color: lift > 0.5 ? "rgba(17,18,20,0.65)" : C.ink }}>
        <Words text="What makes Cerebr different?" at={0} every={4} accent={{ "different?": C.ink }} />
      </div>
      <div style={{ position: "absolute", left: 1270, top: 300, opacity: 0.16 * ramp(f, rows[0].at, rows[0].at + 30) }}>
        <Mark size={560} ink={C.ink} sig={interpolate(f, [rows[2].at, rows[2].at + 40], [0, 1], clamp)} litAfter lit={C.ink} />
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        <LitPath d={`M164 ${Y[0] - 80} V${Y[0]}`} p={wireP(0)} width={4} base="rgba(17,18,20,0.0)" lit={C.ink} glow={false} />
        <LitPath d={`M164 ${Y[0]} V${Y[1]}`} p={wireP(1)} width={4} base="rgba(17,18,20,0.15)" lit={C.ink} glow={false} />
        <LitPath d={`M164 ${Y[1]} V${Y[2]}`} p={wireP(2)} width={4} base="rgba(17,18,20,0.15)" lit={C.ink} glow={false} />
        {Y.map((y, i) => <rect key={i} x={152} y={y - 12} width={24} height={24} fill={f >= rows[i].at ? C.ink : "none"} stroke={C.ink} strokeWidth={3} opacity={ramp(f, rows[i].at - 20, rows[i].at - 8)} />)}
      </svg>
      {rows.map((r, i) => (
        <div key={i} style={{ position: "absolute", left: 230, top: Y[i] - 62 }}>
          <div style={{ fontSize: 96, fontWeight: 400, letterSpacing: "-0.045em", lineHeight: 1 }}>
            <Words text={r.word} at={r.at + 4} every={3} accent={{ [r.word]: C.ink }} serifScale={1.1} />
          </div>
          <div style={{ marginTop: 10, fontFamily: mono, fontSize: 21, letterSpacing: "0.02em", color: "rgba(17,18,20,0.72)", opacity: ramp(f, r.at + 16, r.at + 32) }}>{r.proof}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
};
