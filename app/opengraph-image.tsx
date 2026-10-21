import { ImageResponse } from "next/og";
import { LAUNCH } from "@/lib/marketing/launch-copy";

export const alt = "Taylslate. Make 2027 the year you win with podcast ads.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#f2ebe1",
          color: "#1c1915",
          padding: "72px",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, fontWeight: 600 }}>
          taylslate
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              letterSpacing: 3,
              color: "#c17a45",
              textTransform: "uppercase",
            }}
          >
            {LAUNCH.eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 64,
              fontWeight: 600,
              lineHeight: 1.05,
              marginTop: 20,
              maxWidth: 980,
            }}
          >
            {LAUNCH.headline}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
