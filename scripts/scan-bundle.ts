/**
 * Does any secret reach the browser?
 *
 * Case J5 was written months ago and never once run, because it needs the build
 * output rather than a page. So nothing has ever actually stopped a secret from
 * being imported into a client component and shipped — the rule existed only as
 * a habit.
 *
 * The values are read from the environment and searched for literally. Names
 * are useless here: `DATABASE_URL` appearing in a chunk means nothing, and the
 * connection string appearing in one means everything.
 *
 *   npm run scan:bundle
 *
 * The check refuses to pass vacuously. If it finds none of the secrets AND none
 * of the public key either, it is looking at the wrong files, and it says so
 * and fails rather than reporting a clean run it did not earn.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Must never be in anything the browser receives. */
const SECRETS = [
  "DATABASE_URL",
  "RAZORPAY_KEY_SECRET",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "MERCHANT_SIGNING_KEY",
];

/**
 * The control: something that must be in the client bundle.
 *
 * Without this, "found no secrets" and "read nothing" look identical, and the
 * check would pass hardest exactly when it was most broken.
 *
 * The first choice for this was RAZORPAY_KEY_ID, on the reasoning that checkout
 * needs it so it must be shipped. It is not, and the check said so on its first
 * run: the key id is handed to Checkout.js by the server alongside the order,
 * so it never enters the bundle at all. The app is quieter than the assumption.
 *
 * So the control is a string from a client component instead — the assistant's
 * checkout button, which is compiled into client JS because the panel runs in
 * the browser. If this cannot be found, the scanner is reading the wrong files.
 */
const CLIENT_CONTROL = "Open secure checkout";

const ROOTS = [".next/static", ".next/server/app", ".next/server/chunks"];

function filesUnder(dir: string): string[] {
  let found: string[] = [];
  let entries: string[];

  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found = found.concat(filesUnder(path));
    else found.push(path);
  }

  return found;
}

function main() {
  const files = ROOTS.flatMap(filesUnder).filter((f) =>
    /\.(js|mjs|cjs|json|html|txt|css|map)$/.test(f),
  );

  if (files.length === 0) {
    console.error("No build output found. Run `npm run build` first.");
    process.exit(1);
  }

  const skipped: string[] = [];
  const hunting = new Map<string, string>();

  for (const name of SECRETS) {
    const value = process.env[name];
    // A short value would match half the file by accident; a missing one cannot
    // be searched for at all. Either way, say which were not checked.
    if (!value || value.length < 8) {
      skipped.push(name);
      continue;
    }
    hunting.set(name, value);
  }

  const leaks: { name: string; file: string; offset: number }[] = [];
  let controlFound = false;

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    if (!controlFound && text.includes(CLIENT_CONTROL)) controlFound = true;

    for (const [name, value] of hunting) {
      const at = text.indexOf(value);
      if (at === -1) continue;

      leaks.push({ name, file: relative(process.cwd(), file), offset: at });
    }
  }

  console.log(`\nScanned ${files.length} built files.`);
  if (skipped.length > 0) {
    console.log(`Not checked (unset in this environment): ${skipped.join(", ")}`);
  }

  for (const leak of leaks) {
    console.error(
      `  LEAK  ${leak.name} appears in ${leak.file} at offset ${leak.offset}`,
    );
  }

  if (leaks.length > 0) {
    console.error(`\n${leaks.length} secret value(s) reached the client bundle.\n`);
    process.exit(1);
  }

  // The control. Without it, "no leaks" might only mean "nothing was read".
  if (!controlFound) {
    console.error(
      `\nThe control string ${JSON.stringify(CLIENT_CONTROL)} was not found in ` +
        `any built file. It ships in client JS, so its absence means this scan ` +
        `is reading the wrong output and proves nothing.\n`,
    );
    process.exit(1);
  }

  console.log(
    `No secret values in the bundle, and the client control was located — ` +
      `so the scan was reading the right files.\n`,
  );
}

main();
