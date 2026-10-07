import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp, pop, ramp } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { Count } from "../ui/Count";
import { LitPath } from "../ui/Wire";
import { Words } from "../ui/Words";
import { Label, useCue } from "./common";

/** The 1969 XOR network, as three taped-out neurons joined by REF: circuit #5, 0 transistors. */
export const Compose: React.FC = () => {
  const { f, rel } = useCue("compose");
  const tXor = rel("XOR");
  const tThree = rel("three");
  const tRef = rel("joined");
  const tZero = rel("zero");
  const hold = 12;
  const box = (x: number, y: number, name: string, id: string, at: number) => {
    const p = Math.min(1, pop(f, at));
    return (
      <g transform={`translate(${x} ${y}) scale(${0.85 + 0.15 * p})`} opacity={p}>
        <rect x={-78} y={-40} width={156} height={80} fill="#fdfdfa" stroke={C.ink} strokeWidth={2} />
        <text x={0} y={-6} textAnchor="middle" fontFamily={sans} fontSize={22} fill={C.ink}>{name}</text>
        <text x={0} y={22} textAnchor="middle" fontFamily={mono} fontSize={16} fill={C.olive}>REF {id}</text>
      </g>
    );
  };
  const run = interpolate(f, [tRef - 4, tRef + 40], [0, 1], clamp);
  const wire = (d: string, a: number, b: number) => <LitPath d={d} p={interpolate(run, [a, b], [0, 1], clamp)} width={3} base="rgba(17,18,20,0.22)" lit={C.olive} glow={false} />;
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: sans, color: C.ink }}>
      <div style={{ position: "absolute", left: 120, top: 170, width: 500 }}>
        <Label color="rgba(17,18,20,0.55)" dot={C.olive}>Circuit #5 · XOR network</Label>
        <div style={{ marginTop: 22, fontSize: 60, fontWeight: 400, letterSpacing: "-0.035em", lineHeight: 1.05 }}>
          <Words text="Neurons wire into networks." at={rel("Neurons") - 4} every={4} accent={{ "networks.": C.olive }} />
        </div>
      </div>
      <svg width={640} height={430} viewBox="-30 0 670 430" style={{ position: "absolute", left: 100, top: 390, width: 560, height: 360, opacity: ramp(f, tThree - 12, tThree + 4) }}>
        {wire("M40 120 C120 120 120 100 200 100", 0, 0.35)}
        {wire("M40 300 C120 300 120 100 200 100", 0, 0.35)}
        {wire("M40 120 C120 120 120 320 200 320", 0, 0.35)}
        {wire("M40 300 C120 300 120 320 200 320", 0, 0.35)}
        {wire("M356 100 C420 100 420 210 470 210", 0.4, 0.75)}
        {wire("M356 320 C420 320 420 210 470 210", 0.4, 0.75)}
        {wire("M626 210 H640", 0.8, 1)}
        <text x={20} y={127} textAnchor="end" fontFamily={mono} fontSize={20} fill="rgba(17,18,20,0.6)">x0</text>
        <text x={20} y={307} textAnchor="end" fontFamily={mono} fontSize={20} fill="rgba(17,18,20,0.6)">x1</text>
        {box(278, 100, "OR", "#2", tThree)}
        {box(278, 320, "NAND", "#3", tThree + 6)}
        {box(548, 210, "AND", "#1", tThree + 12)}
      </svg>
      <div style={{ position: "absolute", left: 120, top: 830, display: "flex", alignItems: "baseline", gap: 16, opacity: ramp(f, tZero - 6, tZero + 6) }}>
        <Count to={0} at={tZero} style={{ fontSize: 96, letterSpacing: "-0.04em", lineHeight: 0.9, color: C.olive }} />
        <span style={{ fontSize: 28, letterSpacing: "-0.02em" }}>new transistors burned</span>
      </div>
      <Browser name="compose" url="cerebr.xyz/app#studio" width={1100} left={720} top={190} light hold={hold}
        cams={[{ f: 0 }, { f: 40, rect: { x: 76, y: 280, w: 666, h: 300 }, z: 1.5 }, { f: 110, rect: { x: 76, y: 280, w: 666, h: 300 }, z: 1.5 }, { f: 150, rect: { x: 781, y: 70, w: 720, h: 360 }, z: 1.6 }, { f: tZero - 30, rect: { x: 781, y: 70, w: 720, h: 360 }, z: 1.6 }, { f: tZero + 5, rect: { x: 780, y: 440, w: 760, h: 140 }, z: 1.8 }]} />
    </AbsoluteFill>
  );
};
