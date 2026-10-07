// Records the real Cerebr app for the demo film, against X Layer mainnet (live reads only).
//   node scripts/capture.mjs                  (needs the app served at BASE, default the HEAD build on :5210)
//   ONLY=studio,train node scripts/capture.mjs   re-records just those clips (marks/meta are merged)
// No wallet is connected and nothing is ever sent: every action below is a read, a local
// simulation or a free eth_call (Inference eval, Arena "Preview the reply", Agent "Replay all").
// Output: .cache/frames/<clip>/ (JPEG screencast + frames.json), .cache/marks.json (event times),
// .cache/meta.json (per clip: url, element rects in CSS px, notes, live readings) and stills in
// public/stills/. scripts/encode.mjs turns the frames into public/footage/<clip>.mp4 (30 fps).
//
// The window is 1600x900 CSS px at device scale 2, so frames are 3200x1800 and a rect {x,y,w,h}
// in CSS px maps to video pixels by multiplying by 2.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./cdp.mjs";

const BASE = process.env.BASE || "http://localhost:5210";
const ROOT = resolve(new URL("..", import.meta.url).pathname);
const FRAMES = join(ROOT, ".cache/frames");
const STILLS = join(ROOT, "public/stills");
const SCALE = 2;
const VIEW = { w: 1600, h: 900 };
const ONLY = process.env.ONLY?.split(",");
const want = (clip) => !ONLY || ONLY.includes(clip);
mkdirSync(FRAMES, { recursive: true });
mkdirSync(STILLS, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`+${((Date.now() - t0) / 1000).toFixed(0)}s`, ...a);
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {});
const marks = readJson(join(ROOT, ".cache/marks.json"));
const meta = readJson(join(ROOT, ".cache/meta.json"));
const mark = (k) => { marks[k] = Date.now() / 1000; log("mark", k); };

// A visible pointer for the film (headless Chrome draws none), a click ring and an eased scroll helper.
const OVERLAY = `(() => {
  window.__ease = (el, prop, to, ms) => new Promise((done) => {
    const from = el[prop]; const start = performance.now();
    const f = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => { const p = Math.min(1, (now - start) / ms); el[prop] = from + (to - from) * f(p); if (p < 1) requestAnimationFrame(step); else done(el[prop]); };
    requestAnimationFrame(step);
  });
  const add = () => {
    if (document.getElementById('__cur')) return;
    const s = document.createElement('style'); s.id = '__curcss';
    s.textContent = 'html{scroll-behavior:auto!important}#__cur{position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(245,244,239,.97);box-shadow:0 0 0 2px rgba(10,11,13,.7),0 4px 14px rgba(0,0,0,.45);z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .3s ease,transform .12s ease-out,left .8s cubic-bezier(.22,1,.36,1),top .8s cubic-bezier(.22,1,.36,1)}#__cur.down{transform:scale(.7)}.__ring{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:2px solid rgba(212,255,63,.85);z-index:2147483646;pointer-events:none;animation:__r .6s ease-out forwards}@keyframes __r{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}';
    document.head.appendChild(s);
    const c = document.createElement('div'); c.id = '__cur'; document.body.appendChild(c);
  };
  window.__overlay = add;
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
})()`;

const b = await launch({ width: VIEW.w, height: VIEW.h + 87, extraArgs: [`--force-device-scale-factor=${SCALE}`] });
const hardStop = setTimeout(() => { log("HARD TIMEOUT"); b.close(); process.exit(2); }, 1_500_000);
const js = (e) => b.js(e);

