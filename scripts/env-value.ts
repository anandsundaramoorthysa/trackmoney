/**
 * Print one value from .env.local, and nothing else.
 *
 * `dotenv` writes a banner to **stdout**, not stderr. Anything that pipes a
 * value through it therefore gets the banner too, silently prepended. That
 * happened here twice: five production environment variables were uploaded with
 * ninety-odd characters of banner in front of them — a Razorpay key id that
 * should be twenty-three characters arrived as a hundred and eighteen — and
 * later a signing key went the same way. Neither failed loudly. The app simply
 * could not reach anything.
 *
 * So this parses the file directly. It is deliberately small and dependency
 * free, because the whole point is that nothing else gets to write to stdout.
 *
 *   npx tsx scripts/env-value.ts DATABASE_URL > value.txt
 *   npx vercel env add DATABASE_URL production < value.txt
 *
 * Multi-line quoted values (a PEM key, say) are handled: the value runs to the
 * closing quote, not to the end of the line.
 */
import { readFileSync } from "node:fs";

const name = process.argv[2];
const file = process.argv[3] ?? ".env.local";

if (!name) {
  process.stderr.write("usage: tsx scripts/env-value.ts <NAME> [file]\n");
  process.exit(2);
}

let text: string;
try {
  text = readFileSync(file, "utf8");
} catch {
  process.stderr.write(`cannot read ${file}\n`);
  process.exit(1);
}

/** Walk the lines rather than regex the file, so a value containing "=" survives. */
function read(): string | null {
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trimStart().startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1 || line.slice(0, eq).trim() !== name) continue;

    const rest = line.slice(eq + 1).trim();
    const quote = rest[0];

    if (quote !== '"' && quote !== "'") return rest;

    // Quoted, and possibly spanning lines.
    const closing = rest.indexOf(quote, 1);
    if (closing !== -1) return rest.slice(1, closing);

    const collected = [rest.slice(1)];
    for (let j = i + 1; j < lines.length; j += 1) {
      const end = lines[j].indexOf(quote);
      if (end === -1) {
        collected.push(lines[j]);
        continue;
      }
      collected.push(lines[j].slice(0, end));
      return collected.join("\n");
    }

    // Unterminated quote: treat the rest of the file as the value rather than
    // silently returning a truncated one.
    return collected.join("\n");
  }

  return null;
}

const value = read();

if (value === null) {
  process.stderr.write(`${name} is not set in ${file}\n`);
  process.exit(1);
}

process.stderr.write(`${name}: ${value.length} characters\n`);
process.stdout.write(value);
