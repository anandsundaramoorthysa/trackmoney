import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";

import { Logo } from "@/components/brand/Logo";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TrackMoney — agentic checkout on Razorpay",
  description:
    "A small expense tracker whose upgrade agent is explainable, bounded and gated, with every money action on the record.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/billing", label: "Billing" },
  { href: "/agent-activity", label: "Agent activity" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrains.variable} font-sans antialiased`}>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-5">
            <Link href="/" className="shrink-0">
              <Logo />
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-brand-tint hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-5 pb-10 pt-4 text-xs text-muted">
          <p>
            Demo built for the Razorpay AI Buildathon, Track 1. Razorpay runs in
            test mode — no real money moves. Seeded data is fictional.
          </p>
        </footer>
      </body>
    </html>
  );
}
