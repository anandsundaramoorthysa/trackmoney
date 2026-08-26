import crypto from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with scrypt — PLAN.md §10.3.
 *
 * scrypt ships in Node, so this costs no dependency and no native build step,
 * and it is memory-hard: the parameters below make each guess expensive in RAM
 * as well as CPU, which is the property that matters against a leaked table.
 *
 * The format stores its own parameters, so raising the cost later does not
 * invalidate existing hashes — old ones keep verifying with the settings they
 * were written under, and get upgraded on next login.
 */

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const COST = 16_384; // N
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;

  const [scheme, cost, blockSize, parallelism, saltHex, hashHex] =
    stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  try {
    const expected = Buffer.from(hashHex, "hex");
    const derived = await scrypt(
      password.normalize("NFKC"),
      Buffer.from(saltHex, "hex"),
      expected.length,
      {
        N: Number(cost),
        r: Number(blockSize),
        p: Number(parallelism),
        maxmem: 64 * 1024 * 1024,
      },
    );
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Spend the same work whether or not the account exists.
 *
 * Without this, "no such user" returns in a millisecond while a real account
 * takes ~100ms, and the difference tells an attacker which addresses are
 * registered. Cheap to avoid, awkward to explain if you did not.
 */
export async function burnPasswordTime(password: string): Promise<void> {
  await verifyPassword(
    password,
    "scrypt$16384$8$1$" + "0".repeat(32) + "$" + "0".repeat(128),
  );
}

export function assessPassword(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That password is too long.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Include at least one letter and one number.";
  }
  return null;
}
