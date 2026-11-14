"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#ffffff", color: "#000000", fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, padding: 16 }}>
        <div style={{ maxWidth: 440 }}>
          <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: 0 }}>MUSD Rescue hit an unexpected error</h1>
          <p style={{ color: "#2e2e2e", marginTop: 12 }}>Reload to try again. No transaction was sent.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "10px 16px", background: "#1e40ff", color: "#ffffff", border: 0, borderRadius: 6, fontWeight: 600, fontSize: 15, cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