// --- helpers ------------------------------------------------------------------------
const rectOf = async (finder) => {
  const r = await b.rectOf(finder);
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
};
const centerOf = (finder) => js(`(() => { const e = ${finder}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
/** The first element matching `sel` whose trimmed text starts with `text`. */
const byText = (sel, text, root = "document") => `[...${root}.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
/** A card (section or div.card) by its h2 heading text. */
const card = (h2) => `[...document.querySelectorAll('.card')].find((c) => c.querySelector('.card-head h2')?.textContent.trim().toLowerCase().startsWith(${JSON.stringify(h2.toLowerCase())}))`;
const text = () => js(`document.body.innerText`);

async function overlay() { await js(`window.__overlay && window.__overlay()`); }
async function cursorAt(x, y) {
  await js(`(() => { const k = document.getElementById('__cur'); if (!k) return; const t = k.style.transition; k.style.transition = 'opacity .3s ease'; k.style.left = '${x}px'; k.style.top = '${y}px'; k.offsetWidth; k.style.transition = t; k.style.opacity = '1'; })()`);
}
async function cursorHide() { await js(`(() => { const k = document.getElementById('__cur'); if (k) k.style.opacity = '0'; })()`); }
async function glide(x, y, settle = 900) {
  await js(`(() => { const k = document.getElementById('__cur'); if (k) { k.style.opacity = '1'; k.style.left = '${x}px'; k.style.top = '${y}px'; } })()`);
  await sleep(820);
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(Math.max(0, settle - 820));
}
async function clickAt(x, y) {
  await js(`(() => { const k = document.getElementById('__cur'); k?.classList.add('down'); const r = document.createElement('div'); r.className = '__ring'; r.style.left = '${x}px'; r.style.top = '${y}px'; document.body.appendChild(r); setTimeout(() => { k?.classList.remove('down'); r.remove(); }, 650); })()`);
  await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(90);
  await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}
/** Glide to an element and click it with the real mouse. Returns the point. */
async function press(finder, { settle = 950, dx = 0, dy = 0 } = {}) {
  const at = await centerOf(finder);
  if (!at) throw new Error("press: not found: " + finder.slice(0, 120));
  if (at.y < 0 || at.y > VIEW.h) throw new Error("press: off screen: " + JSON.stringify(at) + " " + finder.slice(0, 80));
  await glide(at.x + dx, at.y + dy, settle);
  await clickAt(at.x + dx, at.y + dy);
  return at;
}
const parkMouse = () => b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: VIEW.w - 6, y: VIEW.h - 4 });
const ease = (finder, to, ms, prop = "scrollTop") => js(`window.__ease(${finder ?? "document.scrollingElement"}, '${prop}', ${to}, ${ms})`);
/** Document y (CSS px) of an element's top. */
const docY = (finder) => js(`(() => { const e = ${finder}; return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; })()`);
async function waitFor(desc, expr, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await js(`!!(${expr})`)) return; } catch {}
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${desc}`);
}
async function open(path, ready, desc) {
  await b.goto(BASE + path, 2500);
  await overlay();
  await parkMouse();
  if (ready) await waitFor(desc ?? path, ready, 90_000);
  await overlay();
}
/** Same-document hash navigation (keeps the app's loaded state, like a real tab click). */
async function hashTo(hash, ready, desc) {
  await js(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(600);
  if (ready) await waitFor(desc ?? hash, ready, 90_000);
  await js(`scrollTo(0, 0)`);
}

// --- recording ----------------------------------------------------------------------
let stopRec = null;
async function rec(name) {
  const dir = join(FRAMES, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  stopRec = await b.screencast(dir);
  mark(`${name}:start`);
}
async function endRec(name) {
  if (!stopRec) return;
  mark(`${name}:end`);
  const frames = await stopRec();
  stopRec = null;
  const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
  log(`${name}: ${frames.length} frames over ${span.toFixed(1)}s (${(frames.length / Math.max(span, 0.001)).toFixed(1)} fps)`);
}
function setMeta(clip, data) {
  meta[clip] = { url: BASE + data.url, build: BUILD, capturedAt: new Date().toISOString(), deviceScale: SCALE, viewport: VIEW, ...data, url: data.url };
}
const save = () => {
  writeFileSync(join(ROOT, ".cache/marks.json"), JSON.stringify(marks, null, 1));
  writeFileSync(join(ROOT, ".cache/meta.json"), JSON.stringify(meta, null, 1));
};
const shot = (name, finder) => b.shot(join(STILLS, `${name}.png`), finder);

// --- stepped recording (deterministic 60 fps) ---------------------------------------
// Chrome's screencast only sends frames when it can, so long scrolls arrive at ~40 fps with gaps.
// For scroll and pointer moves we instead pose the page for every 1/60 s step (scrollTop, pointer
// position, both eased) and take a screenshot, so motion is perfectly even. Static holds reuse the
// last screenshot. Timestamps are synthetic (i / 60) and marks are placed on the same clock.
const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
async function stepped(name, build) {
  const dir = join(FRAMES, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const base = Date.now() / 1000;
  const frames = [];
  let n = 0, lastFile = null, shots = 0;
  const snap = async () => {
    const r = await b.send("Page.captureScreenshot", { format: "jpeg", quality: 100 });
    lastFile = join(dir, `s${String(shots++).padStart(5, "0")}.jpg`);
    writeFileSync(lastFile, Buffer.from(r.result.data, "base64"));
  };
  const push = () => frames.push({ file: lastFile, t: base + n++ / 60 });
  await js(`(() => { const k = document.getElementById('__cur'); if (k) k.style.transition = 'opacity .3s ease'; })()`);
  await snap();
  const api = {
    /** Hold the current picture for `sec` seconds. */
    hold: (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) push(); },
    /** Animate over `sec` seconds: pose(p) is called with p in (0, 1], then a screenshot per step. */
    anim: async (sec, pose) => {
      const steps = Math.round(sec * 60);
      for (let i = 1; i <= steps; i++) { await pose(i / steps); await js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`); await snap(); push(); }
    },
    /** Something that changes the page (a click): run it, let it settle, take a fresh shot. */
    act: async (fn, settleMs = 400) => { await fn(); await sleep(settleMs); await snap(); push(); },
    mark: (k) => { marks[k] = base + n / 60; log("mark", k, `(frame ${n})`); },
  };
  marks[`${name}:start`] = base;
  await build(api);
  marks[`${name}:end`] = base + n / 60;
  writeFileSync(join(dir, "frames.json"), JSON.stringify(frames));
  log(`${name}: stepped ${frames.length} frames (${shots} screenshots) = ${(frames.length / 60).toFixed(1)}s`);
}
const setScroll = (y) => js(`document.scrollingElement.scrollTop = ${y}`);
const setCursor = (x, y, show = true) => js(`(() => { const k = document.getElementById('__cur'); if (!k) return; k.style.left = '${x}px'; k.style.top = '${y}px'; k.style.opacity = '${show ? 1 : 0}'; })()`);
/** Pointer glide pose (eased like the screencast pointer): from a to b. */
const glidePose = (a, bb) => async (p) => { const e = easeOut(p); await setCursor(Math.round(a.x + (bb.x - a.x) * e), Math.round(a.y + (bb.y - a.y) * e)); };
/** A real click at (x, y) with the press ring, between steps. */
async function stepClick(x, y) {
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await js(`(() => { const k = document.getElementById('__cur'); k?.classList.add('down'); setTimeout(() => k?.classList.remove('down'), 160); })()`);
  await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

let BUILD = process.env.BUILD || "unknown";

try {
  await b.send("Emulation.clearDeviceMetricsOverride");
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: OVERLAY });
  await b.goto("about:blank", 300);
  const vp = await js(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })`);
  if (vp.w !== VIEW.w || vp.h !== VIEW.h || vp.dpr !== SCALE) throw new Error("unexpected viewport " + JSON.stringify(vp));

  // ===== landing: the hero (die-shot schematic, lit pins, live spec row) ===============
  if (want("landing")) {
    await b.goto(BASE + "/", 200);
    await overlay();
    await parkMouse();
    // Record from first paint so the entrance and the pins lighting up are in the clip.
    await rec("landing");
    await waitFor("hero spec row", `/\\d+ taped out/.test(document.body.innerText) && /human wins/.test(document.body.innerText) && /min ago|just now/.test(document.body.innerText)`, 60_000);
    mark("landingLive");
    await sleep(6500);
    await shot("landing");
    // A calm, eased scroll into the live spec row and the start of the Electrical characteristics
    // table (values read from chain); the scroll-driven reveals play as they enter, then a hold.
    const ecY = await docY(`${byText("h2, h3, div, span", "ELECTRICAL CHARACTERISTICS")} ?? [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^electrical characteristics$/i.test(e.textContent.trim()))`);
    const to = Math.max(380, (ecY ?? 900) - 330);
    log("landing scroll to", to, "section at", ecY);
    mark("scroll");
    await ease(null, to, 4200);
    mark("scrolled");
    await sleep(1800); // reveal animations
    await waitFor("revealed", `![...document.querySelectorAll('.ds-sec')].some((e) => { const r = e.getBoundingClientRect(); return r.top < innerHeight - 40 && r.bottom > 0 && !e.classList.contains('in'); })`, 8000).catch(() => log("reveal check timed out"));
    mark("revealed");
    await sleep(3200);
    await endRec("landing");
    await shot("landing-ec");
    await js(`scrollTo(0, 0)`); await sleep(600);
    const live = await js(`(() => { const t = document.body.innerText; return { circuits: t.match(/(\\d+) taped out/)?.[1], agent: t.match(/(Go|No-Go|Abstain) · ([^\\n]+)/)?.[0], arena: t.match(/(\\d+) human wins/)?.[1], claimsLeft: t.match(/(\\d+) claims left/)?.[1] }; })()`);
    const rects = {
      hero: await rectOf(`document.querySelector('h1')?.closest('section') ?? document.querySelector('h1')`),
      chip: await rectOf(`[...document.querySelectorAll('svg')].sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0]`),
      spec: await rectOf(`${byText("*", "CIRCUITS")}?.parentElement?.parentElement`),
      drop: await rectOf(`${byText("a, div", "GENESIS DROP")}`),
    };
    setMeta("landing", { url: "/", live, rects, notes: "Fresh load of the landing page (HEAD build), recorded from first paint; the hero schematic lights its pins as onchain reads land (mark landingLive = spec row read). Holds on the hero, then a calm eased scroll (4.2 s, marks scroll/scrolled) into the live spec row and the start of the Electrical characteristics table, waits for the scroll reveals (mark revealed) and holds. Nothing clicked." });
    save();
  }

  // ===== studio: design a neuron (AND = 2 NAND, then a five-input Go/No-Go = 19 NAND) ===
  if (want("studio")) {
    await open("/app#studio/neuron:1,1:2", `document.querySelector('.compiled .counts') && document.querySelector('.editor .weights')`, "studio neuron editor");
    await sleep(1500);
    const top = (await docY(`document.querySelector('section.studio')`)) - 76;
    await js(`scrollTo(0, ${top})`);
    await sleep(800);
    const nand = () => js(`document.querySelector('.compiled .count.nand b')?.textContent`);
    const and = await nand();
    await shot("studio-and");
    await cursorAt(1000, 820);
    await rec("studio");
    await sleep(2200);
    mark("and");
    // Five inputs.
    await press(byText(".editor .chips button", "5"));
    mark("five");
    await sleep(1400);
    // Two inhibitory synapses: x3 and x4 to -1.
    const weightBtn = (i, label) => `[...document.querySelectorAll('.editor .weights .weight')][${i}]?.querySelector('.seg') && [...[...document.querySelectorAll('.editor .weights .weight')][${i}].querySelectorAll('.seg button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})`;
    await press(weightBtn(3, "−1"), { settle: 800 });
    await sleep(700);
    await press(weightBtn(4, "−1"), { settle: 800 });
    mark("goNoGo");
    await sleep(500);
    await cursorHide();
    await parkMouse();
    const go = await nand();
    const eq = await js(`document.querySelector('.editor .equation')?.textContent`);
    await sleep(4200);
    await endRec("studio");
    await shot("studio-gonogo");
    const rects = {
      design: await rectOf(`document.querySelector('section.studio > .card:nth-child(1)')`),
      compiled: await rectOf(`document.querySelector('section.studio > .card:nth-child(2)')`),
      editor: await rectOf(`document.querySelector('.editor')`),
      die: await rectOf(`document.querySelector('.compiled .compiled-top')`),
      counts: await rectOf(`document.querySelector('.compiled .counts')`),
    };
    log("studio", { and, go, eq });
    setMeta("studio", { url: "/app#studio/neuron:1,1:2", scrollY: top, readings: { andNand: and, goNoGoNand: go, equation: eq }, rects, notes: "Neuron tab opened with the AND neuron y=[x0+x1>=2] (mark and). Real clicks: 5 inputs (mark five), then x3 and x4 to -1, giving y=[x0+x1+x2-x3-x4>=2], the Go/No-Go neuron (mark goNoGo). Compiled live in the browser." });
    save();
  }

  // ===== compose: the REF-composed XOR network (#5) in the Studio catalog ==============
  if (want("compose")) {
    await open("/app#studio", `document.querySelector('.catalog') && document.querySelector('.compiled .counts')`, "studio catalog");
    await sleep(1500);
    const top = (await docY(`document.querySelector('section.studio')`)) - 76;
    await js(`scrollTo(0, ${top})`);
    await sleep(800);
    const refBtn = byText(".catalog .cat", "The XOR Problem (REF-composed)");
    const at = await centerOf(refBtn);
    const p0 = { x: 700, y: 840 };
    let to = top;
    await setCursor(p0.x, p0.y);
    await stepped("compose", async (st) => {
      st.hold(1.6);
      await st.anim(0.9, glidePose(p0, at));
      st.hold(0.15);
      await st.act(() => stepClick(at.x, at.y), 500);
      st.mark("ref");
      await st.anim(0.3, async (p) => js(`document.getElementById('__cur').style.opacity = '${1 - p}'`));
      await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: VIEW.w - 6, y: VIEW.h - 4 });
      // Scroll target after the click (the REF deps exist now): bring the cost rows into view.
      const burned = await js(`(() => { const e = [...document.querySelectorAll('.compiled dt, .compiled .row')].find((x) => /Transistors burned/.test(x.textContent)); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : null; })()`);
      to = Math.max(top, Math.min(top + 340, (burned ?? top + 700) - 560));
      log("compose scroll", { top, burned, to });
      st.hold(2.7);
      await st.anim(1.8, async (p) => setScroll(Math.round(top + (to - top) * easeIO(p))));
      st.mark("cost");
      st.hold(4);
    });

    await shot("compose");
    const reading = await js(`(() => { const c = document.querySelector('.compiled'); return { counts: c?.querySelector('.counts')?.innerText.replace(/\\s+/g, ' '), text: c?.closest('.card')?.innerText.slice(0, 900) }; })()`);
    const rects = {
      design: await rectOf(`document.querySelector('section.studio > .card:nth-child(1)')`),
      compiled: await rectOf(`document.querySelector('section.studio > .card:nth-child(2)')`),
      deps: await rectOf(`document.querySelector('.compiled .deps')`),
    };
    setMeta("compose", { url: "/app#studio", reading, rects, notes: "Catalog tab; real click on 'The XOR Problem (REF-composed)' (mark ref): 3 REF to the taped-out OR, NAND and AND neurons. Then an eased scroll to the cost rows (mark cost)." });
    save();
  }

  // ===== processor: Genesis Drop card and live processor state ==========================
  if (want("drop")) {
    await open("/app#processor", `/claims left/i.test(document.body.innerText) && /\\d+\\s*of\\s*25/.test(document.body.innerText)`, "genesis drop");
    await sleep(2500);
    const top = (await docY(`document.querySelector('.drop-card')`)) - 96;
    await js(`scrollTo(0, ${top})`);
    await sleep(800);
    await stepped("drop", async (st) => {
      st.hold(5.5);
      await st.anim(2.2, async (p) => setScroll(Math.round(top + 330 * easeIO(p))));
      st.mark("stats");
      st.hold(3.5);
    });
    await shot("drop");
    await js(`scrollTo(0, ${top})`);
    await sleep(400);
    const reading = await js(`(() => { const t = document.querySelector('.drop-card')?.innerText ?? ''; return t.replace(/\\s+/g, ' ').slice(0, 600); })()`);
    const rects = { drop: await rectOf(`document.querySelector('.drop-card')`) };
    setMeta("drop", { url: "/app#processor", scrollY: top, reading, rects, notes: "Genesis Drop #1 card at rest (live reads), then an eased scroll to the processor's live stats row (mark stats). rects at the starting scroll." });
    save();
  }

  // ===== gallery: 16 die shots drawn from their netlists ================================
  if (want("gallery")) {
    await open("/app#gallery", `document.querySelectorAll('.gallery article.circuit').length >= 16 && !document.querySelector('.gallery .skeleton')`, "gallery cards");
    await sleep(3000);
    const top = (await docY(`document.querySelector('.section-head')`)) - 92;
    await js(`scrollTo(0, ${top})`);
    await sleep(1200);
    const n = await js(`document.querySelectorAll('.gallery article.circuit').length`);
    const max = await js(`document.documentElement.scrollHeight - innerHeight`);
    const to = Math.min(max, top + 1500);
    await stepped("gallery", async (st) => {
      st.hold(2.5);
      await st.anim(7, async (p) => setScroll(Math.round(top + (to - top) * easeIO(p))));
      st.mark("scrolled");
      st.hold(2);
    });
    await js(`scrollTo(0, ${top})`);
    await sleep(500);
    await shot("gallery");
    setMeta("gallery", { url: "/app#gallery", scrollY: top, cards: n, notes: "Stepped 60 fps take: all circuits on the processor, each die shot drawn from its real netlist; a slow eased scroll (7 s, deterministic per frame) down through the grid (mark scrolled)." });
    save();
  }

  // ===== market: For sale filter and a card's market panel ==============================
  if (want("market")) {
    await open("/app#gallery", `document.querySelectorAll('.gallery article.circuit').length >= 16 && document.querySelector('.market-panel')`, "gallery market");
    await sleep(3500);
    const top = (await docY(`document.querySelector('.section-head')`)) - 92;
    await js(`scrollTo(0, ${top})`);
    await sleep(800);
    await setCursor(900, 800);
    await stepped("market", async (st) => {
      st.hold(1.5);
      await st.anim(1.2, glidePose({ x: 900, y: 800 }, { x: 230, y: 820 }));
      st.mark("onCard");
      st.hold(3.5);
    });
    const after = { note: "For sale filter not clicked in this take; at capture the live market listed nothing (the earlier take showed 'No circuit is listed for sale right now')." };
    await shot("market");
    const rects = { head: await rectOf(`document.querySelector('.section-head')`), firstCard: await rectOf(`document.querySelector('.gallery article.circuit')`) };
    setMeta("market", { url: "/app#gallery", scrollY: top, forSale: after, rects, notes: "Stepped 60 fps take: gallery cards at rest, the pointer glides onto the first card\u2019s brain wallet and market rows (mark onCard) and holds. No click." });
    save();
  }

  // ===== infer: #5 XOR on chain vs simulator, with the gate animation ===================
  if (want("infer")) {
    await open("/app#playground/5", `/CHAIN\\s*=\\s*SIMULATOR/i.test(document.body.innerText) && /Gas used by eval\\s*\\n?\\s*[\\d,]+/.test(document.body.innerText)`, "eval #5");
    await sleep(1500);
    const top = (await docY(`document.querySelector('section.bench')`)) - 96;
    await js(`scrollTo(0, ${top})`);
    await sleep(800);
    await cursorAt(1300, 700);
    await rec("infer");
    await sleep(1800);
    await press(`document.querySelector('.anim-toggle')`);
    mark("animate");
    await sleep(600);
    await cursorHide();
    await parkMouse();
    await sleep(4200);
    // Flip x1: inputs (1,1) -> XOR 0; a fresh eval() and a fresh animation.
    await press(byText("section.bench button", "x1"), { settle: 1000 });
    mark("flip");
    await sleep(600);
    await cursorHide();
    await parkMouse();
    await waitFor("eval of (1,1)", `/CHAIN\\s*=\\s*SIMULATOR/i.test(document.body.innerText) && /eval\\(5, 0x03\\)/.test(document.body.innerText)`, 20_000);
    mark("flipped");
    await sleep(4800);
    await endRec("infer");
    await shot("infer");
    const reading = await js(`(() => document.querySelector('.card.result')?.innerText.replace(/\\s+/g, ' ').slice(0, 500))()`);
    const rects = {
      circuit: await rectOf(`document.querySelector('section.bench > .card:nth-child(1)')`),
      result: await rectOf(`document.querySelector('.card.result')`),
      anim: await rectOf(`document.querySelector('.card.result svg')`),
    };
    setMeta("infer", { url: "/app#playground/5", scrollY: top, reading, rects, notes: "Circuit #5 with x0=1, x1=0 (y=1). Real click on Animate (mark animate): the gate animation replays the onchain run. Then x1 toggled (mark flip): a fresh eval() (1,1) -> 0 lands (mark flipped) and replays. CHAIN = SIMULATOR throughout." });
    save();
  }

  // ===== train: Horizontal vs Vertical, the XOR moment, the compile check ===============
  if (want("train")) {
    await open("/app#train", `document.querySelector('select.train-preset')`, "train view");
    await sleep(1500);
    // The preset is chosen before the take (a native <select> menu is not drawn headless).
    await js(`(() => { const s = document.querySelector('select.train-preset'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'horizontal-vs-vertical'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(900);
    const top = (await docY(`document.querySelector('section.train-grid')`)) - 96;
    await js(`scrollTo(0, ${top})`);
    await sleep(800);
    const pad = `document.querySelector('.train-examples .train-pad')`;
    const px = (i) => js(`(() => { const e = ${pad}.querySelectorAll('.train-px')[${i}].getBoundingClientRect(); return { x: Math.round(e.left + e.width / 2), y: Math.round(e.top + e.height / 2) }; })()`);
    await cursorAt(560, 850);
    await rec("train");
    await sleep(1500);
    // Draw a horizontal stroke across the middle row (a real pointer drag).
    const a = await px(3), c = await px(5);
    await glide(a.x, a.y, 1000);
    await js(`document.getElementById('__cur')?.classList.add('down')`);
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", buttons: 1, clickCount: 1 });
    for (let k = 1; k <= 14; k++) {
      const x = Math.round(a.x + ((c.x - a.x) * k) / 14);
      await js(`(() => { const k = document.getElementById('__cur'); k.style.transition = 'none'; k.style.left = '${x}px'; })()`);
      await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: a.y, button: "left", buttons: 1 });
      await sleep(45);
    }
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button: "left", buttons: 0, clickCount: 1 });
    await js(`(() => { const k = document.getElementById('__cur'); k.classList.remove('down'); k.style.transition = ''; })()`);
    mark("drawn");
    await sleep(1600);
    await press(`document.querySelector('.train-go')`);
    mark("trained");
    await sleep(500);
    await waitFor("xor moment", `document.querySelector('.train-xor')`, 10_000);
    await cursorHide();
    await parkMouse();
    await sleep(2600);
    // Down to the XOR-moment card, then to the compile card.
    const xorY = await docY(`document.querySelector('.train-xor')`);
    await ease(null, Math.max(top, xorY - 330), 1600);
    mark("xor");
    await sleep(3300);
    const compY = await docY(`document.querySelector('.train-compile')`);
    await ease(null, compY - 96, 1800);
    mark("compile");
    await sleep(3800);
    await endRec("train");
    await shot("train-compile");
    const reading = await js(`(() => ({ model: document.querySelector('.train-model')?.innerText.replace(/\\s+/g, ' ').slice(0, 700), compile: document.querySelector('.train-compile')?.innerText.replace(/\\s+/g, ' ').slice(0, 500) }))()`);
    const rectsCompile = { compile: await rectOf(`document.querySelector('.train-compile')`), verify: await rectOf(`document.querySelector('.train-verify')`), tryit: await rectOf(`document.querySelector('.train-try')`) };
    await js(`scrollTo(0, ${Math.max(top, xorY - 330)})`);
    await sleep(500);
    await shot("train-xor");
    const rectsXor = { model: await rectOf(`document.querySelector('.train-model')`), xor: await rectOf(`document.querySelector('.train-xor')`) };
    await js(`scrollTo(0, ${top})`);
    await sleep(400);
    const rectsStart = { examples: await rectOf(`document.querySelector('.train-examples')`), pad: await rectOf(pad), model: await rectOf(`document.querySelector('.train-model')`), go: await rectOf(`document.querySelector('.train-go')`) };
    setMeta("train", { url: "/app#train", preset: "horizontal-vs-vertical", reading, rects: rectsStart, rectsAt: { xor: rectsXor, compile: rectsCompile }, notes: "Preset Horizontal vs Vertical selected before the take. A real pointer drag draws the middle row on the pad (mark drawn; the app notes it is already a Fires example), then a real click on Train (mark trained). Eased scrolls to the XOR-moment card (mark xor) and the compile card, verified on every input (mark compile). Nothing taped out." });
    save();
  }

  // ===== arena: Preview the reply (free eth_call), stats, how it works ==================
  if (want("arena")) {
    await open("/app#arena", `document.querySelector('.arena-stats') && !document.querySelector('.arena-stats .skeleton') && /HUMAN WINS\\s*\\n\\s*\\d/i.test(document.body.innerText)`, "arena stats");
    await sleep(2500);
    const top = (await docY(`document.querySelector('.arena-stats')`)) - 96;
    await js(`scrollTo(0, ${top})`);
    await sleep(800);
    const stats = await js(`document.querySelector('.arena-stats')?.innerText.replace(/\\s+/g, ' ')`);
    await cursorAt(900, 820);
    await rec("arena");
    await sleep(1800);
    await press(`document.querySelector('.arena-preview-toggle')`);
    mark("preview");
    await sleep(900);
    // Corner first: the network answers.
    await press(`document.querySelectorAll('.arena-board > *')[0]`);
    mark("cell");
    await waitFor("preview answer", `/the network answers cell/.test(document.querySelector('.arena-pv')?.innerText ?? '')`, 20_000);
    mark("answer");
    await sleep(2600);
    // Another cell: centre.
    await press(`document.querySelectorAll('.arena-board > *')[4]`, { settle: 900 });
    await waitFor("preview answer 2", `/cell 4, the network answers/.test(document.querySelector('.arena-pv')?.innerText ?? '')`, 20_000);
    mark("answer2");
    await cursorHide();
    await parkMouse();
    await sleep(2600);
    const pv = await js(`document.querySelector('.arena-pv')?.innerText.replace(/\\s+/g, ' ')`);
    const rects = { stats: await rectOf(`document.querySelector('.arena-stats')`), play: await rectOf(`document.querySelector('.arena-play')`), board: await rectOf(`document.querySelector('.arena-board')`), pv: await rectOf(`document.querySelector('.arena-pv')`) };
    await shot("arena-preview");
    const howY = await docY(`document.querySelector('.arena-how')`);
    await ease(null, howY - 120, 2200);
    mark("how");
    await sleep(3500);
    await endRec("arena");
    await shot("arena-how");
    const how = await rectOf(`document.querySelector('.arena-how')`);
    setMeta("arena", { url: "/app#arena", scrollY: top, stats, preview: pv, rects, rectsAt: { how: { how } }, notes: "No wallet. Real click on 'Preview the reply' (mark preview), then cell 0 (mark cell): previewBotMove() eth_call answers (mark answer); then cell 4 (mark answer2). Then an eased scroll to How it works (mark how). Nothing sent." });
    save();
  }

  // ===== agent: live pins, sum vs threshold, decision feed, Replay all ==================
  if (want("agent")) {
    await open("/app#agent", `document.querySelectorAll('.agent-feed .agent-row:not(.agent-row-head)').length > 3 && /DECISIONS\\s*\\n\\s*\\d+/i.test(document.body.innerText)`, "agent feed");
    await sleep(3000);
    const stats = await js(`document.querySelector('.stats')?.innerText.replace(/\\s+/g, ' ')`);
    const top = (await docY(`document.querySelector('.agent-obs')`)) - 96;
    await js(`scrollTo(0, ${top})`);
    await sleep(800);
    await rec("agent");
    await sleep(5000);
    mark("pins");
    const obs = await js(`document.querySelector('.agent-obs')?.innerText.replace(/\\s+/g, ' ').slice(0, 900)`);
    const rectsPins = { obs: await rectOf(`document.querySelector('.agent-obs')`) };
    const feedY = await docY(`document.querySelector('.agent-feed')`);
    await ease(null, feedY - 96, 2400);
    mark("feed");
    await sleep(1200);
    await press(byText(".agent-feed-actions button", "Replay all"));
    mark("replay");
    await waitFor("replay verified", `/\\d+ \\/ \\d+ verified/i.test(document.querySelector('.agent-feed-actions')?.innerText ?? '')`, 30_000);
    await sleep(1500);
    await waitFor("replay done", `(() => { const m = (document.querySelector('.agent-feed-actions')?.innerText ?? '').match(/(\\d+) \\/ (\\d+) verified/i); return m && m[2] === String(document.querySelectorAll('.agent-feed .agent-row:not(.agent-row-head)').length); })()`, 40_000).catch((e) => log("replay not all done:", e.message));
    mark("verified");
    await cursorHide();
    await parkMouse();
    await sleep(4500);
    await endRec("agent");
    await shot("agent-feed");
    const feed = await js(`(() => ({ head: document.querySelector('.agent-feed .card-head')?.innerText.replace(/\\s+/g, ' '), passed: document.querySelector('.agent-feed-actions')?.innerText.replace(/\\s+/g, ' '), rows: document.querySelectorAll('.agent-feed .agent-row:not(.agent-row-head)').length, first: document.querySelector('.agent-feed .agent-row:not(.agent-row-head)')?.innerText.replace(/\\s+/g, ' ') }))()`);
    const rectsFeed = { feed: await rectOf(`document.querySelector('.agent-feed')`), actions: await rectOf(`document.querySelector('.agent-feed-actions')`) };
    await js(`scrollTo(0, ${top})`);
    await sleep(500);
    await shot("agent-pins");
    log("agent", { stats, feed });
    setMeta("agent", { url: "/app#agent", scrollY: top, stats, observation: obs, feed, rects: rectsPins, rectsAt: { feed: rectsFeed }, notes: "Live observation card (five pins, weights, sum vs threshold) at rest (mark pins), eased scroll to the decision feed (mark feed), real click on Replay all (mark replay): every listed decision re-run with eval(8, input) (mark verified)." });
    save();
  }
} catch (e) {
  log("FAILED:", e.stack || e.message);
  if (stopRec) { try { await stopRec(); } catch {} }
  process.exitCode = 1;
} finally {
  save();
  log("console:", b.consoleLines.slice(0, 12));
  clearTimeout(hardStop);
  b.close();
}
