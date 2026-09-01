"use client";

/**
 * The last resort: the root layout itself threw.
 *
 * At this point nothing above it is standing, so this file replaces the whole
 * document and has to bring its own `html` and `body`. That also means none of
 * the app's fonts or stylesheet are loaded, which is why the few styles here
 * are inline rather than the utility classes used everywhere else — the one
 * place in this codebase where that is the right call.
 *
 * Same rule as everywhere else: the digest, never the message.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "3rem 1.25rem",
          background: "#f6f8f8",
          color: "#0a1918",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "24rem",
            textAlign: "center",
            border: "1px solid #dfe7e6",
            borderRadius: "0.75rem",
            background: "#ffffff",
            padding: "1.5rem",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>
            TrackMoney could not start
          </h1>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem", color: "#5a6c6b" }}>
            The problem has been logged. Nothing was charged.
          </p>

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              border: 0,
              borderRadius: "0.5rem",
              background: "#0e7c7b",
              color: "#ffffff",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>

          {error.digest && (
            <p
              style={{
                margin: "1.25rem 0 0",
                paddingTop: "1rem",
                borderTop: "1px solid #dfe7e6",
                fontSize: "0.6875rem",
                color: "#5a6c6b",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              Reference {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
