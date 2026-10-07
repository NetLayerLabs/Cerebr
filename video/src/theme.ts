import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";

export const sans = loadGeist("normal", { weights: ["300", "400", "500", "600"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;
export const serif = loadSerif("italic", { weights: ["400"], subsets: ["latin"] }).fontFamily;

/** Cerebr's design system (app/src/styles.css): lime on near-black or paper, olive for lime on light. */
export const C = {
  lime: "#d4ff3f",
  olive: "#4a6400",
  night: "#0a0b0d",
  panel: "#111214",
  panel2: "#15171a",
  paper: "#f5f4ef",
  paper2: "#ecebe4",
  ink: "#111214",
  text: "#ecedee",
  muted: "#9ba1a9",
  faint: "#60656d",
  inkMuted: "#4d525a",
  amber: "#ff9a4a",
  cyan: "#7cc8ff",
  red: "#ff6159",
  good: "#4fd88a",
  lineDark: "rgba(236,237,238,0.10)",
  lineLight: "rgba(17,18,20,0.14)",
};

export type Tone = "dark" | "paper" | "lime";
export const TONE: Record<Tone, { bg: string; ink: string; muted: string; line: string; acc: string; pill: string }> = {
  dark: { bg: C.night, ink: C.text, muted: "rgba(236,237,238,0.55)", line: C.lineDark, acc: C.lime, pill: "rgba(10,11,13,0.62)" },
  paper: { bg: C.paper, ink: C.ink, muted: "rgba(17,18,20,0.55)", line: C.lineLight, acc: C.olive, pill: "rgba(250,249,245,0.82)" },
  lime: { bg: C.lime, ink: C.ink, muted: "rgba(17,18,20,0.6)", line: "rgba(17,18,20,0.18)", acc: C.ink, pill: "rgba(212,255,63,0.85)" },
};

/** Which look each scene uses; the corner chrome and captions follow it. */
export const SCENE_TONE: Record<string, Tone> = {
  open: "dark", gap: "paper", idea: "dark", turn: "lime", compile: "paper", tapeout: "dark",
  compose: "paper", train: "dark", arena: "paper", agent: "dark", market: "paper", unique: "lime", close: "dark",
};

export const SCENE_LABEL: Record<string, string> = {
  open: "01 · 1969", gap: "02 · the gap", idea: "03 · a neuron is logic", turn: "04 · cerebr",
  compile: "05 · compile", tapeout: "06 · tape out", compose: "07 · compose", train: "08 · train",
  arena: "09 · play", agent: "10 · act", market: "11 · own", unique: "12 · why it's different", close: "13 · cerebr.xyz",
};
