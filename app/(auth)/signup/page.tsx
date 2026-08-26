import Link from "next/link";

import { Field, FormMessage, SubmitButton } from "@/components/auth/Field";
import { signUpAction } from "@/lib/auth/actions";
import { requireGuest } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireGuest();
  const { error } = await searchParams;

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Create an account</h1>
      <p className="mb-5 text-sm text-muted">
        Track your spending and see what the assistant notices.
      </p>

      <FormMessage error={error} />

      <form action={signUpAction} className="space-y-4">
        <Field label="Name" name="name" autoComplete="name" />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters, with a letter and a number."
        />
        <SubmitButton>Create account</SubmitButton>
      </form>

      <p className="mt-5 text-sm text-muted">
        Already have one?{" "}
        <Link href="/login" className="text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
