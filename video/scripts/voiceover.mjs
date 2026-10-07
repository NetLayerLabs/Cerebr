// Voice-over for every line in script.json, via ElevenLabs /with-timestamps.
//   node scripts/voiceover.mjs                  generate changed/missing lines (hash cache)
//   ONLY=turn_0,close_0 node scripts/voiceover.mjs   force one or more ids (comma list)
// Outputs:
//   public/audio/vo/<sceneId>_<i>.mp3        (what the film plays; loudness-normalised to -16 LUFS)
//   .cache/raw/<sceneId>_<i>.mp3             (untouched take)
//   .cache/words/<sceneId>_<i>.json          (word timings in seconds, from char alignment)
//   .cache/vo.json                           (hash per line + chars consumed log)
//
// SAY respells a few words for the voice only, one word for one word, so the timings map back
// onto the script's own spelling (captions and wordAt() always see the written words).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ROOT, post, retry } from "./env.mjs";
import { renderVo } from "./vofx.mjs";

const script = JSON.parse(readFileSync(join(ROOT, "script.json"), "utf8"));
const OUT = join(ROOT, "public/audio/vo");
const RAW = join(ROOT, ".cache/raw");
const WORDS = join(ROOT, ".cache/words");
const CACHE = join(ROOT, ".cache/vo.json");
for (const d of [OUT, RAW, WORDS]) mkdirSync(d, { recursive: true });
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : { lines: {}, charsUsed: 0 };

// Spoken respellings (whole words, punctuation kept). Each maps one written word to one spoken word.
const SAY = [
  [/^Cerebr(\W*)$/, "Sereber$1"],
  [/^cerebr(\W*)$/, "sereber$1"],
  [/^CerebrAgent's$/, "Sereber-Agent's"],
  [/^XOR(\W*)$/, "ex-or$1"],
  [/^NAND(\W*)$/, "nand$1"],
  [/^REF(\W*)$/, "ref$1"],
  [/^NFT(\W*)$/, "N-F-T$1"],
  [/^eval(\W*)$/, "ee-val$1"],
];
const spoken = (text) => text.split(" ").map((w) => SAY.reduce((s, [re, to]) => (re.test(s) ? s.replace(re, to) : s), w)).join(" ");

// Per-line performance direction (merged over the voice settings).
const OVERRIDES = {
  // The history line: unhurried, a storyteller's weight on the date.
  open_0: { stability: 0.5, style: 0.3, speed: 0.93 },
  gap_0: { speed: 0.97 },
  gap_1: { speed: 0.97 },
  // The idea: deliberate, each short sentence its own step.
  idea_0: { stability: 0.5, style: 0.28, speed: 0.92 },
  // The turn: slow and warm.
  turn_0: { stability: 0.55, style: 0.32, speed: 0.88 },
  unique_0: { style: 0.3, speed: 0.95 },
  // The close: settled.
  close_0: { stability: 0.6, style: 0.3, speed: 0.86 },
};

const only = process.env.ONLY ? process.env.ONLY.split(",") : null;

export const durationOf = (f) =>
  parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).toString());

function toWords(a) {
  const words = [];
  let cur = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { if (cur) { words.push(cur); cur = null; } return; }
    if (!cur) cur = { word: "", start: a.character_start_times_seconds[i], end: 0 };
    cur.word += ch;
    cur.end = a.character_end_times_seconds[i];
  });
  if (cur) words.push(cur);
  return words;
}

async function synth(text, voiceId, settings) {
  return retry(async () => {
    const res = await post(`/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      text, model_id: script.model, voice_settings: settings,
    });
    const body = await res.json();
    return { audio: Buffer.from(body.audio_base64, "base64"), words: toWords(body.alignment) };
  });
}

// Speech rate sanity: normal read is ~11-18 chars/sec of speech.
const sane = (text, words) => {
  const speech = words.at(-1).end - words[0].start;
  const cps = text.length / speech;
  return { ok: cps >= 8 && cps <= 21, cps };
};

let used = 0;
for (const scene of script.scenes) {
  for (const [i, line] of scene.lines.entries()) {
    const id = `${scene.id}_${i}`;
    const voice = script.voices[line.voice];
    if (!voice.id) throw new Error(`voice ${line.voice} has no id in script.json`);
    const settings = { ...voice.settings, ...(OVERRIDES[id] || {}) };
    const say = spoken(line.text);
    const hash = createHash("sha1").update(JSON.stringify([say, voice.id, settings, script.model])).digest("hex");
    const have = existsSync(join(OUT, `${id}.mp3`)) && existsSync(join(WORDS, `${id}.json`));
    if (have && cache.lines[id]?.hash === hash && !(only && only.includes(id))) { console.log(`${id}: cached`); continue; }
    if (only && !only.includes(id) && have) continue;

    let take = await synth(say, voice.id, settings);
    used += say.length;
    let chk = sane(say, take.words);
    if (!chk.ok) {
      console.log(`${id}: ${chk.cps.toFixed(1)} cps looks off, retaking once`);
      const again = await synth(say, voice.id, settings);
      used += say.length;
      const chk2 = sane(say, again.words);
      if (Math.abs(chk2.cps - 14) < Math.abs(chk.cps - 14)) { take = again; chk = chk2; }
    }
    // Map timings back onto the written words.
    const written = line.text.split(" ");
    if (written.length !== take.words.length) throw new Error(`${id}: ${take.words.length} spoken words vs ${written.length} written`);
    const words = take.words.map((w, k) => ({ ...w, word: written[k] }));
    writeFileSync(join(RAW, `${id}.mp3`), take.audio);
    renderVo(id, 1);
    writeFileSync(join(WORDS, `${id}.json`), JSON.stringify({ tempo: 1, said: say, words }, null, 1));
    const dur = durationOf(join(OUT, `${id}.mp3`));
    cache.lines[id] = { hash, voice: voice.id, chars: say.length, dur };
    console.log(`${id}: ${dur.toFixed(2)}s  ${chk.cps.toFixed(1)} cps  [${line.voice}/${voice.id}]`);
  }
}
cache.charsUsed = (cache.charsUsed || 0) + used;
writeFileSync(CACHE, JSON.stringify(cache, null, 1));
console.log(`chars this run: ${used}, total logged: ${cache.charsUsed}`);
