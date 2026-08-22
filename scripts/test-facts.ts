import assert from "node:assert/strict";

import { checkGrounding, suggestionTemplate } from "@/lib/agent/grounding";
import { classifyIntent } from "@/lib/agent/intent";
import type { UsageFacts } from "@/lib/facts";
import { formatPaise } from "@/lib/money";
import { csvCell } from "@/lib/csv";
import { detectRecurring } from "@/lib/recurring";

/**
 * Tests for the parts that must not be wrong — PLAN.md §6.12 step 4.
 *
 * These cover the deterministic layers only: the trigger rule, the consent
 * classifier and the grounding check. Those are the three places where a bug
 * would let the agent say or do something the data does not support, so they
 * are the three places worth testing. Run with `npm run test:facts`.
 */

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error instanceof Error ? error.message : error}`);
  }
}

const FACTS: UsageFacts = {
  userName: "Ananya Rao",
  currentPlan: "free",
  monthLabel: "August 2026",
  txnCountThisMonth: 23,
  freeTxnCap: 20,
  overCapBy: 3,
  isOverCap: true,
  recurringCandidates: [
    { merchant: "Cult.fit", amountPaise: 149_900, monthsSeen: 3 },
    { merchant: "Netflix India", amountPaise: 64_900, monthsSeen: 3 },
  ],
  recurringCount: 2,
  recurringMonthlyTotalPaise: 214_800,
  proPricePaise: 49_900,
  visibleTxnCap: 20,
  showsRecurringDetail: false,
  freeFeatures: ["Up to 20 transactions per month"],
  proFeatures: [
    "Up to 20 transactions per month",
    "Automatic recurring-subscription detection",
  ],
  proOnlyFeatures: ["Automatic recurring-subscription detection"],
  computedAt: new Date().toISOString(),
};

console.log("\nmoney");
test("formats whole rupees without decimals", () => {
  assert.equal(formatPaise(49_900), "₹499");
});
test("formats part-rupee amounts with two decimals", () => {
  assert.equal(formatPaise(129_950), "₹1,299.50");
});

console.log("\nrecurring detection");
test("flags a merchant charging the same amount in two months", () => {
  const found = detectRecurring([
    { merchant: "Netflix", amountPaise: 64_900, occurredOn: "2026-07-04" },
    { merchant: "Netflix", amountPaise: 64_900, occurredOn: "2026-08-04" },
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].monthsSeen, 2);
});

test("ignores a merchant seen twice in the same month", () => {
  const found = detectRecurring([
    { merchant: "Uber", amountPaise: 20_000, occurredOn: "2026-08-04" },
    { merchant: "Uber", amountPaise: 20_000, occurredOn: "2026-08-19" },
  ]);
  assert.equal(found.length, 0);
});

test("ignores the same merchant at different amounts", () => {
  const found = detectRecurring([
    { merchant: "Swiggy", amountPaise: 39_900, occurredOn: "2026-07-05" },
    { merchant: "Swiggy", amountPaise: 47_250, occurredOn: "2026-08-05" },
  ]);
  assert.equal(found.length, 0);
});

console.log("\nconsent classification");
test("a plain yes is consent", () => {
  assert.equal(classifyIntent("yes please"), "affirmative");
});
test("a plain no is a decline", () => {
  assert.equal(classifyIntent("no thanks"), "negative");
});
test("a no attached to a question is still a decline", () => {
  assert.equal(classifyIntent("no, but how much is it?"), "negative");
});
test("a yes attached to a question is NOT consent", () => {
  assert.equal(classifyIntent("yes but what do I lose on Free?"), "question");
});
test("an ambiguous reply is never consent", () => {
  assert.equal(classifyIntent("hmm"), "unclear");
});
test("silence is never consent", () => {
  assert.equal(classifyIntent("   "), "unclear");
});

console.log("\ngrounding");
test("the deterministic template is self-consistent", () => {
  const check = checkGrounding(suggestionTemplate(FACTS), FACTS);
  assert.equal(check.ok, true, `offending: ${check.offending.join(", ")}`);
});
test("accepts wording that only uses facts", () => {
  const check = checkGrounding(
    "You logged 23 transactions in August 2026, 3 over the cap of 20. Pro is ₹499.",
    FACTS,
  );
  assert.equal(check.ok, true, `offending: ${check.offending.join(", ")}`);
});
test("rejects an invented figure", () => {
  const check = checkGrounding(
    "You logged 23 transactions and could save ₹4,200 a year.",
    FACTS,
  );
  assert.equal(check.ok, false);
  assert.ok(check.offending.includes("4,200"));
});
test("rejects a wrong price even when everything else is right", () => {
  const check = checkGrounding("Pro costs ₹299 as a one-time unlock.", FACTS);
  assert.equal(check.ok, false);
});
test("rejects the price stated in paise as though it were rupees", () => {
  // 49900 is a real number in the facts — as paise. Quoting it as the price is
  // a 100x error, and the model is never shown paise in the first place.
  const check = checkGrounding("Pro is a one-time ₹49,900 unlock.", FACTS);
  assert.equal(check.ok, false, "a 100x price passed the grounding check");
});
test("rejects a recurring amount stated in paise", () => {
  const check = checkGrounding("Netflix India charges you ₹64,900.", FACTS);
  assert.equal(check.ok, false);
});

console.log("\nquestions are not refusals");
test("asking what happens without upgrading is a question", () => {
  assert.equal(classifyIntent("what happens if I don't upgrade?"), "question");
});
test("asking about cancelling is a question", () => {
  assert.equal(classifyIntent("can I cancel later?"), "question");
});
test("asking whether it stops tracking is a question", () => {
  assert.equal(classifyIntent("will it stop tracking my other transactions?"), "question");
});
test("a plain refusal using the same words is still a refusal", () => {
  assert.equal(classifyIntent("I don't want it"), "negative");
});
test("telling it to stop is still a refusal", () => {
  assert.equal(classifyIntent("stop"), "negative");
});

console.log("\n'no' is not always a refusal");
test("no problem, go ahead is consent", () => {
  assert.equal(classifyIntent("no problem, go ahead"), "affirmative");
});
test("no worries, set it up is consent", () => {
  assert.equal(classifyIntent("no worries, set it up"), "affirmative");
});
test("I have no issue with that, do it is consent", () => {
  assert.equal(classifyIntent("I have no issue with that, do it"), "affirmative");
});
test("no idea what Pro does is a question", () => {
  assert.equal(classifyIntent("no idea what Pro does, tell me more"), "question");
});
test("a bare no is still a refusal", () => {
  assert.equal(classifyIntent("no"), "negative");
});
test("no thanks, but how much is it? is still a refusal", () => {
  assert.equal(classifyIntent("no thanks, but how much is it?"), "negative");
});
test("a message that both refuses and agrees is neither", () => {
  // Both outcomes are costly, so a conflicting message resolves to neither.
  assert.equal(classifyIntent("no thanks, actually yes do it"), "unclear");
});

console.log("\ncounts are checked like any other figure");
test("rejects a small number the facts do not contain", () => {
  // 0 was previously waved through as "list phrasing", along with 1, 2 and 3 —
  // which meant a wrong small count passed the check unchallenged.
  const check = checkGrounding("0 of your charges repeat every month.", FACTS);
  assert.equal(check.ok, false, "a small number passed without support");
});
test("cannot tell which fact a number refers to — a known limit", () => {
  // 3 is in the facts as overCapBy, so using it as a recurring count passes.
  // The check verifies a figure came from the data, not that it was used for
  // the right thing. Asserting the limit so nobody mistakes it for a guarantee.
  const check = checkGrounding("3 of your charges repeat every month.", FACTS);
  assert.equal(check.ok, true);
});
test("still accepts a count that matches the facts", () => {
  const check = checkGrounding("2 of your charges repeat every month.", FACTS);
  assert.equal(check.ok, true, `offending: ${check.offending.join(", ")}`);
});

console.log("\nCSV export");
test("quotes cells containing a comma", () => {
  assert.equal(csvCell("Swiggy, Bangalore"), '"Swiggy, Bangalore"');
});
test("doubles embedded quotes", () => {
  assert.equal(csvCell('The "Big" Store'), '"The ""Big"" Store"');
});
test("neutralises a spreadsheet formula", () => {
  // A merchant name is data flowing into a file Excel will evaluate.
  const cell = csvCell("=1+1");
  assert.ok(!cell.startsWith("="), `formula left executable: ${cell}`);
  assert.ok(cell.includes("=1+1"), "the value must still be readable");
});
test("neutralises the other formula lead characters", () => {
  for (const lead of ["+", "-", "@"]) {
    const cell = csvCell(`${lead}HYPERLINK("x")`);
    assert.ok(!cell.startsWith(lead), `formula left executable: ${cell}`);
  }
});
test("leaves ordinary values alone", () => {
  assert.equal(csvCell("Netflix India"), "Netflix India");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
