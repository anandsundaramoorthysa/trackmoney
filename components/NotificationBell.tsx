"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Item = {
  id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  at: string;
};

/**
 * The bell.
 *
 * It sits on the sidebar's logo row rather than in a header, because there is
 * no header and building one would cost something at both breakpoints and buy
 * nothing at either. Above md the sidebar is fixed to the viewport, so the bell
 * inherits the property the nav already has: reachable however far down a long
 * ledger somebody has scrolled. Below md the sidebar is already a strip across
 * the top, so this is the top-right corner a bell conventionally occupies, and
 * it adds no third band above the fold on a phone.
 *
 * The only client component in the shell. The count arrives server-rendered so
 * the first paint is correct, and this talks to the server only when somebody
 * interacts with it.
 */
export function NotificationBell({
  initialItems,
  initialUnread,
}: {
  initialItems: Item[];
  initialUnread: number;
}) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications");
      if (!r.ok) return;
      const data = (await r.json()) as { unread: number; items: Item[] };
      setItems(data.items ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      // A bell that cannot reach the server keeps showing what it has. There is
      // nothing useful to say about it and an error here would be noise on a
      // page about something else.
    }
  }, []);

  // Escape closes and hands focus back, and a click outside closes. Both are
  // what a dialog is expected to do; neither is optional for something that
  // covers the page.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    await refresh();

    // Opening the list is the person choosing to look, so the badge clears.
    // Being told is a different thing and is recorded separately, when they
    // actually open one.
    if (unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      }).catch(() => {});
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notification-panel"
        /*
         * The count is spelled out here rather than left to the badge. The badge
         * is aria-hidden so it is not announced twice, and the icon itself
         * changes when there is something waiting — so the state survives a
         * viewer who cannot distinguish the colour.
         */
        aria-label={
          unread === 0
            ? "Notifications, none unread"
            : `Notifications, ${unread} unread`
        }
        className="relative rounded-lg p-1.5 text-muted transition-colors hover:bg-brand-tint hover:text-ink"
      >
        <BellIcon active={unread > 0} />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-agent px-1 text-[10px] font-semibold text-white"
          >
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id="notification-panel"
          role="dialog"
          aria-label="Notifications"
          /*
           * Right-aligned on a phone, where the bell is at the top right of a
           * full-width strip. Left-aligned from md up, where the bell sits in a
           * 240px column and a right-aligned panel would open off the edge of
           * the screen.
           */
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-lg md:left-0 md:right-auto"
        >
          <div className="border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            <p className="text-xs text-muted">
              {items.length === 0
                ? "Nothing to tell you right now."
                : "Things Tracky AI noticed in your account."}
            </p>
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              When something changes in your spending that is worth knowing, it
              will appear here.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {items.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded(expanded === item.id ? null : item.id)
                    }
                    className="block w-full text-left"
                    aria-expanded={expanded === item.id}
                  >
                    <span className="text-sm font-medium text-ink">
                      {item.title}
                    </span>
                  </button>

                  {expanded === item.id && (
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">
                      {item.body}
                    </p>
                  )}

                  {/*
                    A real link, so it middle-clicks, opens in a new tab and
                    works with the keyboard the way every other navigation in
                    this app does. The explanation itself is a turn the
                    assistant runs; this only says where to go.
                  */}
                  <Link
                    href={`/assistant?explain=${item.id}`}
                    onClick={() => setOpen(false)}
                    className="mt-1.5 inline-block text-xs font-medium text-brand hover:underline"
                  >
                    Ask Tracky AI about this
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d="M8 2a4 4 0 0 0-4 4v2.5L3 11h10l-1-2.5V6a4 4 0 0 0-4-4Z" />
      <path d="M6.5 13a1.6 1.6 0 0 0 3 0" fill="none" />
    </svg>
  );
}
