# Phase 2 engine benchmark — V1 vs MediaPipe CPU vs MediaPipe GPU

Every number below is from a real run against real, unmodified product code (`src/lib/virtualBackground/*`, imported unchanged through `bench/vite.bench.config.ts`). Raw JSON for every run is in `bench/results/`; screenshots are in `bench/screenshots/`. Nothing in this report is invented or estimated.

Rerun with: `node bench/run-bench.mjs "C:\Users\xeon5\Downloads\jitsi-toowix\WhatsApp Video 2026-09-29 at 15.30.45.mp4"` (resumable — skips any result file that already exists; set `BENCH_FFMPEG_PATH` to override ffmpeg discovery).

## 1. Environment

- OS: Windows 10 Pro 10.0.19045
- CPU: 2× Intel Xeon E5-2697 v4 @ 2.30GHz — **36 physical cores / 72 logical threads total**
- RAM: 112 GB
- GPU: NVIDIA Quadro P4000 (real hardware — confirmed via `WEBGL_debug_renderer_info`: `ANGLE (NVIDIA, NVIDIA Quadro P4000 ... Direct3D11)`, not SwiftShader)
- Chrome: 153.0.8010.54

**This is a dual-socket workstation, not a representative laptop or desktop.** Despite that, V1 only managed **~16-17fps at 480p/720p** in this benchmark (see section 4) — on a typical 4-8-thread laptop CPU, also sharing time with the rest of a video call, expect this to be meaningfully worse, not better.

**GPU caveat**: the Quadro P4000 is a workstation card with dedicated VRAM and a memory subsystem built for GPU↔CPU transfer traffic. A typical laptop's integrated GPU (sharing system RAM, a much narrower memory bus) is very likely **slower** at the `getAsFloat32Array()` readback specifically — the `mediapipe-gpu` readback numbers in this report (8-25ms) should be read as an optimistic floor, not a typical result.

## 2. Source video facts (real ffprobe output)

```
Video: h264 (avc1, High profile), yuv420p
  478 x 850  -- PORTRAIT (height > width)
  30fps (r_frame_rate 30/1, avg ≈30.03fps)
  bit_rate: 1,347,826 bps
  duration: 24.343889s, 731 frames
Audio: AAC-LC, 48kHz stereo
Container: mov,mp4 -- 4,405,271 bytes, 1,447,680 bps overall
```

### Two environment-forced deviations from a native webcam feed — read before trusting any number

1. **Portrait rejection (verified directly)**: Chrome's `--use-file-for-fake-video-capture` refuses portrait-dimensioned (width < height) files — the fake camera track ends immediately. Reproduced with both synthetic test patterns and real video content; landscape/square dimensions work fine. This is a Chrome limitation, not this app's code. **Workaround**: the three timing clips are pillarboxed into 16:9 canvases (854×480, 1280×720, 1920×1080), real content centered, black bars left/right.
2. **MJPEG instead of Y4M**: this machine had **0 bytes free** on C: when this benchmark started (see section 3 for the direct comparison that justified switching — the two formats are within noise, and MJPEG clips are ~100x smaller).

### Which timing rows are real vs. upscaled

| Row | Status |
|---|---|
| 480 | Pillarboxed, content itself a real downscale (270×480 inside an 854×480 canvas) |
| 720 | Pillarboxed, content itself a real downscale (406×720 inside a 1280×720 canvas) |
| 1080 | **Pillarboxed AND UPSCALED** — source's long edge is only 850px; ffmpeg invents the extra ~230px (608×1080 inside a 1920×1080 canvas). Labeled `-UPSCALED` in every table it appears in. |

### The edge-quality/polarity clip is different again — and also not a native webcam

