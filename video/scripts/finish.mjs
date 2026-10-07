// Final loudness: <in> -> <out>, audio to -14 LUFS integrated with true peak at or below -1 dBTP,
// video stream copied untouched.
//   node scripts/finish.mjs out/cerebr-demo-4k-raw.mp4 out/cerebr-demo-4k.mp4
// A gentle limiter (4x oversampled peak detection via aresample) first trims the few SFX/music
// peaks to about -4 dBFS, so the two-pass loudnorm can stay in linear mode (no pumping).
import { spawnSync, execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const src = join(ROOT, process.argv[2] || "out/cerebr-demo-4k-raw.mp4");
const dst = join(ROOT, process.argv[3] || "out/cerebr-demo-4k.mp4");
const pre = "aresample=192000,alimiter=limit=0.63:attack=3:release=60:level=disabled,aresample=48000,";
const ln = "loudnorm=I=-14:TP=-1.0:LRA=11";
const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", src, "-af", `${pre}${ln}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
const m = JSON.parse(r.stderr.slice(r.stderr.lastIndexOf("{"), r.stderr.lastIndexOf("}") + 1));
const af = `${pre}${ln}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
const r2 = spawnSync("ffmpeg", ["-y", "-hide_banner", "-nostats", "-i", src, "-c:v", "copy", "-af", af, "-ar", "48000", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", dst], { encoding: "utf8" });
const m2 = JSON.parse(r2.stderr.slice(r2.stderr.lastIndexOf("{"), r2.stderr.lastIndexOf("}") + 1));
console.log(`in: ${m.input_i} LUFS, TP ${m.input_tp} -> normalization ${m2.normalization_type}; out ${m2.output_i} LUFS, TP ${m2.output_tp} -> ${dst}`);
execFileSync("true");
