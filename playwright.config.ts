import { defineConfig } from "@playwright/test";

import { TEST_DATABASE_URL, TEST_KEY_ID, TEST_KEY_SECRET } from "./tests/harness";

const APP_PORT = 3100;
const FAKE_RAZORPAY_PORT = 4599;

/**
 * Browser tests — PLAN.md §8.
 *
 * The app runs for real against the test database. The only thing swapped out
 * is Razorpay itself: order creation goes to a local stand-in, and the browser
 * gets a stubbed `window.Razorpay` because the real checkout is a third-party
 * iframe we neither own nor should be driving. Everything between those two
 * edges — the agent, the gates, the audit writes, signature verification, the
 * plan transition — is the real thing.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: [
    {
      command: "tsx tests/e2e-razorpay-server.ts",
      url: `http://127.0.0.1:${FAKE_RAZORPAY_PORT}/test/sign?order_id=x&payment_id=y`,
      reuseExistingServer: !process.env.CI,
      env: { FAKE_RAZORPAY_PORT: String(FAKE_RAZORPAY_PORT) },
      timeout: 60_000,
    },
    {
      // A production build, not `next dev`. The dev server compiles routes on
      // first request and reloads on its own schedule, which shows up as
      // flaky tests rather than real defects — and it is not what anyone
      // running this project will actually be looking at.
      command: `next build && next start --port ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/billing`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL: TEST_DATABASE_URL,
        RAZORPAY_KEY_ID: TEST_KEY_ID,
        RAZORPAY_KEY_SECRET: TEST_KEY_SECRET,
        RAZORPAY_API_BASE: `http://127.0.0.1:${FAKE_RAZORPAY_PORT}`,
        // No LLM keys: the agent runs in its deterministic tier so the browser
        // assertions are about our behaviour, not about model phrasing.
        GROQ_API_KEY: "",
        GEMINI_API_KEY: "",
      },
    },
  ],
});

export { APP_PORT, FAKE_RAZORPAY_PORT };
