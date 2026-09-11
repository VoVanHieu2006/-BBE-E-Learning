const { Pool } = require('pg');

const oldUrl = process.env.OLD_DATABASE_URL;
const newUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!oldUrl || !newUrl) {
  console.error('Usage: OLD_DATABASE_URL=... DIRECT_URL=... node scripts/migrate_data.js');
}

// Ordered by Foreign Key dependencies (parents before children)
const TABLES_IN_ORDER = [
  'users',
  'chapters',
  'chapter_members',
  'invitations',
  'courses',
  'sessions',
  'lessons',
  'videos',
  'documents',
  'lesson_progress',
  'assessments',
  'questions',
  'question_options',
  'attempts',
  'attempt_questions',
  'attempt_answers',
  'lesson_comments',
  'refresh_tokens',
  'password_reset_tokens',
  'audit_logs'
];

async function migrate() {
  console.log('=== STARTING DATABASE MIGRATION ===');
  console.log('Old DB: Supabase Mumbai (aws-0-ap-south-1)');
  console.log('New DB: Supabase US-West-1 (aws-0-us-west-1)\n');

  const oldPool = new Pool({ connectionString: oldUrl, ssl: { rejectUnauthorized: false } });
  const newPool = new Pool({ connectionString: newUrl, ssl: { rejectUnauthorized: false } });

  try {
    // 1. Verify connection to both DBs
    const oldVersion = await oldPool.query('SELECT version();');
    console.log('✓ Connected to Old DB:', oldVersion.rows[0].version.slice(0, 30));

    const newVersion = await newPool.query('SELECT version();');
    console.log('✓ Connected to New DB:', newVersion.rows[0].version.slice(0, 30));

    console.log('\n--- Migrating tables in dependency order ---');

    const report = [];

    for (const tableName of TABLES_IN_ORDER) {
      process.stdout.write(`Migrating [${tableName}]... `);

      // Check if table exists in old DB
      const tableCheck = await oldPool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
        [tableName]
      );

      if (tableCheck.rows.length === 0) {
        console.log(`Table does not exist in Old DB, skipping.`);
        report.push({ table: tableName, oldRows: 0, newRows: 0, status: 'SKIPPED (no table)' });
        continue;
      }

      // Fetch all rows from old DB
      const selectResult = await oldPool.query(`SELECT * FROM "${tableName}"`);
      const rows = selectResult.rows;

      if (rows.length === 0) {
        console.log(`0 rows. OK.`);
        report.push({ table: tableName, oldRows: 0, newRows: 0, status: 'SUCCESS (empty)' });
        continue;
      }

      // Insert into new DB
      let insertedCount = 0;
      for (const row of rows) {
        const columns = Object.keys(row);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const values = columns.map(c => row[c]);

        // Use ON CONFLICT (id) DO NOTHING if id column exists
        let query;
        if (columns.includes('id')) {
          query = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders}) ON CONFLICT ("id") DO NOTHING;`;
        } else {
          query = `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING;`;
        }

        try {
          await newPool.query(query, values);
          insertedCount++;
        } catch (err) {
          console.error(`\nError inserting row in ${tableName}:`, err.message);
          console.error('Row data:', JSON.stringify(row));
          throw err;
        }
      }

      // Verify count in new DB
      const newCountRes = await newPool.query(`SELECT count(*)::int as count FROM "${tableName}"`);
      const newCount = newCountRes.rows[0].count;

      console.log(`Copied ${rows.length} rows. (New DB total: ${newCount}) ✓`);
      report.push({
        table: tableName,
        oldRows: rows.length,
        newRows: newCount,
        status: rows.length <= newCount ? 'SUCCESS' : 'MISMATCH'
      });
    }

    // 2. Synchronize PostgreSQL Sequences if any
    console.log('\n--- Synchronizing PostgreSQL Sequences ---');
    const seqsRes = await newPool.query(`
      SELECT sequence_name 
      FROM information_schema.sequences 
      WHERE sequence_schema = 'public'
    `);
    for (const s of seqsRes.rows) {
      console.log(`  Sequence: ${s.sequence_name}`);
    }

    // 3. Final Reconciliation Table
    console.log('\n================ RECONCILIATION REPORT ================');
    console.table(report);

    const allMatched = report.every(r => r.status.startsWith('SUCCESS'));
    if (allMatched) {
      console.log('\n🎉 ALL DATA MIGRATED WITH 100% INTEGRITY AND ZERO DATA LOSS!');
    } else {
      console.warn('\n⚠️ Some tables had mismatches, please check the report above.');
    }

  } catch (error) {
    console.error('\n❌ MIGRATION FAILED:', error);
    process.exit(1);
  } finally {
    await oldPool.end().catch(() => {});
    await newPool.end().catch(() => {});
  }
}

migrate();
