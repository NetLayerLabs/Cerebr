import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, mono, sans, serif } from "../theme";
import { clamp, pop, ramp } from "../ui/motion";
import { LitPath, Neuron } from "../ui/Wire";
import { Words } from "../ui/Words";
import { Label, useCue } from "./common";

/** Networks decide everywhere, but not onchain; off-chain models ask for trust. (Illustration.) */
export const Gap: React.FC = () => {
  const { f, rel } = useCue("gap");
  const tToday = rel("Today,");
  const tBut = rel("But");
  const tCant = rel("can't");
  const tModels = rel("Models");
  const tTrust = rel("trust");
  const phase2 = ramp(f, tBut - 6, tBut + 10);
  const phase3 = ramp(f, tModels - 8, tModels + 12);
  // Phase 1: a field of neurons lighting up ("everywhere")
  const field = [] as React.ReactNode[];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 4; j++) {
    const x = 260 + i * 175, y = 330 + j * 140;
    const t = tToday + 18 + ((i * 7 + j * 13) % 23) * 3;
    const lit = interpolate(f, [t, t + 8, t + 30, t + 44], [0, 1, 1, 0.35], clamp);
    field.push(<Neuron key={`${i}-${j}`} x={x} y={y} r={22} lit={lit} ink="rgba(17,18,20,0.35)" fill={C.olive} />);
    if (i < 8) field.push(<LitPath key={`w${i}-${j}`} d={`M${x + 22} ${y} H${x + 153}`} p={lit} width={2} base="rgba(17,18,20,0.12)" lit={C.olive} head={false} glow={false} />);
  }
  const cards = [
    { w: "game,", label: "a game" },
    { w: "agent", label: "an agent" },
    { w: "DAO", label: "a DAO" },
  ];
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: sans, color: C.ink }}>
      <div style={{ position: "absolute", left: 150, top: 140, fontSize: 64, fontWeight: 400, letterSpacing: "-0.035em", lineHeight: 1.1, opacity: 1 - phase3 }}>
        <div style={{ opacity: 1 - phase2 * 0.75 }}><Words text="Neural networks decide everywhere." at={tToday + 20} every={4} accent={{ "everywhere.": C.olive }} /></div>
        <div style={{ marginTop: 6 }}><Words text="But onchain, nothing can run one." at={tBut} every={4} accent={{ "onchain,": C.olive }} /></div>
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute", opacity: (1 - phase2) * ramp(f, tToday, tToday + 14) }}>{field}</svg>
      {/* Phase 2: three onchain things, each with a broken wire to a neuron */}
      <div style={{ position: "absolute", left: 150, top: 470, display: "flex", gap: 44, opacity: phase2 * (1 - phase3) }}>
        {cards.map((c, i) => {
          const t = rel(c.w);
          const p = pop(f, t - 4);
          const broken = ramp(f, tCant - 2, tCant + 10);
          return (
            <div key={c.label} style={{ width: 500, height: 300, background: "#fdfdfa", border: "1px solid rgba(17,18,20,0.14)", padding: "30px 34px", opacity: Math.min(1, p), transform: `translateY(${(1 - Math.min(1, p)) * 50}px) scale(${0.94 + 0.06 * Math.min(1, p)})` }}>
              <div style={{ fontFamily: mono, fontSize: 15, letterSpacing: "0.14em", color: "rgba(17,18,20,0.5)" }}>ONCHAIN · 0{i + 1}</div>
              <div style={{ marginTop: 14, fontSize: 52, fontWeight: 400, letterSpacing: "-0.03em" }}>{c.label}</div>
              <svg width={430} height={120} style={{ marginTop: 18 }}>
                <path d="M10 60 H180" stroke={C.ink} strokeWidth={3} />
                <path d="M250 60 H330" stroke="rgba(17,18,20,0.3)" strokeWidth={3} strokeDasharray="6 8" />
                <g opacity={broken}>
                  <path d="M196 44 L232 76 M232 44 L196 76" stroke="#c0261d" strokeWidth={4} strokeLinecap="round" />
                </g>
                <circle cx={370} cy={60} r={32} fill="none" stroke="rgba(17,18,20,0.3)" strokeWidth={3} strokeDasharray="5 6" />
                <text x={370} y={67} textAnchor="middle" fontFamily={mono} fontSize={18} fill="rgba(17,18,20,0.4)">θ</text>
              </svg>
            </div>
          );
        })}
      </div>
      {/* Phase 3: the model lives on a server; its answer comes back unproven */}
      <div style={{ position: "absolute", inset: 0, opacity: phase3 }}>
        <div style={{ position: "absolute", left: 150, top: 150, fontSize: 64, fontWeight: 400, letterSpacing: "-0.035em", lineHeight: 1.1 }}>
          <Words text="Models live on servers." at={tModels} every={5} accent={{ "servers.": C.olive }} />
          <div style={{ color: "rgba(17,18,20,0.5)" }}><Words text="You trust whatever comes back." at={tTrust - 4} every={4} /></div>
        </div>
        <div style={{ position: "absolute", left: 150, top: 470, width: 520, height: 330, background: C.ink, color: C.text, padding: "30px 34px" }}>
          <Label>Your contract</Label>
          <div style={{ marginTop: 40, fontFamily: mono, fontSize: 28, color: C.text }}>require(answer == ?)</div>
          <div style={{ marginTop: 18, fontFamily: mono, fontSize: 18, color: C.muted, lineHeight: 1.5 }}>no way to check how<br />the answer was made</div>
        </div>
        <div style={{ position: "absolute", left: 1250, top: 470, width: 520, height: 330, background: "#fdfdfa", border: "1px solid rgba(17,18,20,0.14)", padding: "30px 34px" }}>
          <Label color="rgba(17,18,20,0.5)" dot={C.ink}>Model on a server</Label>
          <svg width={450} height={200} style={{ marginTop: 30 }}>
            {[0, 1, 2].map((i) => [0, 1, 2, 3].map((j) => <circle key={`${i}${j}`} cx={60 + i * 160} cy={30 + j * 46} r={14} fill="rgba(17,18,20,0.85)" />))}
            <rect x={0} y={0} width={450} height={200} fill="rgba(17,18,20,0.92)" />
            <text x={225} y={112} textAnchor="middle" fontFamily={serif} fontStyle="italic" fontSize={64} fill={C.paper}>black box</text>
          </svg>
        </div>
        <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
          <LitPath d="M1250 635 H670" p={interpolate(f, [tTrust - 30, tTrust + 10], [0, 1], clamp)} width={3} base="rgba(17,18,20,0.15)" lit={C.ink} glow={false} />
          <g opacity={ramp(f, tTrust + 4, tTrust + 14)}>
            <rect x={850} y={588} width={220} height={52} fill={C.paper} stroke={C.ink} strokeWidth={2} />
            <text x={960} y={622} textAnchor="middle" fontFamily={mono} fontSize={22} fill={C.ink}>answer: 1 ?</text>
          </g>
        </svg>
        <div style={{ position: "absolute", right: 150, top: 830, fontFamily: mono, fontSize: 14, letterSpacing: "0.14em", color: "rgba(17,18,20,0.45)" }}>ILLUSTRATION</div>
      </div>
    </AbsoluteFill>
  );
};
