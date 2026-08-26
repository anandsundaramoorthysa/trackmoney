import Link from "next/link";

import { Logo } from "@/components/brand/Logo";
import { signOutAction } from "@/lib/auth/actions";
import type { User } from "@/lib/db/schema";

/**
 * The signed-in shell — PLAN.md §10.3.
 *
 * Navigation lives on the left because the app now has more than three
 * destinations and will grow again; a top bar stops scaling at about that
 * point. Rendered on the server, so there is no client state and no
 * hydration gap before it becomes usable.
 *
 * On small screens it becomes a horizontal strip above the content rather than
 * a drawer: five links do not justify a hidden menu, and anything hidden
 * behind a tap is something a reviewer might not find.
 */

const NAV = [
  { href: "/", label: "Dashboard", icon: GridIcon },
  { href: "/transactions", label: "Transactions", icon: ListIcon },
  { href: "/insights", label: "Insights", icon: ChartIcon },
  { href: "/billing", label: "Billing", icon: CardIcon },
  { href: "/agent-activity", label: "Agent activity", icon: TrailIcon },
];

export function Sidebar({ user }: { user: User }) {
  return (
    <aside className="border-b border-line bg-surface md:h-dvh md:w-60 md:shrink-0 md:border-b-0 md:border-r">
      <div className="flex h-full flex-col md:sticky md:top-0">
        <div className="px-5 py-4">
          <Link href="/">
            <Logo />
          </Link>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible md:pb-0">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-brand-tint hover:text-ink"
            >
              <item.icon />
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="hidden border-t border-line px-3 py-3 md:block">
          <div className="px-2 pb-2">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <span
              className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] ${
                user.plan === "pro"
                  ? "bg-brand-tint text-brand"
                  : "bg-canvas text-muted"
              }`}
            >
              {user.plan === "pro" ? "Pro" : "Free plan"}
            </span>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-brand-tint hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/* Inline icons — five small shapes are not worth an icon dependency. */

function base(children: React.ReactNode) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

function GridIcon() {
  return base(
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>,
  );
}

function ListIcon() {
  return base(
    <>
      <path d="M5 4h9M5 8h9M5 12h9" />
      <path d="M2 4h.01M2 8h.01M2 12h.01" />
    </>,
  );
}

function ChartIcon() {
  return base(
    <>
      <path d="M2 13V7M6 13V3M10 13v-4M14 13V5" />
    </>,
  );
}

function CardIcon() {
  return base(
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M1.5 6.5h13" />
    </>,
  );
}

function TrailIcon() {
  return base(
    <>
      <path d="M3 12.5 7 8l3 2.5L13.5 4" />
      <circle cx="10" cy="10.5" r="1.6" />
    </>,
  );
}
