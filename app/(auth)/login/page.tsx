import Link from "next/link";

import { Field, FormMessage, SubmitButton } from "@/components/auth/Field";
import { demoSignInAction, signInAction } from "@/lib/auth/actions";
import { requireGuest } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  await requireGuest();
  const { error, notice } = await searchParams;

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-muted">Welcome back to TrackMoney.</p>

      <FormMessage error={error} notice={notice} />

      <form action={signInAction} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <SubmitButton>Sign in</SubmitButton>
      </form>

      {/* A reviewer must never have to register to see the product. */}
      <form action={demoSignInAction} className="mt-3">
        <button
          type="submit"
          className="w-full rounded-lg border border-line px-4 py-2.5 text-sm font-medium transition-colors hover:bg-brand-tint"
        >
          Try the demo account
        </button>
      </form>

      <div className="mt-5 flex items-center justify-between text-sm">
        <Link href="/signup" className="text-brand hover:underline">
          Create an account
        </Link>
        <Link href="/forgot-password" className="text-muted hover:underline">
          Forgot password?
        </Link>
      </div>
    </>
  );
}
