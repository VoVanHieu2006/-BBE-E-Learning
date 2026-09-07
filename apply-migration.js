const { Client } = require("pg");
const fs = require("fs");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.DIRECT_URL,
  });
  await client.connect();
  try {
    const sql = fs.readFileSync("prisma/migrations/20250831_init/migration.sql", "utf8");
    await client.query(sql);
    console.log("✅ Migration applied successfully.");
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error("❌ Migration failed:", e.message);
  process.exit(1);
});
