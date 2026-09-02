import { ImageResponse } from "next/og";

/**
 * The share card for every public page. Satori renders a small subset of CSS — flex only, no
 * cascade, no custom properties — so the palette is repeated here as hex rather than read from
 * `marketing.css`, and the logo is built from plain boxes instead of the SVG the site uses.
 */
export const alt =
  "PapaFlow — automate your work with a canvas, not a codebase";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BACKGROUND = "#0a0a0a";
const FOREGROUND = "#fafafa";
const MUTED = "#a1a1aa";
const ACCENT = "#5cc2cf";
const BORDER = "#27272a";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BACKGROUND,
          color: FOREGROUND,
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                background: FOREGROUND,
              }}
            />
            <div style={{ width: 34, height: 2, background: ACCENT }} />
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                background: ACCENT,
              }}
            />
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>
            PapaFlow
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              display: "flex",
              fontSize: 74,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 940,
            }}
          >
            Automate your work with a canvas, not a codebase.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              color: MUTED,
              maxWidth: 900,
              lineHeight: 1.3,
            }}
          >
            Build on a canvas, run on your own AI keys, and let every run finish
            on its own.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            borderTop: `1px solid ${BORDER}`,
            paddingTop: 26,
            fontSize: 24,
            color: MUTED,
          }}
        >
          {["Durable runs", "Bring your own keys", "Approvals in Slack"].map(
            (chip) => (
              <div
                key={chip}
                style={{
                  display: "flex",
                  border: `1px solid ${BORDER}`,
                  borderRadius: 999,
                  padding: "8px 18px",
                }}
              >
                {chip}
              </div>
            ),
          )}
        </div>
      </div>
    ),
    size,
  );
}
