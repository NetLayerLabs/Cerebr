// Dev helper: screenshots of each route at 1600x900 (scale 1) for planning the capture.
//   OUT=<dir> node scripts/look.mjs [route ...]
import { launch, sleep } from "./cdp.mjs";
import { join } from "node:path";
const BASE = process.env.BASE || "http://localhost:5210";
const OUT = process.env.OUT;
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ["/", "/app#processor", "/app#studio", "/app#train", "/app#playground/5", "/app#arena", "/app#gallery", "/app#agent"];
const b = await launch({ width: 1600, height: 900 });
for (const r of routes) {
  await b.goto(BASE + r, 9000);
  const name = r.replace(/[^a-z0-9]+/gi, "_") || "root";
  await b.shot(join(OUT, `${name}.png`));
  const h = await b.js("document.documentElement.scrollHeight");
  console.log(r, "height", h);
}
console.log(b.consoleLines.slice(0, 10));
b.close();
