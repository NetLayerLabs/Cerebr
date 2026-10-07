import { Easing, interpolate } from "remotion";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const expo = Easing.bezier(0.16, 1, 0.3, 1);
export const soft = Easing.bezier(0.22, 0.7, 0.25, 1);

/** 0 -> 1 between frames a and b, eased. */
export const ramp = (f: number, a: number, b: number, ease = expo) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: ease });
/** In over [a, a+inDur], out over [b-outDur, b]. */
export const window = (f: number, a: number, b: number, inDur = 12, outDur = 12) =>
  interpolate(f, [a, a + inDur, b - outDur, b], [0, 1, 1, 0], clamp);
/** A pop-in with a little overshoot, 0 -> ~1.06 -> 1 over 18 units (works on fractional frames, unlike spring()). */
const back = Easing.out(Easing.back(1.7));
export const pop = (f: number, at: number) => interpolate(f, [at, at + 18], [0, 1], { ...clamp, easing: back });
