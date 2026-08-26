import Link from "next/link";

import { Field, FormMessage, SubmitButton } from "@/components/auth/Field";
import { requestResetAction } from "@/lib/auth/actions";
import { requireGuest } from "@/lib/auth/guard";
import { RESET_TTL_MINUTES } from "@/lib/auth/reset";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; code?: string }>;
}) {
  await requireGuest();
  const { error, sent, code } = await searchParams;

  if (sent) {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold">Check your email</h1>
        <p className="mb-5 text-sm text-muted">
          If that address has an account, a reset code is on its way. Codes
          expire after {RESET_TTL_MINUTES} minutes and work once.
        </p>

        {/*
          This demo has no mail provider. Rather than pretend an email was sent,
          the code is shown here and labelled for what it is. Everything that
          matters about the flow — hashing, expiry, single use, revoking
          existing sessions — is real.
        */}
        {code && (
          <div className="mb-5 rounded-lg border border-agent/40 bg-agent-tint p-3">
            <p className="text-xs text-muted">
              Demo only — in production this is emailed, never displayed.
            </p>
            <p className="mt-1 break-all font-mono text-xs">{code}</p>
            <Link
              href={`/reset-password?token=${encodeURIComponent(code)}`}
              className="mt-2 inline-block text-sm text-brand hover:underline"
            >
              Continue to set a new password
            </Link>
          </div>
        )}

        <Link href="/login" className="text-sm text-brand hover:underline">
          Back to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Reset your password</h1>
      <p className="mb-5 text-sm text-muted">
        Enter your email and we will send a code that lasts{" "}
        {RESET_TTL_MINUTES} minutes.
      </p>

      <FormMessage error={error} />

      <form action={requestResetAction} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <SubmitButton>Send reset code</SubmitButton>
      </form>

      <p className="mt-5 text-sm">
        <Link href="/login" className="text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
