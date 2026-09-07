require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');
const bcrypt = require('bcrypt');

async function main() {
  console.log('Starting seed...');

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.local');
  }

  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();

  try {
    // Check if admin already exists
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    
    if (existing.rows.length > 0) {
      console.log(`Admin user ${adminEmail} already exists, skipping.`);
    } else {
      // Hash password with bcrypt
      const password_hash = await bcrypt.hash(adminPassword, 12);
      
      await client.query(
        `INSERT INTO users (id, email, password_hash, role, status, failed_login_count, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'ADMIN', 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [adminEmail, password_hash]
      );
      console.log(`Created admin user: ${adminEmail}`);
    }

    console.log('Seed completed successfully.');
  } finally {
    await client.end();
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e.message);
    process.exit(1);
  });
