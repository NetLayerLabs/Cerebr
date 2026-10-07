import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp, ramp } from "../ui/motion";
import { LitPath, Nand, Neuron } from "../ui/Wire";
import { Words } from "../ui/Words";
import { DotGrid, useCue } from "./common";

/** A neuron is a weighted vote: enough inputs fire, it fires. That is logic; logic is NAND gates. */
export const Idea: React.FC = () => {
  const { f, rel } = useCue("idea");
  const tVote = rel("But");
  const tIf = rel("If");
  const tIns = [rel("enough"), rel("inputs"), rel("fire,")];
  const tFires = rel("fires.");
  const tLogic = rel("That");
  const tGates = rel("And");
  const morph = ramp(f, tGates - 4, tGates + 20);
  const N = { x: 1180, y: 600 };
  const ins = [470, 600, 730].map((y, i) => ({ x: 640, y, t: tIns[i] }));
  const sum = ins.filter((x) => f >= x.t + 10).length;
  const fired = ramp(f, tFires - 6, tFires + 4);
  // the gate chain the neuron becomes: 5 NAND across, lit one by one
  const gates = [0, 1, 2, 3, 4].map((i) => ({ x: 760 + i * 190, y: 600 + (i % 2 ? -70 : 70) * (i === 4 ? 0 : 1) }));
  const gateRun = interpolate(f, [rel("gates.") - 12, rel("gates.") + 40], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.night, fontFamily: sans, color: C.text }}>
      <DotGrid />
      <div style={{ position: "absolute", left: 150, top: 150, fontSize: 70, fontWeight: 400, letterSpacing: "-0.035em", lineHeight: 1.08 }}>
        <div style={{ opacity: 1 - ramp(f, tLogic - 6, tLogic + 6) * 0.65 }}><Words text="A neuron is just a weighted vote." at={tVote + 8} every={4} accent={{ "vote.": C.lime }} /></div>
        <div><Words text="That is logic." at={tLogic} every={4} out={tGates - 8} /></div>
      </div>
      <div style={{ position: "absolute", left: 150, top: 226, fontSize: 70, fontWeight: 400, letterSpacing: "-0.035em" }}>
        <Words text="And logic is gates." at={tGates} every={6} accent={{ "gates.": C.lime }} />
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        <g transform="translate(-160 0)">
        <g opacity={(1 - morph) * ramp(f, tIf - 30, tIf - 10)}>
          {ins.map((p, i) => {
            const on = ramp(f, p.t, p.t + 6);
            return (
              <g key={i}>
                <rect x={p.x - 24} y={p.y - 24} width={48} height={48} fill={on > 0.5 ? C.amber : "none"} stroke={C.amber} strokeWidth={3} />
                <text x={p.x - 50} y={p.y + 8} textAnchor="end" fontFamily={mono} fontSize={22} fill={C.muted}>x{i}</text>
                <LitPath d={`M${p.x + 24} ${p.y} C${(p.x + N.x) / 2} ${p.y} ${(p.x + N.x) / 2} ${N.y} ${N.x - 80} ${N.y}`} p={interpolate(f, [p.t, p.t + 16], [0, 1], clamp)} width={3} />
                <text x={p.x + 150} y={p.y - 14 + (i - 1) * 8} fontFamily={mono} fontSize={22} fill={C.lime}>+1</text>
              </g>
            );
          })}
          <Neuron x={N.x} y={N.y} r={80} lit={fired} text={`${sum} ≥ 2`} />
          <LitPath d={`M${N.x + 80} ${N.y} H1600`} p={interpolate(f, [tFires, tFires + 18], [0, 1], clamp)} width={3} />
          <text x={1620} y={N.y + 9} fontFamily={mono} fontSize={26} fill={fired > 0.5 ? C.lime : C.muted}>fires</text>
          <text x={N.x} y={N.y + 150} textAnchor="middle" fontFamily={mono} fontSize={28} fill={C.text} opacity={ramp(f, tLogic, tLogic + 12)}>y = [ x0 + x1 + x2 ≥ 2 ]</text>
        </g>
        <g opacity={morph}>
          <LitPath d={`M470 600 ${gates.map((g) => `L${g.x - 40} ${g.y} L${g.x + 50} ${g.y}`).join(" ")} L1700 600`} p={gateRun} width={3} />
          {gates.map((g, i) => (
            <Nand key={i} x={g.x} y={g.y} s={92} lit={interpolate(gateRun, [(i + 0.6) / 6.2, (i + 0.9) / 6.2], [0, 1], clamp)} label="NAND" scale={interpolate(morph, [0, 1], [0.6, 1])} />
          ))}
        </g>
        </g>
      </svg>
    </AbsoluteFill>
  );
};