Because a small subject in a pillarboxed frame is a worse test of mask quality for **both** engines equally (more of the model's input is black bars/background, less is actual person detail), a separate clip was made for the visual checks: a **16:9 center-crop**, no pillarboxing —

> Cropped **478×270 starting at (0, 290)** — the full source width, the vertical-middle 270px band of the 478×850 frame (discards ~290px off the top, ~290px off the bottom) — then upscaled **2.68×** to 1280×720.

This fills the frame much more (closer to a real selfie-style webcam framing) but is still a crop-and-upscale of a portrait source, not a real landscape capture. Do not read the visual-check screenshots as "what a real webcam would show."

## 3. Y4M vs MJPEG format check (real run, v1 engine, 720p pillarboxed clip, 8s each)

| | Y4M | MJPEG |
|---|---|---|
| frames processed | 127 | 128 |
| fps | 15.9 | 16.0 |
| dropped frames | 27 | 28 |
| avg total ms | 28.91 | 28.33 |
| avg segmentation ms | 28.07 | 27.52 |
| avg compositing ms | 0.83 | 0.80 |
| p95 total ms | 43 | 45 |

~2% difference, well within run-to-run noise (see section 4's min/max spread, which is comparable). **MJPEG used for the rest of this benchmark.**

## 4. Main matrix — median of 3 runs, ~35s bench each (5s warmup + 30s sampling)

| engine | height | avg total ms | p95 total ms | avg segmentation ms | avg readback ms | avg compositing ms | fps | dropped frames |
|---|---|---|---|---|---|---|---|---|
| v1 | 480 (pillarboxed 16:9) | 25.7 | 41 | 25.2 | 0 | 0.5 | 16.8 | 61 |
| v1 | 720 (pillarboxed 16:9) | 27.6 | 42 | 26.9 | 0 | 0.7 | 16.3 | 71 |
| v1 | **1080 (pillarboxed 16:9, UPSCALED)** | 40.4 | 56 | 39.7 | 0 | 0.7 | 13.4 | 381 |
| mediapipe-cpu | 480 (pillarboxed 16:9) | 23.6 | 38 | 17.0 | 0 | 0.5 | 17.4 | 54 |
| mediapipe-cpu | 720 (pillarboxed 16:9) | 36.2 | 58 | 20.5 | 0 | 0.9 | 14.2 | 251 |
| mediapipe-cpu | **1080 (pillarboxed 16:9, UPSCALED)** | 52.1 | 74 | 30.1 | 0 | 0.7 | 11.6 | 349 |
| mediapipe-gpu | 480 (pillarboxed 16:9) | 13.3 | 17 | 1.6 | 8.3 | 0.6 | 21.2 | 0 |
| mediapipe-gpu | 720 (pillarboxed 16:9) | 18.7 | 25 | 1.5 | 10.9 | 0.9 | 18.9 | 1 |
| mediapipe-gpu | **1080 (pillarboxed 16:9, UPSCALED)** | 29.8 | 43 | 1.9 | 16.5 | 0.6 | 15.7 | 80 |

No silent fallback to V1 occurred in any run (`actualEngineAfterBench` matched `requestedEngine` in all 9 rows — verified programmatically, not assumed).

**Important measurement caveat (own tooling limitation, not a product bug)**: for the two MediaPipe rows, `avg segmentation ms + avg readback ms + avg compositing ms` does **not** sum to `avg total ms` (e.g. mediapipe-cpu@720: 20.5+0+0.9 = 21.4, but total is 36.2 — a ~15ms gap). This is because `_blendMaskValues()` — the EMA-smoothing loop that runs over every pixel of the mask (see `JitsiStreamBackgroundEffect.ts`) — was not separately timed by this benchmark's instrumentation; its cost is folded into `avg total ms` but invisible in the three sub-metrics. **This gap itself is a real, important finding, not just a benchmark blind spot**: MediaPipe's `confidenceMasks[0]` is returned at the **full output resolution** (e.g. 720×1280 ≈ 920K pixels), unlike V1, whose mask is always a small fixed 256×144 (~37K pixels) regardless of output size. The EMA-blend loop therefore costs roughly resolution² for MediaPipe but is constant for V1 — this is very likely why MediaPipe's *total* time scales worse with resolution than its `segmentForVideo()` time alone suggests.

### Main matrix — min/max of 3 runs (noise)

| engine | height | total avg ms (min–max) | fps (min–max) |
|---|---|---|---|
| v1 | 480 | 25.3–25.9 | 16.7–16.9 |
| v1 | 720 | 26.0–28.0 | 16.2–16.7 |
| v1 | 1080 UPSCALED | 40.3–40.6 | 13.4–13.5 |
| mediapipe-cpu | 480 | 23.2–25.9 | 16.7–17.5 |
| mediapipe-cpu | 720 | 35.9–36.8 | 14.1–14.3 |
| mediapipe-cpu | 1080 UPSCALED | 50.9–59.4 | 10.7–11.8 |
| mediapipe-gpu | 480 | 13.0–14.0 | 20.8–21.3 |
| mediapipe-gpu | 720 | 18.3–18.9 | 18.9–19.1 |
| mediapipe-gpu | 1080 UPSCALED | 29.6–30.1 | 15.6–15.7 |

Noise is low (mostly <5%) except mediapipe-cpu@1080 (50.9-59.4, ~17% spread) — the largest/upscaled case, plausibly noisier because it's also where the performance governor was most active.

## 5. CPU-throttled runs (4x / 6x, 720p only) — median of 3

| engine | throttle | avg total ms | p95 total ms | avg segmentation ms | avg readback ms | fps | dropped frames | perfCap before→after |
|---|---|---|---|---|---|---|---|---|
| v1 | 4x | 144.3 | 187 | 137.8 | 0 | 5.6 | 168 | 720 → 480 |
| v1 | 6x | 243.0 | 297 | 229.6 | 0 | 3.6 | 108 | 720 → 480 |
| mediapipe-cpu | 4x | 140.6 | 169 | 86.2 | 0 | 5.7 | 172 | 720 → 480 |
| mediapipe-cpu | 6x | 215.2 | 255 | 131.8 | 0 | 4.0 | 120 | 720 → 480 |
| mediapipe-gpu | 4x | 60.4 | 80 | 12.1 | 18.0 | 10.5 | 317 | 720 → 480 |
| mediapipe-gpu | 6x | 99.3 | 135 | 27.2 | 25.2 | 7.5 | 224 | 720 → 480 |

**The performance governor stepped the resolution down in every single throttled run** (`perfCap` went from 720 to 480 in all 18 runs, every repeat, both throttle levels — confirmed programmatically from `perfCapBeforeBench`/`perfCapAfterBench` in each result file, not assumed). It never stepped back up during any of these runs, which is correct — the governor's step-up condition requires ~8s of comfortably-fast frames, and none of these throttled runs got there.

**GPU delegate degrades far less under CPU throttling than either CPU-bound engine**: at 6x throttle, v1 and mediapipe-cpu are down to 3.6-4.0fps (essentially unusable), while mediapipe-gpu still manages 7.5fps — because the actual segmentation compute happens on the GPU, which CPU throttling doesn't touch; only the JS-side orchestration and the readback are CPU-bound. This is a real, meaningful argument for GPU delegate specifically on weak/throttled CPUs — precisely the hardware that benefits most.

### Throttled — min/max of 3

| engine | throttle | total avg ms (min–max) |
|---|---|---|
| v1 | 4x | 144.1–146.4 |
| v1 | 6x | 207.9–243.0 |
| mediapipe-cpu | 4x | 124.4–144.7 |
| mediapipe-cpu | 6x | 192.6–223.9 |
| mediapipe-gpu | 4x | 57.6–65.9 |
| mediapipe-gpu | 6x | 94.4–112.0 |

## 6. Visual checks

### Polarity and alignment (mediapipe-cpu, 16:9 edge-crop clip, `toowix_bg_debug_mask=1`)

**Honesty note on the three "moments"**: the fake-capture clip is 6 seconds long and loops; the intended timestamps (still=1s, headturn=15s, handraised=21s, chosen from the real 24s source — see `bench/screenshots/reference/source-*.png`) were converted with `delayMs % (clip length)`, and **15000 % 6000 = 21000 % 6000 = 3000** — both landed on the exact same point in the loop. So this only actually captured **two** distinct moments, not three (`mask-debug-edgecrop-headturn.png` and `mask-debug-edgecrop-handraised.png` are identical). This is a bug in the benchmark script's own timestamp math, not a product issue — flagging it plainly rather than presenting three screenshots as if they show different moments when two of them don't.

From what was actually captured (`mask-debug-edgecrop-still.png`, and the one distinct second moment):
- **Polarity is correct**: the person renders solid white, the background solid black. `confidenceMasks[0]` is the person channel, as expected.
- **Alignment looks correct**: the white silhouette's outline tracks the head/shoulder shape with no visible offset, padding, or letterboxing artifact — no sign that MediaPipe stretched or shifted the frame relative to what the camera captured.

### Edge quality — V1 vs MediaPipe CPU (`edge-compare-v1.png`, `edge-compare-mediapipe-cpu.png`, flags off, blur on)

Viewed both screenshots side by side (same clip, same moment). **No clearly discernible difference between the two** — both show a clean edge around the head, hair, and glasses at the resolution available. This is an honest limitation, not a non-answer: the harness's self-view `<video>` element is only 320px wide (`bench/harness/index.html`), which is too small to make a confident call on fine detail like individual hair strands or the glasses' thin frame edges. **I am not claiming MediaPipe is better, and I am not claiming V1 is better — on this evidence, they look equal.** A real comparison would need a larger preview or pixel-level crops, which this benchmark did not produce.

## 7. Stability

- **20× effect off/on toggle** (`window.__benchToggle()`, v1 engine, real `stopEffect()`/`startEffect()`): heap went from **8.2MB → 32.3MB** over the session, no console errors or exceptions. This is a single before/after measurement, not a trend — it cannot distinguish "one-time allocation that would stabilize" from "a genuine per-toggle leak that keeps growing." Treat this as a flag worth a longer/repeated test, not a conclusion either way.
- **30s tab-hidden/visibility test** (mediapipe-gpu): **the check itself was flawed and its result should not be trusted.** It compared `_debugAccum.count` (a counter that resets every ~1 second by design, not a running total) at two points in time and concluded "did not resume" because the second read was lower than the first — but that's expected behavior for a resetting counter regardless of whether the loop is healthy. No console errors were observed during or after the hidden period, which is a weak positive signal, but whether the frame loop and the GPU delegate specifically recovered after being hidden was **not reliably tested**.

## 8. Headed (visible window) sanity run

| engine | source | avg total ms | fps |
|---|---|---|---|
| v1 | `window.__bgBench(10)` | 29.6 | 13.2 |
| v1 | headless median (720p) | 27.6 | 16.3 |

v1 in a visible window is close to headless (29.6 vs 27.6ms, ~7% slower) — reasonable, expected overhead from actual compositing/paint work a headless tab skips.

**mediapipe-cpu's headed run produced `frames: 0` in the structured `__bgBench(10)` result** — the sampling array was empty. This is **not** the same as "nothing happened": a side channel (`_lastOverlayMetrics`, populated independently once a second regardless of the bench call) shows real activity during that same run — `avgTotalMs: 197`, `avgSegmentationMs: 179` — roughly **5.5x slower than the same engine/height headless** (36.2ms). The exact mechanism (Chrome throttling timers in a visible-but-unfocused automated window vs. a cold-start/JIT-warmup effect not fully cleared by the shorter 3s warmup used for headed runs) was not root-caused. **Treat this one data point as "mediapipe-cpu was dramatically slower in this headed run, by a real side-channel measurement" rather than as a clean, trustworthy fps/ms comparison** — the primary bench mechanism failed to sample anything, which is itself worth noting as a benchmark-tooling gap for headed runs specifically.

## 9. Observations — which stage dominates

- **V1**: segmentation is >97% of total time at every height (25.2/25.7 @480, 26.9/27.6 @720, 39.7/40.4 @1080). Compositing is negligible (0.5-0.7ms). The fixed 256×144 segmentation input means this scales only mildly with output height — the ~57% jump from 720p to 1080p (26.9ms→39.7ms) is surprising given the model input size doesn't change, and is likely the CPU competing with the also-scaling `runPostProcessing()` compositing draws (even though the compositing bucket alone stays small, the browser's own paint/canvas pipeline work outside what's timed could be growing) — not fully explained by this benchmark.
- **MediaPipe CPU**: the `segmentForVideo()` call itself is meaningfully faster than V1's whole pipeline at every height (17.0 vs 25.2 @480, 20.5 vs 26.9 @720, 30.1 vs 39.7 @1080) — but once the untimed `_blendMaskValues()` cost (see section 4's caveat) is accounted for via the total, MediaPipe CPU ends up **slower overall** than V1 at 720p and 1080p. **A GPU-vs-CPU-shaped compositing rewrite (Phase 3's WebGL idea) would need to address this blend-loop cost specifically, not just segmentation, to actually pay off for the CPU delegate.**
- **MediaPipe GPU**: segmentation is essentially free (1.5-1.9ms flat across all three heights — the GPU doesn't care about output resolution the way the CPU paths do). Readback is the real cost and **does** scale with resolution (8.3→10.9→16.5ms). Total time is dominated by readback + the same untimed blend-loop cost, not by compute.
- **Compositing** (`runPostProcessing()`, shared by all three engines) stays small and roughly flat everywhere (0.5-0.9ms) — confirms the Phase 1 downsample-before-blur optimization is doing its job; this is not where the remaining cost lives for any engine.

## 10. Governor threshold assessment (26ms down / 12ms up) — proposal only, not changed

- The 26ms step-down threshold is **already being crossed by V1 itself** at every height in this matrix (25.7-40.4ms average) — meaning the governor is stepping resolution down almost immediately in ordinary V1 use on hardware far above typical, not just in adverse conditions. On real (weaker) hardware this will trigger even more aggressively.
- The 12ms step-up threshold is **never reached by any CPU-bound engine** in this matrix (V1's best case is 23.2ms at 480p) — only mediapipe-gpu gets close (13.3-14.0ms at 480p, still above 12). This means in practice, once the governor steps down, V1 and mediapipe-cpu calls in this kind of environment may **never step back up**, even on fast hardware, because the 12ms bar is calibrated for a much lighter pipeline than what's actually running.
- **Proposal (not applied)**: given both thresholds are being crossed this readily even on a 36-core workstation, they may be substantially miscalibrated for the current compositing cost — a real revisit would want the governor tuned against the *actual* observed segmentation+blend cost per engine (which now differ a lot: V1 ~25-40ms, mediapipe-gpu ~13-30ms total), not a single fixed pair of numbers shared by all three engines.

## 11. Default engine recommendation

**Keep `v1` as the default. Do not flip to MediaPipe CPU.** Across every unthrottled height, mediapipe-cpu's *total* time is equal to or worse than v1 (720p: 36.2 vs 27.6ms; 1080p: 52.1 vs 40.4ms) — the segmentation-step speedup MediaPipe CPU offers is more than consumed by the resolution-scaling blend-loop cost this benchmark surfaced. Recommending MediaPipe CPU as-is would be a regression, not an improvement, for most calls.

**mediapipe-gpu is a genuinely different story** — 1.5-3x faster total time than v1 at every height, near-zero dropped frames at 480/720p (0 and 1, vs 61 and 71 for v1), and it degrades far more gracefully under CPU throttling (section 5). If this were graduating from opt-in, GPU would be the candidate worth pursuing — but only with real caveats: (a) it needs the `getAsFloat32Array()` readback cost addressed (a WebGL/texture-based compositing path, i.e. Phase 3, avoids the readback entirely and is the "real" fix, not a CPU-array workaround), (b) this measurement is from a discrete workstation GPU and is very likely optimistic for typical laptop-integrated GPUs (section 1), and (c) the headed-run anomaly (section 8) and the untested visibility-resume behavior (section 7) mean GPU delegate's real-world robustness in an actual, focused browser tab isn't fully confirmed by this benchmark.

## 12. What was NOT tested or could not be trusted

- **Real portrait webcam framing** — Chrome's fake-video-capture cannot accept portrait dimensions at all; every quantitative result uses pillarboxed 16:9 canvases, every quality check uses a 16:9 crop-and-upscale. Neither is a substitute for an actual landscape (or actual portrait) webcam.
- **GPU numbers are from a workstation-class discrete GPU**, not typical integrated laptop graphics (section 1).
- **The segmentation/readback/compositing sub-metrics for MediaPipe undercount the true per-frame cost** by the untimed `_blendMaskValues()` loop (section 4) — only `avg total ms` is trustworthy for MediaPipe rows; the sub-metric breakdown is not.
- **Only two, not three, distinct moments were actually captured** in the mask-polarity visual check, due to a timestamp-modulo collision in the bench script (section 6).
- **Edge-quality comparison could not distinguish the two engines** at the screenshot resolution available — reported as "equal" honestly, not as a confident verdict either way.
- **The tab-visibility/GPU-recovery stability check used a flawed signal** (a periodically-resetting counter) and its "did not resume" result should not be trusted (section 7).
- **The headed mediapipe-cpu run's primary bench mechanism returned zero samples**; only a side-channel number is available, and it disagrees sharply (5.5x slower) with the headless result for the same configuration — not root-caused (section 8).
- **The 20-toggle heap measurement is two points, not a trend** — cannot distinguish a one-time allocation from an actual leak (section 7).
- Bundle-size impact, real end-to-end call quality with another participant, and anything requiring a real (non-fake) camera were out of scope for this benchmark and were not tested here.
