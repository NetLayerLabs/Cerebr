import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp, pop, ramp } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { Count } from "../ui/Count";
import { LitPath, Neuron } from "../ui/Wire";
import data from "../data.json";
import { DotGrid, Label, useCue } from "./common";

/** CerebrAgent: five pins read from the chain, a 19-NAND neuron (#8), Go or No-Go, every decision replayable. */
export const Agent: React.FC = () => {
  const { f, rel } = useCue("agent");
  const tName = rel("CerebrAgent's");
  const tTen = rel("ten");
  const tReads = rel("reads");
  const tAsks = rel("asks");
  const tRecords = rel("records");
  const tReplay = rel("replay");
  const g = data.agent;
  const hold = 60;
  const N = { x: 450, y: 330 };
  const pinY = (i: number) => 150 + i * 90;
  const read = (i: number) => ramp(f, tReads + i * 5, tReads + i * 5 + 10);
  const sig = interpolate(f, [tAsks - 6, tAsks + 20], [0, 1], clamp);
  const out = interpolate(f, [tRecords - 4, tRecords + 14], [0, 1], clamp);
  const verified = Math.min(1, pop(f, hold + 381 - 6));
  return (
    <AbsoluteFill style={{ background: C.night, fontFamily: sans, color: C.text }}>
      <DotGrid />
      <div style={{ position: "absolute", left: 110, top: 160, width: 680 }}>
        <Label>CerebrAgent · policy circuit #{g.circuit} · 19 NAND</Label>
        <div style={{ marginTop: 18, display: "flex", gap: 34, opacity: ramp(f, tName - 6, tName + 10) }}>
          {[["decisions", g.decisions], ["Go", g.go], ["No-Go", g.noGo]].map(([k, v], i) => (
            <div key={k as string}>
              <Count to={v as number} at={tName + i * 6} dur={30} style={{ fontSize: 56, letterSpacing: "-0.04em", lineHeight: 1, color: i === 1 ? C.lime : C.text }} />
              <div style={{ fontFamily: mono, fontSize: 15, color: C.muted, marginTop: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>{k}</div>
            </div>
          ))}
          <div style={{ alignSelf: "flex-end", fontFamily: mono, fontSize: 15, color: C.muted, opacity: ramp(f, tTen - 4, tTen + 10), paddingBottom: 22 }}>act() every 10 min</div>
        </div>
        <svg width={660} height={620} style={{ marginTop: 6 }}>
          {g.pins.map((p, i) => {
            const on = p.v === 1;
            const y = pinY(i);
            return (
              <g key={p.name} opacity={0.3 + 0.7 * read(i)}>
                <rect x={0} y={y - 18} width={36} height={36} fill={on && read(i) > 0.5 ? C.amber : "none"} stroke={C.amber} strokeWidth={2.5} />
                <text x={52} y={y - 2} fontFamily={mono} fontSize={19} fill={C.text}>{p.name}</text>
                <text x={52} y={y + 20} fontFamily={mono} fontSize={14} fill={C.muted}>{p.w > 0 ? "+1" : "−1"} · reads {p.v}</text>
                <LitPath d={`M200 ${y} C330 ${y} 330 ${N.y} ${N.x - 70} ${N.y}`} p={on ? sig : 0} width={2.5} head={false} base={p.w < 0 ? "rgba(255,97,89,0.28)" : "rgba(236,237,238,0.16)"} />
              </g>
            );
          })}
          <Neuron x={N.x} y={N.y} r={70} lit={0} text={`${g.sum} < ${g.theta}`} />
          <text x={N.x} y={N.y + 110} textAnchor="middle" fontFamily={mono} fontSize={16} fill={C.muted} opacity={sig}>sum vs θ</text>
          <LitPath d={`M${N.x + 70} ${N.y} H640`} p={out} width={3} lit={C.text} glow={false} head={false} />
          <g opacity={out}>
            <rect x={534} y={N.y + 18} width={104} height={36} fill="none" stroke={C.text} strokeWidth={1.5} />
            <text x={586} y={N.y + 42} textAnchor="middle" fontFamily={mono} fontSize={17} fill={C.text}>{g.verdict}</text>
          </g>
        </svg>
        <div style={{ marginTop: -30, display: "inline-flex", alignItems: "center", gap: 14, padding: "14px 20px", background: C.lime, color: C.ink, opacity: verified, transform: `scale(${0.9 + 0.1 * verified})`, transformOrigin: "0 50%" }}>
          <span style={{ fontFamily: mono, fontSize: 20, letterSpacing: "0.08em" }}>REPLAY ALL · {g.verified} / {g.replayed} VERIFIED</span>
        </div>
      </div>
      <Browser name="agent" url="cerebr.xyz/app#agent" width={1040} left={790} top={196} hold={hold}
        cams={[{ f: 0 }, { f: 60, rect: { x: 76, y: 96, w: 823, h: 665 }, z: 1.5 }, { f: hold + 215, rect: { x: 76, y: 96, w: 823, h: 665 }, z: 1.5 }, { f: hold + 260, rect: { x: 76, y: 200, w: 1000, h: 560 }, z: 1.45 }]} />
      <div style={{ position: "absolute", left: 790, top: 880, fontFamily: mono, fontSize: 15, color: C.muted, opacity: ramp(f, 40, 60) }}>
        live reading, block {g.block} · 7 Oct 2026, 22:15 UTC
      </div>
    </AbsoluteFill>
  );
};
