import { ImageResponse } from "next/og";

export const alt = "MUSD Rescue: see how far BTC can fall before your trove is liquidated";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const at = (p: number) => ((p - 100) / 150) * 960;

export default function OG() {
  const ticks = [100, 110, 150, 200, 250];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#ffffff", color: "#000000", padding: "64px 120px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontWeight: 600 }}>
          <div style={{ width: 44, height: 44, background: "#1e40ff", borderRadius: 8, display: "flex", position: "relative" }}>
            <div style={{ position: "absolute", left: 8, top: 30, width: 28, height: 4, background: "#ffffff" }} />
            <div style={{ position: "absolute", left: 12, top: 22, width: 3, height: 8, background: "#ffffff" }} />
            <div style={{ position: "absolute", left: 26, top: 16, width: 4, height: 14, background: "#ffffff" }} />
            <div style={{ position: "absolute", left: 22, top: 9, width: 12, height: 12, borderRadius: 6, background: "#ffffff" }} />
          </div>
          MUSD Rescue
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
          <span>See how far BTC can fall</span>
          <span>before your trove is liquidated.</span>
        </div>
        <div style={{ display: "flex", position: "relative", width: 960, height: 120 }}>
          <div style={{ position: "absolute", left: 0, top: 20, width: at(110), height: 70, background: "#000000" }} />
          <div style={{ position: "absolute", left: at(150), top: 20, width: 0, height: 70, borderLeft: "2px dashed #000000" }} />
          <div style={{ position: "absolute", left: 0, top: 90, width: 960, height: 3, background: "#000000" }} />
          <div style={{ position: "absolute", left: at(168) - 3, top: 10, width: 6, height: 80, background: "#1e40ff" }} />
          <div style={{ position: "absolute", left: at(168) - 12, top: 0, width: 24, height: 24, borderRadius: 12, background: "#1e40ff" }} />
          {ticks.map((t) => (
            <div key={t} style={{ position: "absolute", left: t === 100 ? 0 : at(t) - 30, top: 98, width: 60, display: "flex", justifyContent: t === 100 ? "flex-start" : "center", fontSize: 22, color: t === 110 ? "#000000" : "#5e5e5e", fontWeight: t === 110 ? 700 : 400 }}>
              {t}%
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
