/** Pure helpers shared by the 3D scene and its static poster (no three.js import, keeps the landing bundle small). */
function hex(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function mix(a: string, b: string, t: number) {
  const x = hex(a), y = hex(b);
  const k = Math.min(1, Math.max(0, t));
  return x.map((v, i) => Math.round(v + (y[i] - v) * k));
}

/** Health factor → colour: green (≥ 2.0) → amber (1.5) → red (≤ 1.1). */
export function hfColor(hf: number): { r: number; g: number; b: number; getHexString: () => string } {
  let rgb: number[];
  if (hf >= 2) rgb = hex("#4cbf80");
  else if (hf >= 1.5) rgb = mix("#e4a93f", "#4cbf80", (hf - 1.5) / 0.5);
  else if (hf >= 1.1) rgb = mix("#f0544f", "#e4a93f", (hf - 1.1) / 0.4);
  else rgb = hex("#f0544f");
  const [r, g, b] = rgb;
  return { r: r / 255, g: g / 255, b: b / 255, getHexString: () => rgb.map((v) => v.toString(16).padStart(2, "0")).join("") };
}

/** Height above the liquidation plane for an ICR (%). Below 110% the sphere sinks into the plane. */
export function clearanceHeight(icrPct: number) {
  const t = (icrPct - 110) / (300 - 110);
  return t < 0 ? Math.max(-0.9, t * 3) : Math.min(1, t) * 3.1 + 0.62;
}
