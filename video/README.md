# Cerebr demo film

A 2:52 film (3840×2160, 60 fps) made with [Remotion](https://www.remotion.dev) for the judges of the IGNIX X Layer **TapeOut Genesis Transistor** hackathon. It covers the problem (a single neuron cannot learn XOR, and onchain apps cannot run a neural network), the idea (a neuron is logic, logic is NAND gates), Cerebr working live on X Layer mainnet, and what makes it different.

The film's motif is "the lit wire": a lime signal travelling gate by gate through NAND gates, which is what TapeOut's `eval()` does. It starts as one neuron in 1969, lights the processor's 16 die cells, runs through the Arena network and the agent's five input pins, and resolves into the Cerebr mark.

Outputs (in `out/`, not committed): `cerebr-demo-4k.mp4` (the master), `cerebr-demo-1080p.mp4`, `cerebr-thumbnail.png` (1920×1080) and `cerebr-thumbnail-4k.png` (3840×2160). YouTube title, description and chapters are in `out/youtube.md`.

## What is real

**Footage.** Every app shot is the real Cerebr dApp and landing page reading X Layer mainnet live. Nothing is mocked, no wallet was connected and no transaction was sent. Every action in the clips is a read, a local simulation or a free `eth_call`: the Studio compile, Inference `eval()`, Train, Arena "Preview the reply" and Agent "Replay all".
- The live site was behind the repository HEAD when we recorded, so the clips were recorded from **HEAD commit `4e42fe9`** (official X Layer, TapeOut and IGNIX logos). It was built with `vite build` and served locally with `vite preview`. It is the same code that deploys to cerebr.xyz.
- Recording setup: headless Chrome over the DevTools protocol (`scripts/capture.mjs`, `scripts/cdp.mjs`), 1600×900 CSS px at device scale 2 (3200×1800 frames), JPEG quality 100, encoded at 60 fps with H.264 CRF 11.
- Clips with long scrolls or pointer moves (compose, drop, gallery, market) were recorded "stepped". The page is posed for every 1/60 s (eased scroll position and pointer), and one screenshot is taken per step. Clicks are real mouse events. This makes the motion even.

| Clip | URL (on the HEAD build) | Recorded (UTC, 2026-10-07) | What happens |
|---|---|---|---|
| landing | `/` | 22:11 | Fresh load: the die-shot schematic lights its pins; slow scroll into the live spec row and Electrical characteristics table |
| studio | `/app#studio/neuron:1,1:2` | 22:12 | AND neuron (2 NAND); real clicks to 5 inputs with x3, x4 = −1: 19 NAND, the same netlist as circuit #8 |
| infer | `/app#playground/5` | 22:13 | Circuit #5 with Animate on; x1 toggled; chain result = simulator |
| train | `/app#train` | 22:14 | Preset "Horizontal vs Vertical" (selected before the take); a drawn stroke; Train; the XOR-moment card; compile card: 96 NAND, verified on all 512 inputs. Nothing taped out |
| arena | `/app#arena` | 22:14 | No wallet: "Preview the reply": cell 0 → network answers 4; cell 4 → 0; How it works |
| agent | `/app#agent` | 22:15 | Live observation (five pins, sum vs θ); decision feed; Replay all: 64 / 64 verified |
| drop | `/app#processor` | 22:30 | Genesis Drop #1 card, then the processor's live stats row (stepped) |
| gallery | `/app#gallery` | 22:32 | All 16 circuits' die shots, slow scroll (stepped) |
| market | `/app#gallery` | 22:32 | The pointer rests on the first card's brain wallet and market row ("Not listed"); stepped, no click |
| compose | `/app#studio` | 22:33 | Real click on "The XOR Problem (REF-composed)": 0 NAND, 3 REF, 0 transistors burned (stepped) |

**Numbers on screen and their sources** (`src/data.json`).
- From the live app at capture time (2026-10-07, 22:11 to 22:33 UTC, X Layer mainnet):
  - Processor `0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF`: 16 circuits taped out, 1,251 transistors minted of 1,000,000, unit price 0.00001 OKB.
  - Genesis Drop: 16 NAND per claim, 24 of 25 claims left, 384 NAND remaining.
  - CerebrAgent `0x3d736c6419dCa667a351907578b68717Cd6e3340`: 194 decisions (17 Go, 177 No-Go).
  - The live pins at block 72,642,238: CALM 1, ACTIVE 0, RESTED 0, SPIKE 0, REFRACTORY 0, so 1 < θ 2 and the verdict is NO-GO.
  - Replay all: 64 / 64 verified.
- Gate counts: AND neuron 2 NAND and the five-input Go/No-Go neuron 19 NAND (Studio, live compile; README catalog). XOR network #5 = 3 REFs, 0 transistors burned (Studio; README). The trained Horizontal vs Vertical network is 96 NAND, verified on all 2^9 = 512 inputs (Train view, live).
- NeuralArena bot #16: 590 NAND, 7 layers, 362 threshold neurons, all 19,683 boards checked, 457 games with the human moving first: 0 human wins, 346 bot wins, 111 draws (`ARENA.md`, `README.md`).
- "3 verified contracts (Sourcify exact match) · no admin · no funds held": CerebrScope, NeuralArena, CerebrAgent (`README.md`).
- 1969, Minsky and Papert, *Perceptrons*: the XOR result is real history.

**Illustrations (labelled on screen).**
- The 1969 animation of a single neuron failing XOR, then a second layer solving it, is labelled "ILLUSTRATION OF THE 1969 RESULT".
- In the gap scene, the onchain cards with broken wires and the "black box" server answering "answer: 1 ?" are labelled "ILLUSTRATION".
- The idea scene's neuron and NAND chain, and the small wire diagrams beside the footage (REF wiring, 18 bits → gates → move, the agent's pins), are motion graphics that present real structure. They are not app UI.

