import Link from "next/link";

import { Logo } from "@/components/brand/Logo";

/** The signed-out shell: one centred card, no navigation to speak of. */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <Link href="/login" className="mb-8">
        <Logo />
      </Link>

      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6">
        {children}
      </div>

      <p className="mt-6 max-w-sm text-center text-xs text-muted">
        A demo built for the Razorpay AI Buildathon. Razorpay runs in test mode
        and no real money moves. Please do not enter real financial data.
      </p>
    </div>
  );
}
