import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, mono, sans, serif } from "../theme";
import { clamp, expo, ramp } from "../ui/motion";
import { LitPath, Neuron } from "../ui/Wire";
import { DotGrid, Label, useCue } from "./common";

const ROWS = [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]] as const;

/**
 * 1969: a single neuron (two inputs, one output) tries XOR row by row and fails on the last
 * row; then a second layer lights and every row passes. The wire motif is born here.
 */
export const Open: React.FC = () => {
  const { f, rel } = useCue("open");
  const tYear = rel("Nineteen");
  const tNames = rel("Minsky");
  const tSingle = rel("single");
  const tXor = rel("XOR.");
  const tSecond = rel("second");
  const year = ramp(f, tYear - 4, tYear + 26);
  const diagram = ramp(f, tSingle - 10, tSingle + 16);
  // Single neuron trial: rows 0..3 between tSingle+30 and tXor+16, each ~ 14 frames.
  const trialStart = tSingle + 26;
  const step = Math.max(10, (tXor + 10 - trialStart) / 4);
  const rowAt = (i: number) => trialStart + i * step;
  const fail = ramp(f, rowAt(3) + step * 0.7, rowAt(3) + step * 0.7 + 8);
  const layer2 = ramp(f, tSecond - 8, tSecond + 18);
  const solvedAt = (i: number) => tSecond + 14 + i * 7;
  // Geometry
  const X0 = { x: 900, y: 400 }, X1 = { x: 900, y: 640 }, N = { x: 1300, y: 520 }, H0 = { x: 1160, y: 400 }, H1 = { x: 1160, y: 640 }, Y = { x: 1560, y: 520 };
  const nPos = { x: interpolate(layer2, [0, 1], [N.x, 1400]), y: N.y };
  const single = 1 - layer2;
  // which row is currently being tried on the single neuron
  let cur = -1;
  for (let i = 0; i < 4; i++) if (f >= rowAt(i)) cur = i;
  const rowP = cur >= 0 ? interpolate(f, [rowAt(cur), rowAt(cur) + step * 0.85], [0, 1], clamp) : 0;
  const r = cur >= 0 ? ROWS[cur] : ROWS[0];
  const wire = (a: { x: number; y: number }, b: { x: number; y: number }) => `M${a.x} ${a.y} C${(a.x + b.x) / 2} ${a.y} ${(a.x + b.x) / 2} ${b.y} ${b.x} ${b.y}`;
  // layer-2 run: a signal through every row at once (the network solves all four)
  const run2 = interpolate(f, [tSecond + 4, tSecond + 34], [0, 1], { ...clamp, easing: expo });
  return (
    <AbsoluteFill style={{ background: C.night, fontFamily: sans, color: C.text }}>
      <DotGrid opacity={0.8} />
      <AbsoluteFill style={{ background: "radial-gradient(50% 60% at 70% 50%, rgba(212,255,63,0.07), transparent 70%)" }} />
      <div style={{ position: "absolute", left: 150, top: 250, opacity: year, transform: `translateY(${(1 - year) * 40}px)`, filter: `blur(${(1 - year) * 10}px)` }}>
        <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 300, lineHeight: 0.85, color: C.lime, letterSpacing: "-0.02em" }}>1969</div>
        <div style={{ marginTop: 34, opacity: ramp(f, tNames - 4, tNames + 14) }}>
          <Label>Minsky &amp; Papert · Perceptrons</Label>
          <div style={{ marginTop: 18, fontSize: 40, fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1.2, maxWidth: 560, color: "rgba(236,237,238,0.85)" }}>
            One neuron cannot learn <span style={{ fontFamily: serif, fontStyle: "italic", color: C.lime, fontSize: "1.15em" }}>XOR.</span>
          </div>
        </div>
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute", opacity: diagram }}>
        {/* single-neuron wiring */}
        <g opacity={single}>
          <LitPath d={wire(X0, N)} p={cur >= 0 && r[0] ? rowP * 1.6 : 0} width={3} head={false} />
          <LitPath d={wire(X1, N)} p={cur >= 0 && r[1] ? rowP * 1.6 : 0} width={3} head={false} />
          <LitPath d={`M${N.x} ${N.y} H${Y.x}`} p={cur >= 0 && (cur === 3 ? 1 : r[2]) ? interpolate(rowP, [0.6, 1], [0, 1], clamp) : 0} width={3} lit={cur === 3 ? C.red : C.lime} />
        </g>
        {/* two-layer wiring */}
        <g opacity={layer2}>
          {[[X0, H0], [X1, H0], [X0, H1], [X1, H1]].map(([a, b], i) => <LitPath key={i} d={wire(a, b)} p={run2 * 1.4} width={3} head={false} />)}
          <LitPath d={wire(H0, nPos)} p={interpolate(run2, [0.4, 1], [0, 1], clamp)} width={3} head={false} />
          <LitPath d={wire(H1, nPos)} p={interpolate(run2, [0.4, 1], [0, 1], clamp)} width={3} head={false} />
          <LitPath d={`M${nPos.x} ${nPos.y} H${Y.x}`} p={interpolate(run2, [0.75, 1], [0, 1], clamp)} width={3} />
          <Neuron x={H0.x} y={H0.y} r={40} lit={interpolate(run2, [0.35, 0.5], [0, 1], clamp)} text="h0" />
          <Neuron x={H1.x} y={H1.y} r={40} lit={interpolate(run2, [0.35, 0.5], [0, 1], clamp)} text="h1" />
        </g>
        {[X0, X1].map((p, i) => (
          <g key={i}>
            <rect x={p.x - 26} y={p.y - 26} width={52} height={52} fill={cur >= 0 && layer2 < 0.5 && r[i] ? C.amber : "none"} stroke={C.amber} strokeWidth={3} />
            <text x={p.x - 56} y={p.y + 8} textAnchor="end" fontFamily={mono} fontSize={24} fill={C.muted}>x{i}</text>
          </g>
        ))}
        <Neuron x={nPos.x} y={nPos.y} r={66} lit={layer2 > 0.5 ? interpolate(run2, [0.7, 0.85], [0, 1], clamp) : 0} fail={fail * single} text={layer2 > 0.5 ? "y" : "θ"} />
        <text x={Y.x + 20} y={Y.y + 9} fontFamily={mono} fontSize={26} fill={C.muted}>y</text>
      </svg>
      {/* XOR truth table */}
      <div style={{ position: "absolute", left: 900, top: 760, opacity: diagram, display: "flex", gap: 14, fontFamily: mono, fontSize: 24 }}>
        <div style={{ color: C.muted, alignSelf: "center", marginRight: 10, letterSpacing: "0.12em", fontSize: 18 }}>XOR</div>
        {ROWS.map((row, i) => {
          const tried = f >= rowAt(i) + step * 0.8;
          const bad = i === 3 && tried && layer2 < 0.5;
          const solved = f >= solvedAt(i) && layer2 > 0.5;
          const col = solved ? C.lime : bad ? C.red : tried ? C.text : C.muted;
          return (
            <div key={i} style={{ padding: "12px 18px", border: `1.5px solid ${solved ? C.lime : bad ? C.red : "rgba(236,237,238,0.18)"}`, color: col, minWidth: 128, textAlign: "center", background: cur === i && layer2 < 0.5 ? "rgba(236,237,238,0.06)" : "transparent" }}>
              {row[0]}{row[1]} → {row[2]} <span style={{ marginLeft: 6 }}>{solved ? "✓" : bad ? "✗" : tried ? "✓" : ""}</span>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 1220, top: 330, fontFamily: mono, fontSize: 19, letterSpacing: "0.12em", color: C.red, opacity: fail * single }}>NO SINGLE NEURON FITS</div>
      <div style={{ position: "absolute", right: 150, top: 860, fontFamily: mono, fontSize: 14, letterSpacing: "0.14em", color: "rgba(236,237,238,0.4)", opacity: diagram }}>ILLUSTRATION OF THE 1969 RESULT</div>
      <div style={{ position: "absolute", left: 1180, top: 300, fontFamily: mono, fontSize: 19, letterSpacing: "0.12em", color: C.lime, opacity: ramp(f, tSecond + 10, tSecond + 24) }}>+ A SECOND LAYER</div>
    </AbsoluteFill>
  );
};