**Logos.** All are used as supplied, never redrawn or recoloured.
- **X Layer:** OKX's official X Layer media kit (`media-kit/XLayer-logo-kit.zip` in [github.com/okx/xlayer-docs](https://github.com/okx/xlayer-docs)), white logo on dark backgrounds.
- **TapeOut:** the icon served by [tapeout.net](https://tapeout.net) (navy bowtie on its paper tile).
- **IGNIX:** the organiser's logo from its official Telegram channel [t.me/IGNIXOfficial](https://t.me/IGNIXOfficial). It is 320×320; the white background is keyed to transparency with no other change. It is shown on a paper chip at 155 px (310 px in the 4K master), so it is never upscaled.
- **Cerebr:** the chip mark from `app/public/brand` (source art `cerebr-logo.png`), redrawn as an animatable SVG (`src/ui/Mark.tsx`).

**Voice, music and sound.** All from ElevenLabs.
- **Narration:** one voice, **Lily** (premade, id `pFZP5JQG7iQjIQuC4Bku`), model `eleven_multilingual_v2`, via `/v1/text-to-speech/{voice}/with-timestamps`. Every line is normalised to −16 LUFS. A few words are respelled for the voice only, one word for one word (for example "Sereber" for Cerebr), so captions keep the real spelling.
- **Score:** the ElevenLabs Music API with an 8-section composition plan that follows the film's timeline.
- **Sound effects:** 16, made with `/v1/sound-generation`.
- **Final mix:** −14 LUFS integrated, true peak at or below −1 dBTP.

## Build it

The ElevenLabs key is read at runtime from `/Users/mrnetwork/Syntura/video/.env` (`ELEVENLABS_API_KEY`, see `scripts/env.mjs`). It is never printed, logged or stored in this project.

```
npm ci
node scripts/voices.mjs                    # list voices (narrator chosen: Lily)
node scripts/voiceover.mjs                 # narration + word timings, -16 LUFS per line
node scripts/vocheck.mjs                   # speech-to-text check of every line
node scripts/timing.mjs                    # src/timing.json: every word on a 60 fps frame
node scripts/music.mjs && node scripts/timing.mjs
node scripts/sfx.mjs
# app footage: serve the app (vite build && vite preview --port 5210), then
BUILD="<commit>" node scripts/capture.mjs && node scripts/encode.mjs
node scripts/stills.mjs                    # half-scale check stills + contact sheets (out/stills)
npm run draft                              # half-scale draft
npm run render4k                           # 3840x2160, 60 fps, PNG frames, CRF 12, veryslow
npm run finish                             # -14 LUFS, TP <= -1 dBTP (two-pass loudnorm), video copied
npm run 1080p                              # Lanczos downscale of the master, CRF 14
npm run poster                             # thumbnails 1920x1080 and 3840x2160
```

`script.json` holds every spoken line. `src/timing.json` places each word on the frame it is spoken. Scenes animate on those words (`wordAt`) in 30 fps units, and `K = fps / 30` converts them, so the film is frame-rate independent.
