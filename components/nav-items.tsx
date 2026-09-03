/**
 * The destinations, in one place.
 *
 * Shared by the fixed sidebar and the phone drawer, and deliberately not
 * duplicated between them: two lists is one list and one liability, and the
 * copy is always where a destination quietly stops being reachable on one of
 * the two. Nothing here is server-only or client-only, so both can import it.
 */

/* Inline icons — a handful of small shapes are not worth an icon dependency. */

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

function ChatIcon() {
  return base(
    <>
      <rect x="2" y="2.5" width="12" height="9" rx="2" />
      <path d="M5.5 11.5V14L8.5 11.5" />
      <path d="M5 5.75h6M5 8.25h4" />
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

function TagIcon() {
  return base(
    <>
      <path d="M3 7.5V3h4.5L14 9.5 9.5 14Z" />
      <circle cx="5.6" cy="5.6" r="1" />
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

export function MenuIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden
      className="shrink-0"
    >
      <path d="M3 5.5h14M3 10h14M3 14.5h14" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden
      className="shrink-0"
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export const NAV = [
  { href: "/", label: "Dashboard", icon: GridIcon },
  { href: "/assistant", label: "Assistant", icon: ChatIcon },
  { href: "/transactions", label: "Transactions", icon: ListIcon },
  { href: "/insights", label: "Insights", icon: ChartIcon },
  { href: "/rules", label: "Category rules", icon: TagIcon },
  { href: "/billing", label: "Billing", icon: CardIcon },
  { href: "/agent-activity", label: "Agent activity", icon: TrailIcon },
];
