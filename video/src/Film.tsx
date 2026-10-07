import React from "react";
import { AbsoluteFill, Audio, Freeze, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { K, T, scene, wordAt, lineStart } from "./timing";
import { C } from "./theme";
import { Chrome } from "./ui/Chrome";
import { Captions } from "./ui/Captions";
import { Grain } from "./ui/Grain";
import { clamp } from "./ui/motion";
import { markOf } from "./ui/Footage";
import { Open } from "./scenes/Open";
import { Gap } from "./scenes/Gap";
import { Idea } from "./scenes/Idea";
import { Turn } from "./scenes/Turn";
import { Compile } from "./scenes/Compile";
import { Tapeout } from "./scenes/Tapeout";
import { Compose } from "./scenes/Compose";
import { Train } from "./scenes/Train";
import { Arena } from "./scenes/Arena";
import { Agent } from "./scenes/Agent";
import { Market } from "./scenes/Market";
import { Unique } from "./scenes/Unique";
import { Close } from "./scenes/Close";

const SCENES: Record<string, React.FC> = {
  open: Open, gap: Gap, idea: Idea, turn: Turn, compile: Compile, tapeout: Tapeout, compose: Compose,
  train: Train, arena: Arena, agent: Agent, market: Market, unique: Unique, close: Close,
};
const OVERLAP = 10 * K; // frames each scene starts early, to cross-dissolve with the last (10 units = 1/3 s)

/** Each scene eases in (a short rise and un-blur) over the tail of the previous one, holding its first frame. */
const SceneIn: React.FC<{ S: React.FC; first: boolean }> = ({ S, first }) => {
  const f = useCurrentFrame();
  if (first) return <S />;
  const p = interpolate(f, [0, OVERLAP], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const body = f < OVERLAP ? <Freeze frame={0}><S /></Freeze> : <Sequence from={OVERLAP} layout="none"><S /></Sequence>;
  return <AbsoluteFill style={{ opacity: p, transform: `scale(${1.03 - 0.03 * p})`, filter: p < 1 ? `blur(${(1 - p) * 10}px)` : undefined }}>{body}</AbsoluteFill>;
};

// --- Music: ducked under every spoken line.
const LINES = T.scenes.flatMap((s) => s.lines.map((l) => [l.startFrame, l.words[l.words.length - 1].end] as const));
const DUCK: number[] = (() => {
  const v = new Array<number>(T.totalFrames + 1).fill(0);
  for (let f = 0; f <= T.totalFrames; f++) {
    let d = 0;
    for (const [a, b] of LINES) d = Math.max(d, interpolate(f, [a - 10 * K, a, b, b + 14 * K], [0, 1, 1, 0], clamp));
    v[f] = d;
  }
  return v;
})();
const musicVolume = (f: number) => {
  const end = T.totalFrames;
  const fadeIn = interpolate(f, [0, 24 * K], [0, 1], clamp);
  const fadeOut = interpolate(f, [end - 60 * K, end], [1, 0], clamp);
  return (0.55 - 0.36 * DUCK[Math.min(end, Math.max(0, f))]) * fadeIn * fadeOut;
};

interface Fx { file: string; at: number; vol: number; dur?: number }
// Cues are written in 30 fps units, like the scenes, and converted to composition frames at the end.
function effects(): Fx[] {
  const sc = (id: string) => scene(id).from / K;
  const w = (id: string, word: string, n = 0) => wordAt(id, word, n) / K;
  // footage events: scene start + hold + (clip mark - startFrom)
  const fm = (id: string, clip: string, m: string, startFrom: number, hold = 0) => sc(id) + hold + markOf(clip, m) - startFrom;
  const fx: Fx[] = [
    // open: 1969
    { file: "teletype", at: w("open", "Nineteen") - 4, vol: 0.3 },
    { file: "tick", at: 4, vol: 0.3 }, { file: "tick", at: 34, vol: 0.3 },
    { file: "blip", at: w("open", "single") + 26, vol: 0.3 },
    { file: "fail", at: w("open", "XOR.") + 8, vol: 0.4 },
    { file: "zap", at: w("open", "second") - 2, vol: 0.4 },
    // gap
    { file: "whoosh", at: sc("gap") - 6, vol: 0.25 },
    ...["game,", "agent", "DAO"].map((x) => ({ file: "pop", at: w("gap", x) - 4, vol: 0.9 })),
    { file: "fail", at: w("gap", "can't"), vol: 0.25 },
    { file: "whoosh", at: w("gap", "Models") - 8, vol: 0.2 },
    // idea
    { file: "whoosh", at: sc("idea") - 6, vol: 0.25 },
    ...["enough", "inputs", "fire,"].map((x) => ({ file: "relay", at: w("idea", x), vol: 0.35 })),
    { file: "zap", at: w("idea", "fires.") - 2, vol: 0.35 },
    ...[0, 1, 2, 3, 4].map((i) => ({ file: "relay", at: w("idea", "gates.") - 4 + i * 9, vol: 0.28 })),
    // turn
    { file: "riser", at: sc("turn") - 96, vol: 0.4 },
    { file: "impact", at: w("turn", "Cerebr.") - 3, vol: 0.42 },
    { file: "powerup", at: w("turn", "Cerebr.") + 4, vol: 0.2 },
    // compile (footage clicks)
    { file: "whoosh", at: sc("compile") - 6, vol: 0.25 },
    { file: "click", at: fm("compile", "studio", "five", 0, 100), vol: 0.5 },
    { file: "click", at: fm("compile", "studio", "goNoGo", 0, 100) - 40, vol: 0.45 },
    { file: "click", at: fm("compile", "studio", "goNoGo", 0, 100), vol: 0.45 },
    { file: "pop", at: w("compile", "two"), vol: 0.9 },
    { file: "pop", at: w("compile", "nineteen."), vol: 0.9 },
    // tapeout
    { file: "swoosh_up", at: sc("tapeout") - 6, vol: 0.3 },
    { file: "powerup", at: w("tapeout", "Sixteen") - 8, vol: 0.35 },
    { file: "zap", at: w("tapeout", "gate", 1) - 4, vol: 0.3 },
    { file: "stamp", at: w("tapeout", "claim") + 2, vol: 1.0 },
    // compose
    { file: "whoosh", at: sc("compose") - 6, vol: 0.25 },
    { file: "click", at: fm("compose", "compose", "ref", 0, 12), vol: 0.45 },
    { file: "zap", at: w("compose", "joined") - 2, vol: 0.35 },
    { file: "impact", at: w("compose", "zero") - 2, vol: 0.25 },
    // train
    { file: "whoosh", at: sc("train") - 6, vol: 0.25 },
    { file: "click", at: fm("train", "train", "trained", 20), vol: 0.5 },
    { file: "fail", at: w("train", "can't"), vol: 0.22 },
    { file: "zap", at: w("train", "adds") - 2, vol: 0.3 },
    { file: "chime", at: w("train", "Then") + 2, vol: 0.35 },
    // arena
    { file: "swoosh_up", at: sc("arena") - 6, vol: 0.3 },
    { file: "click", at: fm("arena", "arena", "preview", 60), vol: 0.45 },
    { file: "place", at: fm("arena", "arena", "cell", 60), vol: 0.3 },
    { file: "place", at: fm("arena", "arena", "answer2", 60) - 10, vol: 0.3 },
    { file: "stamp", at: w("arena", "Humans") + 4, vol: 1.0 },
    // agent
    { file: "whoosh", at: sc("agent") - 6, vol: 0.25 },
    { file: "tick", at: w("agent", "ten"), vol: 0.35 }, { file: "tick", at: w("agent", "ten") + 15, vol: 0.3 },
    { file: "zap", at: w("agent", "asks") - 4, vol: 0.3 },
    { file: "click", at: fm("agent", "agent", "replay", 0, 60), vol: 0.5 },
    { file: "chime", at: fm("agent", "agent", "verified", 0, 60), vol: 0.35 },
    // market
    { file: "whoosh", at: sc("market") - 6, vol: 0.25 },
    ...["NFT", "brain", "listed"].map((x) => ({ file: "pop", at: w("market", x) - 4, vol: 0.8 })),
    // unique
    { file: "swoosh_up", at: sc("unique") - 6, vol: 0.3 },
    { file: "impact", at: w("unique", "It's") - 2, vol: 0.15 },
    { file: "impact", at: w("unique", "It's", 1) - 2, vol: 0.15 },
    { file: "impact", at: w("unique", "And") - 2, vol: 0.15 },
    // close
    { file: "whoosh", at: sc("close") - 6, vol: 0.25 },
    { file: "zap", at: sc("close") + 2, vol: 0.3 },
    { file: "chime", at: w("close", "Cerebr.") + 6, vol: 0.4 },
  ];
  return fx.map((x) => ({ ...x, at: Math.round(x.at * K) })).filter((x) => x.at >= 0 && x.at < T.totalFrames);
}

export const Film: React.FC = () => {
  // Captions sit out where the picture already carries the words in big type.
  const hideCaptions = (f: number) => {
    const s = T.scenes.find((x) => f >= x.from && f < x.from + x.durationInFrames);
    return !s || ["gap", "idea", "turn", "unique", "close"].includes(s.id) || f < lineStart("open", 0) - 4 * K;
  };
  return (
    <AbsoluteFill style={{ background: C.night }}>
      {T.scenes.map((s, i) => {
        const S = SCENES[s.id];
        const from = i === 0 ? s.from : s.from - OVERLAP;
        const dur = s.durationInFrames + (i === 0 ? 0 : OVERLAP);
        return S ? (
          <Sequence key={s.id} from={from} durationInFrames={dur} name={s.id}>
            <SceneIn S={S} first={i === 0} />
          </Sequence>
        ) : null;
      })}
      <Grain opacity={0.06} />
      <Chrome hideAfter={scene("close").from + 30 * K} />
      <Captions hidden={hideCaptions} />
      <Audio src={staticFile("audio/music.mp3")} volume={musicVolume} />
      {T.scenes.flatMap((s) => s.lines).map((l, i) => (
        <Sequence key={`vo${i}`} from={l.startFrame} durationInFrames={l.durationFrames} name={`vo ${l.text.slice(0, 18)}`}>
          <Audio src={staticFile(l.file)} volume={1} />
        </Sequence>
      ))}
      {effects().map((x, i) => (
        <Sequence key={`fx${i}`} from={x.at} durationInFrames={Math.round((x.dur ?? 150) * K)} name={`fx ${x.file}`}>
          <Audio src={staticFile(`audio/sfx/${x.file}.mp3`)} volume={(f) => x.vol * (x.dur ? interpolate(f, [0, 8, x.dur - 20, x.dur], [0, 1, 1, 0], clamp) : 1)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
