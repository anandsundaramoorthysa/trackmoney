"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CloseIcon, MenuIcon, NAV } from "@/components/nav-items";
import { signOutAction } from "@/lib/auth/actions";

/**
 * Navigation on a phone.
 *
 * ── Why this replaced a horizontal strip ───────────────────────────────────
 *
 * The strip was chosen on the argument that "anything hidden behind a tap is
 * something a reviewer might not find". Measuring it settled the question the
 * other way: at 375px only two of the seven destinations were on screen —
 * 895px of navigation inside a 360px viewport — and the five that were not had
 * nothing to suggest they existed. A scroller with no affordance hides more
 * than a labelled button does, and hides it less honestly.
 *
 * It also cost 132px of every phone screen, before a 65px banner, on a page
 * whose own chat panel then had nowhere to go.
 *
 * ── Why a drawer and not a bottom bar ──────────────────────────────────────
 *
 * A bottom bar seats four or five destinations. There are seven, so a drawer
 * would be needed regardless, and running both would spend another 64px of
 * height to save one tap on some of them. Height is the scarce resource here:
 * it is what the assistant's input needed and did not have. So the drawer
 * carries everything and the bar that would compete with it does not exist.
 *
 * Everything above md is untouched — the fixed sidebar still holds the same
 * list, from the same array.
 */
export function MobileNav({
  user,
}: {
  user: { name: string; email: string; plan: "free" | "pro" };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes and hands focus back; the page behind must not scroll while
  // a full-height panel is over it, or closing the drawer leaves somebody
  // somewhere they never navigated to.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus moves into the panel so the keyboard lands where the eye does.
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  // A destination was chosen, so the drawer's job is done. Keyed on the path
  // rather than on the click, so a back gesture closes it too.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open navigation menu"
        className="-ml-1 rounded-lg p-2 text-muted transition-colors hover:bg-brand-tint hover:text-ink md:hidden"
      >
        <MenuIcon />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/*
            The backdrop is a real button, so closing the drawer is reachable
            by keyboard and announced, rather than being a div that only a
            mouse knows about.
          */}
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-semibold">Menu</p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  toggleRef.current?.focus();
                }}
                aria-label="Close navigation menu"
                className="rounded-lg p-2 text-muted transition-colors hover:bg-brand-tint hover:text-ink"
              >
                <CloseIcon />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-2">
              <ul className="space-y-0.5">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      // Announced to a screen reader as the current page, not
                      // merely coloured differently.
                      aria-current={isCurrent(item.href) ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                        isCurrent(item.href)
                          ? "bg-brand-tint text-brand-strong"
                          : "text-muted hover:bg-brand-tint hover:text-ink"
                      }`}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            {/*
              The account lived in a footer marked `hidden md:block`, so on a
              phone the sign-out button rendered at zero size and there was no
              way to sign out at all. It belongs here, where the rest of the
              navigation now is.
            */}
            <div className="border-t border-line px-4 py-3">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
              <span
                className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] ${
                  user.plan === "pro"
                    ? "bg-brand-tint text-brand-strong"
                    : "bg-canvas text-muted"
                }`}
              >
                {user.plan === "pro" ? "Pro" : "Free plan"}
              </span>
              <form action={signOutAction} className="mt-2">
                <button
                  type="submit"
                  className="min-h-11 w-full rounded-lg border border-line px-3 text-sm text-muted transition-colors hover:bg-brand-tint hover:text-ink"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
