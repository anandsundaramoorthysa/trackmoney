/** Plain server-rendered form parts — no client state anywhere in auth. */
export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  defaultValue,
  placeholder,
  required = true,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
    >
      {children}
    </button>
  );
}

export function FormMessage({
  error,
  notice,
}: {
  error?: string;
  notice?: string;
}) {
  if (!error && !notice) return null;
  return (
    <p
      role="status"
      className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
        error
          ? "border-bad/30 bg-agent-tint text-bad"
          : "border-line bg-brand-tint text-ink"
      }`}
    >
      {error ?? notice}
    </p>
  );
}
