// Sound effects via ElevenLabs /v1/sound-generation (minimum 0.5 s). Skips files that already exist.
//   node scripts/sfx.mjs                     all missing
//   ONLY=relay,zap node scripts/sfx.mjs      force regenerate some
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, post, retry } from "./env.mjs";

const SFX = {
  teletype: ["Old 1960s mainframe computer teletype printing a short burst of characters, mechanical, dry, close, no music", 1.6],
  tick: ["Single crisp clock tick, close, dry, short", 0.5],
  relay: ["Single tiny electromechanical relay click, crisp, dry, like a logic gate switching, short", 0.5],
  zap: ["Short clean electric signal travelling along a wire, a soft rising zap that fades, modern, no music", 1.0],
  fail: ["Short soft muted digital error tone, two low descending notes, clean, not harsh", 0.8],
  blip: ["Single soft digital data blip, clean sine tone, short", 0.5],
  click: ["Soft modern UI click, single, clean, short", 0.5],
  pop: ["Soft bubbly UI pop, single, clean, short", 0.5],
  whoosh: ["Soft fast airy whoosh, smooth cinematic transition, no music", 1.0],
  swoosh_up: ["Quick rising digital swoosh, bright and clean, UI transition, no music", 0.9],
  riser: ["Tension riser, rising airy synth swell building to a peak, cinematic, no drums", 3.5],
  impact: ["Deep clean cinematic impact with a warm sub tail, modern, single hit", 2],
  powerup: ["Short clean electronic chip power-up, a soft rising hum with a bright click at the end, modern, no music", 1.4],
  stamp: ["Firm soft rubber stamp hit on paper, single, close, dry", 0.6],
  place: ["Single soft game piece placed on a board, light wooden tap, close, dry", 0.5],
  chime: ["Bright clean confirmation chime, two soft ascending notes, modern, short tail", 1.5],
};

const dir = join(ROOT, "public/audio/sfx");
mkdirSync(dir, { recursive: true });
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;

for (const [name, [text, dur]] of Object.entries(SFX)) {
  const f = join(dir, `${name}.mp3`);
  if (only ? !only.includes(name) : existsSync(f)) { console.log(`${name}: skip`); continue; }
  try {
    const buf = await retry(async () => {
      const res = await post("/sound-generation?output_format=mp3_44100_128", { text, duration_seconds: dur, prompt_influence: 0.5 });
      return Buffer.from(await res.arrayBuffer());
    });
    writeFileSync(f, buf);
    console.log(`${name}: ${(buf.length / 1024).toFixed(0)}kb`);
  } catch (e) { console.error(`${name}: FAILED ${e.message}`); }
}
