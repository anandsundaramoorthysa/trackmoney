import Link from "next/link";

import { Logo } from "@/components/brand/Logo";

/**
 * A mistyped URL, in the app's own clothes.
 *
 * Without this file Next serves its default 404, which is a bare black-on-white
 * page carrying none of the product around it. Nothing is broken when that
 * happens, but a reviewer following a stale link lands somewhere that looks
 * like the app fell over rather than somewhere that tells them where to go.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <Link href="/" className="mb-8">
        <Logo />
      </Link>

      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 text-center">
        <p className="font-mono text-xs tracking-widest text-muted">404</p>
        <h1 className="mt-2 text-lg font-semibold">This page does not exist</h1>
        <p className="mt-2 text-sm text-muted">
          The link may be out of date, or the address may have a typo in it.
        </p>

        <Link
          href="/"
          className="mt-5 inline-block rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
        >
          Back to the dashboard
        </Link>
      </div>

      <p className="mt-6 max-w-sm text-center text-xs text-muted">
        A demo built for the Razorpay AI Buildathon. Razorpay runs in test mode
        and no real money moves.
      </p>
    </div>
  );
}
