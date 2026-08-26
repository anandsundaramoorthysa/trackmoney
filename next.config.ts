import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Referrer-Policy matters here specifically: this app renders one-time codes
   * and mandates, and Checkout.js is loaded from Razorpay's origin while those
   * pages are open. `no-referrer` guarantees no path or query ever leaves with
   * a third-party request, rather than relying on the browser default.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  /* config options here */
};

export default nextConfig;
