import React from "react";
import { K } from "../timing";
import { AbsoluteFill, Sequence } from "remotion";
import { C, mono, sans } from "../theme";
import { pop, ramp } from "../ui/motion";
import { Browser } from "../ui/Footage";
import { TapeOutIcon } from "../ui/Logos";
import { Words } from "../ui/Words";
import { Label, useCue } from "./common";

/** Gallery: every circuit is an ERC-721 with a native brain wallet and a market row. */
export const Market: React.FC = () => {
  const { f, rel } = useCue("market");
  const tNft = rel("NFT");
  const tBrain = rel("brain");
  const tListed = rel("listed");
  const W = { left: 640, top: 196, width: 1160 };
  const cut = 110;
  const chip = (at: number, children: React.ReactNode) => {
    const p = Math.min(1, pop(f, at - 4));
    return <div style={{ opacity: p, transform: `translateX(${(1 - p) * -24}px)`, marginTop: 18, padding: "16px 20px", background: "#fdfdfa", border: "1px solid rgba(17,18,20,0.14)", display: "flex", alignItems: "center", gap: 14 }}>{children}</div>;
  };
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: sans, color: C.ink }}>
      <div style={{ position: "absolute", left: 120, top: 170, width: 470 }}>
        <Label color="rgba(17,18,20,0.55)" dot={C.olive}>Gallery · 16 circuits</Label>
        <div style={{ marginTop: 22, fontSize: 60, fontWeight: 400, letterSpacing: "-0.035em", lineHeight: 1.05 }}>
          <Words text="Every circuit is an NFT." at={rel("Every") - 2} every={4} accent={{ "nft.": C.olive }} />
        </div>
        <div style={{ height: 16 }} />
        {chip(tNft, <><span style={{ fontFamily: mono, fontSize: 15, color: C.olive }}>ERC-721</span><span style={{ fontSize: 22 }}>a die shot drawn from its gates</span></>)}
        {chip(tBrain, <><span style={{ fontFamily: mono, fontSize: 15, color: C.olive }}>ERC-6551</span><span style={{ fontSize: 22 }}>its own brain wallet</span></>)}
        {chip(tListed, <><TapeOutIcon size={34} /><span style={{ fontSize: 22 }}>list it on TapeOut's market</span></>)}
      </div>
      <div style={{ opacity: 1 - ramp(f, cut - 6, cut + 6) }}>
        <Browser name="gallery" url="cerebr.xyz/app#gallery" {...W} light startFrom={60} cams={[{ f: 0, z: 1.05 }]} />
      </div>
      <Sequence from={Math.round((cut - 6) * K)} layout="none">
        <div style={{ opacity: ramp(f, cut - 6, cut + 6) }}>
          <Browser name="market" url="cerebr.xyz/app#gallery" {...W} light startFrom={20} stopAt={140}
            cams={[{ f: 0, rect: { x: 76, y: 150, w: 580, h: 560 }, z: 1.5 }, { f: 50, rect: { x: 76, y: 380, w: 580, h: 320 }, z: 2 }]} />
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
