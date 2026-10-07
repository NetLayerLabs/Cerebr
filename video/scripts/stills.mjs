// Check stills at half scale, then contact sheets with ffmpeg xstack.
//   node scripts/stills.mjs                  4 frames per scene (at key fractions), all scenes
//   node scripts/stills.mjs open,turn        only those scenes
//   FRAMES=140,420 node scripts/stills.mjs   explicit absolute frames (no sheets)
// -> out/stills/<scene>_f<frame>.png, out/stills/sheet_<scene>.png (2x2), out/stills/sheet_all_<n>.png
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "out/stills");
mkdirSync(OUT, { recursive: true });
const T = JSON.parse(readFileSync(join(ROOT, "src/timing.json"), "utf8"));
const only = process.argv[2]?.split(",");
const FR = [0.14, 0.4, 0.66, 0.93];
const jobs = [];
if (process.env.FRAMES) for (const f of process.env.FRAMES.split(",").map(Number)) jobs.push({ scene: T.scenes.find((s) => f >= s.from && f < s.from + s.durationInFrames)?.id ?? "x", frame: f });
else for (const s of T.scenes) if (!only || only.includes(s.id)) for (const k of FR) jobs.push({ scene: s.id, frame: s.from + Math.round(s.durationInFrames * k) });

const serveUrl = await bundle({ entryPoint: join(ROOT, "src/index.ts"), publicDir: join(ROOT, "public") });
const composition = await selectComposition({ serveUrl, id: "Cerebr" });
for (const j of jobs) {
  j.file = join(OUT, `${j.scene}_f${j.frame}.png`);
  await renderStill({ composition, serveUrl, frame: j.frame, output: j.file, scale: 0.5 });
  console.log(j.file);
}
if (!process.env.FRAMES) {
  const scenes = [...new Set(jobs.map((j) => j.scene))];
  const sheets = [];
  for (const id of scenes) {
    const fs = jobs.filter((j) => j.scene === id).map((j) => j.file);
    const out = join(OUT, `sheet_${id}.png`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...fs.flatMap((f) => ["-i", f]), "-filter_complex", "xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0:fill=white", out]);
    sheets.push(out);
  }
  // overview: one row per scene, 4 frames wide, scaled to 480 px each
  for (let i = 0; i < scenes.length; i += 5) {
    const ids = scenes.slice(i, i + 5);
    const files = ids.flatMap((id) => jobs.filter((j) => j.scene === id).map((j) => j.file));
    const n = files.length;
    const layout = files.map((_, k) => `${(k % 4) * 480}_${Math.floor(k / 4) * 270}`).join("|");
    const out = join(OUT, `sheet_all_${i / 5 + 1}.png`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...files.flatMap((f) => ["-i", f]), "-filter_complex", files.map((_, k) => `[${k}:v]scale=480:270[s${k}]`).join(";") + ";" + files.map((_, k) => `[s${k}]`).join("") + `xstack=inputs=${n}:layout=${layout}`, out]);
    console.log(out);
  }
}
