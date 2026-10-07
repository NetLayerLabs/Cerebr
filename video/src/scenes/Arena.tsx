import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { C, mono, sans } from "../theme";
import { clamp, pop, ramp } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { Count } from "../ui/Count";
import { LitPath, Nand } from "../ui/Wire";
import data from "../data.json";
import { Label, useCue } from "./common";

/** NeuralArena: the bot's reply is an eval() of circuit #16 (previewed free here); every game checked. */
export const Arena: React.FC = () => {
  const { f, rel } = useCue("arena");
  const t590 = rel("five-hundred-ninety-gate");
  const tInside = rel("inside");
  const tChecked = rel("checked");
  const tNever = rel("Humans");
  const a = data.arena;
  const card = (at: number, children: React.ReactNode, dark = false) => {
    const p = Math.min(1, pop(f, at - 4));
    return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, marginBottom: 20, padding: "20px 24px", background: dark ? C.ink : "#fdfdfa", color: dark ? C.text : C.ink, border: dark ? "none" : "1px solid rgba(17,18,20,0.14)" }}>{children}</div>;
  };
  const run = interpolate(f, [t590, t590 + 40], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: sans, color: C.ink }}>
      <Browser name="arena" url="cerebr.xyz/app#arena" width={1100} left={110} top={196} light startFrom={60}
        cams={[{ f: 0 }, { f: 40, rect: { x: 76, y: 218, w: 716, h: 551 }, z: 1.55 }, { f: 300, rect: { x: 76, y: 218, w: 716, h: 551 }, z: 1.55 }, { f: 345 }, { f: 405, rect: { x: 76, y: 200, w: 1100, h: 170 }, z: 1.45 }]} />
      <div style={{ position: "absolute", left: 1270, top: 176, width: 540 }}>
        <Label color="rgba(17,18,20,0.55)" dot={C.olive}>NeuralArena · circuit #{a.bot}</Label>
        <div style={{ height: 20 }} />
        {card(t590, (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <Count to={a.nand} at={t590} dur={30} style={{ fontSize: 64, letterSpacing: "-0.04em", lineHeight: 1 }} />
              <span style={{ fontFamily: mono, fontSize: 22, color: C.olive }}>NAND</span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 16, color: "rgba(17,18,20,0.6)", marginTop: 6 }}>{a.layers} layers · {a.neurons} threshold neurons</div>
            <svg width={490} height={60} style={{ marginTop: 10 }}>
              <text x={0} y={36} fontFamily={mono} fontSize={15} fill="rgba(17,18,20,0.6)">18 bits</text>
              <LitPath d="M70 31 H430" p={run} width={3} base="rgba(17,18,20,0.18)" lit={C.olive} glow={false} />
              {[0, 1, 2, 3].map((i) => <Nand key={i} x={130 + i * 80} y={31} s={40} lit={interpolate(run, [0.15 + i * 0.18, 0.3 + i * 0.18], [0, 1], clamp)} ink="rgba(17,18,20,0.5)" fill={C.olive} />)}
              <text x={440} y={36} fontFamily={mono} fontSize={15} fill="rgba(17,18,20,0.6)">move</text>
            </svg>
          </>
        ))}
        {card(tInside, <div style={{ fontSize: 24, letterSpacing: "-0.01em", lineHeight: 1.3 }}>Every bot move is an <span style={{ fontFamily: mono, color: C.olive }}>eval()</span> inside your own <span style={{ fontFamily: mono }}>play()</span> transaction</div>)}
        {card(tChecked, (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <Count to={a.boards} at={tChecked} dur={36} style={{ fontSize: 52, letterSpacing: "-0.04em", lineHeight: 1 }} />
              <span style={{ fontSize: 22 }}>boards checked</span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 16, color: "rgba(17,18,20,0.6)", marginTop: 6 }}>{a.games} games with the human moving first</div>
          </>
        ))}
        {card(tNever, (
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <div style={{ fontSize: 96, letterSpacing: "-0.04em", lineHeight: 0.9, color: C.lime }}>{a.humanWins}</div>
            <div>
              <div style={{ fontSize: 28, letterSpacing: "-0.02em" }}>human wins</div>
              <div style={{ fontFamily: mono, fontSize: 16, color: C.muted, marginTop: 6 }}>{a.botWins} bot wins · {a.draws} draws</div>
            </div>
          </div>
        ), true)}
      </div>
      <div style={{ position: "absolute", left: 110, top: 880, fontFamily: mono, fontSize: 15, color: "rgba(17,18,20,0.55)", opacity: ramp(f, 60, 80) }}>
        no wallet: "Preview the reply" runs the same eval() as a free view call
      </div>
    </AbsoluteFill>
  );
};
