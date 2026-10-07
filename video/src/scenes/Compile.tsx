import React from "react";
import { AbsoluteFill } from "remotion";
import { C, mono, sans } from "../theme";
import { pop, ramp } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { Count } from "../ui/Count";
import { TapeOutIcon } from "../ui/Logos";
import { Words } from "../ui/Words";
import { Label, useCue } from "./common";

const R = { design: { x: 76, y: 76, w: 666, h: 384 }, out: { x: 781, y: 130, w: 720, h: 400 } };

/** Studio footage: the AND neuron (2 NAND), then the five-input decision neuron (19 NAND). */
export const Compile: React.FC = () => {
  const { f, rel } = useCue("compile");
  const tAnd = rel("AND");
  const t19 = rel("nineteen.");
  const tOnly = rel("only");
  const hold = 100;
  const stat = (at: number, n: number, title: string, sub: string) => {
    const p = Math.min(1, pop(f, at - 4));
    return (
      <div style={{ marginTop: 34, opacity: p, transform: `translateY(${(1 - p) * 30}px)`, borderTop: "1px solid rgba(17,18,20,0.16)", paddingTop: 20 }}>
        <div style={{ fontFamily: mono, fontSize: 16, letterSpacing: "0.12em", color: "rgba(17,18,20,0.55)", textTransform: "uppercase" }}>{title}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 6 }}>
          <Count to={n} at={at} dur={n > 9 ? 30 : 12} style={{ fontSize: 110, fontWeight: 400, letterSpacing: "-0.04em", lineHeight: 1 }} />
          <span style={{ fontFamily: mono, fontSize: 26, color: C.olive }}>NAND</span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 17, color: "rgba(17,18,20,0.6)", marginTop: 6 }}>{sub}</div>
      </div>
    );
  };
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: sans, color: C.ink }}>
      <div style={{ position: "absolute", left: 120, top: 170, width: 480 }}>
        <Label color="rgba(17,18,20,0.55)" dot={C.olive}>Circuit Studio · live compile</Label>
        <div style={{ marginTop: 22, fontSize: 64, fontWeight: 400, letterSpacing: "-0.035em", lineHeight: 1.05 }}>
          <Words text="A neuron, compiled to NAND." at={rel("compiles") - 6} every={4} accent={{ "nand.": C.olive }} />
        </div>
        <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 14, opacity: ramp(f, tOnly - 4, tOnly + 10) }}>
          <TapeOutIcon size={40} />
          <span style={{ fontFamily: mono, fontSize: 18, color: "rgba(17,18,20,0.7)" }}>the only gate TapeOut has</span>
        </div>
        {stat(tAnd, 2, "AND neuron", "y = [x0 + x1 ≥ 2]")}
        {stat(t19, 19, "five-input decision neuron", "y = [x0+x1+x2 − x3 − x4 ≥ 2]")}
      </div>
      <Browser name="studio" url="cerebr.xyz/app#studio" width={1180} left={650} top={190} light hold={hold}
        cams={[{ f: 0 }, { f: 50, rect: R.design, z: 1.55 }, { f: hold + 185, rect: R.design, z: 1.55 }, { f: hold + 225, rect: R.out, z: 1.55 }]} />
    </AbsoluteFill>
  );
};
