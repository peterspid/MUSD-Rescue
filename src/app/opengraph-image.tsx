import { ImageResponse } from "next/og";

export const alt = "MUSD Rescue: know your risk, rescue your position";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#101316", color: "#e8ecef", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", fontSize: 30, color: "#4fc6bf" }}>MUSD Rescue</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 700, lineHeight: 1.02 }}>
            <span>Know your risk.</span>
            <span>Rescue your position.</span>
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#a9b3bb" }}>Liquidation prevention for Mezo MUSD troves</div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", position: "relative" }}>
          <div style={{ position: "absolute", bottom: 120, width: 380, height: 90, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(240,84,79,0.55), rgba(240,84,79,0))" }} />
          <div style={{ position: "absolute", bottom: 150, width: 300, height: 4, background: "#f0544f" }} />
          <div style={{ position: "absolute", top: 120, width: 170, height: 170, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #c8fff8, #4fc6bf 45%, #1f6f6b)" }} />
        </div>
      </div>
    ),
    size,
  );
}
