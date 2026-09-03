import { defineConfig } from "@playwright/test";

import { TEST_DATABASE_URL, TEST_KEY_ID, TEST_KEY_SECRET } from "./tests/harness";
import {
  EXPECT_TIMEOUT,
  PACE,
  SERVER_START_TIMEOUT,
  STUB_START_TIMEOUT,
  TEST_TIMEOUT,
} from "./tests/e2e/pace";

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
  // Scaled to the machine — see tests/e2e/pace.ts. The conditions are
  // unchanged; only the patience moves.
  timeout: TEST_TIMEOUT,
  expect: { timeout: EXPECT_TIMEOUT },
  reporter: [["list"]],
  metadata: { pace: PACE },
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
      timeout: STUB_START_TIMEOUT,
    },
    {
      // A production build, not `next dev`. The dev server compiles routes on
      // first request and reloads on its own schedule, which shows up as
      // flaky tests rather than real defects — and it is not what anyone
      // running this project will actually be looking at.
      command: `next build && next start --port ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/billing`,
      reuseExistingServer: !process.env.CI,
      // next build is the slow part and the app has grown; 120s was no longer
      // enough and runs were dying before a single test executed.
      //
      // Scaled too, and not as an afterthought: under real load this is the
      // first thing to go. A loaded machine died here at five minutes with
      // "Timed out waiting 300000ms from config.webServer" — before a single
      // case had run, so the whole suite reported nothing.
      timeout: SERVER_START_TIMEOUT,
      env: {
        DATABASE_URL: TEST_DATABASE_URL,
        RAZORPAY_KEY_ID: TEST_KEY_ID,
        RAZORPAY_KEY_SECRET: TEST_KEY_SECRET,
        RAZORPAY_API_BASE: `http://127.0.0.1:${FAKE_RAZORPAY_PORT}`,
        // No LLM keys: the agent runs in its deterministic tier so the browser
        // assertions are about our behaviour, not about model phrasing.
        GROQ_API_KEY: "",
        GEMINI_API_KEY: "",
        // The reset flow has no mail provider, so the code is printed on the
        // page for the tests to read. It is printed for every address, real or
        // not, so the affordance cannot become an oracle — and it is off unless
        // switched on, which production never does.
        SHOW_DEMO_RESET_CODE: "true",
      },
    },
  ],
});

export { APP_PORT, FAKE_RAZORPAY_PORT };
