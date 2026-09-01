"use client";

import Link from "next/link";

import { Logo } from "@/components/brand/Logo";

/**
 * Something threw while rendering.
 *
 * Deliberately says nothing about what. `error.message` is written for whoever
 * wrote the code — in production Next has already replaced it with a generic
 * string, and in development it can carry a query or a stack. The same rule the
 * API error handler follows applies here: a person who hit a bug needs to know
 * what to do next, not which column was involved.
 *
 * The digest is the exception, and it is safe. It is an opaque identifier Next
 * puts in the server log beside the real error, so quoting it is the difference
 * between "it broke" and a line somebody can actually go and find.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <Link href="/" className="mb-8">
        <Logo />
      </Link>

      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          The problem has been logged. Nothing was charged, and no data was
          changed by whatever failed here.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg px-4 py-2.5 text-sm text-muted transition-colors hover:bg-brand-tint hover:text-ink"
          >
            Back to the dashboard
          </Link>
        </div>

        {error.digest && (
          <p className="mt-5 border-t border-line pt-4 font-mono text-[11px] text-muted">
            Reference {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
