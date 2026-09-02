import Link from "next/link";

import { Field, FormMessage, SubmitButton } from "@/components/auth/Field";
import { resetPasswordAction } from "@/lib/auth/actions";
import { requireGuest } from "@/lib/auth/guard";
import { RESET_TTL_MINUTES } from "@/lib/auth/reset";
import { RESET_CODE_COOKIE, peekValue } from "@/lib/one-time-cookie";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; code?: string; error?: string }>;
}) {
  await requireGuest();
  const { token: fromLink, error } = await searchParams;

  /**
   * The cookie is this demo's channel; the query parameter is what a real
   * emailed reset link would carry. Both are accepted, and neither is generated
   * into a URL by this application.
   */
  // The cookie first, a link's own token second. A real reset email would
  // carry the token in the link; the cookie is how this demo hands it over
  // without writing a fifteen-minute secret into browser history.
  const token = (await peekValue(RESET_CODE_COOKIE)) ?? fromLink;

  if (!token) {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold">No code supplied</h1>
        <p className="mb-5 text-sm text-muted">
          Reset links carry a code. Request a new one to continue.
        </p>
        <Link href="/forgot-password" className="text-sm text-brand hover:underline">
          Request a reset code
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Set a new password</h1>
      <p className="mb-5 text-sm text-muted">
        This code works once and expires {RESET_TTL_MINUTES} minutes after it
        was issued. Signing in again everywhere else will be required.
      </p>

      <FormMessage error={error} />

      <form action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters, with a letter and a number."
        />
        <SubmitButton>Change password</SubmitButton>
      </form>
    </>
  );
}
