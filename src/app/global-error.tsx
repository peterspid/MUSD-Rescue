"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#101316", color: "#e8ecef", fontFamily: "system-ui", display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1>MUSD Rescue hit an unexpected error</h1>
          <p style={{ color: "#a9b3bb" }}>Reload to try again. No transaction was sent.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", background: "#4fc6bf", border: 0, borderRadius: 8, fontWeight: 600 }}>Reload</button>
        </div>
      </body>
    </html>
  );
}
