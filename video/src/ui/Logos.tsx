import React from "react";
import { Img, staticFile } from "remotion";

// Official partner logos, used as supplied (never redrawn or recoloured):
//  X Layer: OKX's X Layer media kit (github.com/okx/xlayer-docs, media-kit/XLayer-logo-kit.zip), white or black variant.
//  TapeOut: the icon served by tapeout.net (navy bowtie on its paper tile).
//  IGNIX: the organiser's logo from t.me/IGNIXOfficial (320x320), white keyed to transparency; black
//  wordmark, so it sits on a paper surface, never above its native size.
export const XLayerLogo: React.FC<{ height: number; dark?: boolean; style?: React.CSSProperties }> = ({ height, dark = true, style }) => (
  <Img src={staticFile(`brand/xlayer-logo-${dark ? "white" : "black"}.svg`)} style={{ height, width: (height * 259) / 64, ...style }} />
);
export const TapeOutIcon: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <Img src={staticFile("brand/tapeout-icon.svg")} style={{ width: size, height: size, ...style }} />
);
/** Native 320 px; keep `size` at or below that in the 1080p frame. */
export const IgnixLogo: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <Img src={staticFile("brand/ignix-logo.png")} style={{ width: Math.min(320, size), height: Math.min(320, size), ...style }} />
);
