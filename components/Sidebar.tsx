import Link from "next/link";

import { Logo } from "@/components/brand/Logo";
import { MobileNav } from "@/components/MobileNav";
import { NAV } from "@/components/nav-items";
import { NotificationBell } from "@/components/NotificationBell";
import { listNotifications } from "@/lib/notifications/store";
import { signOutAction } from "@/lib/auth/actions";
import type { User } from "@/lib/db/schema";

/**
 * The signed-in shell
 *
 * Navigation lives on the left because the app has more than three
 * destinations and will grow again; a top bar stops scaling at about that
 * point. Rendered on the server, so there is no client state and no hydration
 * gap before it becomes usable.
 *
 * From md up it is taken out of the flow entirely and pinned to the viewport,
 * so the nav and the account footer stay reachable however far down a long
 * ledger somebody has scrolled. The offset that keeps the content clear of it
 * lives in the layout.
 *
 * Below md it is a slim bar — a menu button, the logo, the bell — and the
 * destinations move into a drawer. This file used to argue the opposite, that
 * "six links do not justify a hidden menu, and anything hidden behind a tap is
 * something a reviewer might not find". Measuring it answered the other way:
 * the strip put two of seven destinations on screen at 375px and gave no hint
 * that five more existed. The old reasoning was right about the risk and wrong
 * about which layout carried it — see components/MobileNav.tsx.
 *
 * The bell is fetched here and handed down as props, so the count is correct
 * in the first paint rather than arriving a moment later. Only the popover and
 * the drawer are client-side, and both talk to the server just when somebody
 * interacts.
 */
export async function Sidebar({ user }: { user: User }) {
  // A bell that cannot load is not a reason to fail the whole shell.
  const { items, unread } = await listNotifications(user).catch(() => ({
    items: [],
    unread: 0,
  }));

  return (
    <aside className="sticky top-0 z-40 border-b border-line bg-surface md:fixed md:inset-y-0 md:left-0 md:z-30 md:w-60 md:border-b-0 md:border-r">
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-4 py-2.5 md:px-5 md:py-4">
          <MobileNav
            user={{ name: user.name, email: user.email, plan: user.plan }}
          />
          <Link href="/">
            <Logo />
          </Link>
          <div className="ml-auto">
            <NotificationBell initialItems={items} initialUnread={unread} />
          </div>
        </div>

        {/*
          The list itself is desktop-only now. On a phone the same array is
          rendered by the drawer, from components/nav-items.tsx, so a
          destination cannot exist on one and not the other.
        */}
        <nav className="hidden md:flex md:flex-1 md:flex-col md:gap-1 md:px-3">
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
                  ? "bg-brand-tint text-brand-strong"
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
