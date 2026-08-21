import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  // Imported lazily so dotenv has already populated DATABASE_URL.
  const { seedDatabase } = await import("@/lib/db/seed");
  const summary = await seedDatabase();

  console.log("Seeded TrackMoney demo data:");
  console.log(`  demo user id        ${summary.userId}`);
  console.log(`  transactions total  ${summary.transactionsInserted}`);
  console.log(`  this month          ${summary.transactionsThisMonth}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
