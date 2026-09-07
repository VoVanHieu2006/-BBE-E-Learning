#!/usr/bin/env node
/**
 * Simple manual test script for Prompt 1 — Invitation & Account Activation
 * Run manually: node test-prompt1.js
 */

require('dotenv').config({ path: '.env.local' })
const { Client } = require('pg')
const crypto = require('crypto')
const fs = require('fs')

// Import invitation service (compiled JavaScript version)
// Since TypeScript service isn't compiled, we'll do direct DB operations

const client = new Client({ connectionString: process.env.DIRECT_URL })

async function main() {
  await client.connect()
  console.log('=== Prompt 1 — Manual Verification Script ===')

  // 1. Verify invitation tables exist
  const tables = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users', 'chapters', 'chapter_members', 'invitations')"
  )
  console.log('Core tables exist:', tables.rows.map((r) => r.table_name).join(', '))

  // 2. Verify invitation service import path
  const serviceExists = fs.existsSync('src/lib/invitations.ts')
  console.log('Invitation service exists:', serviceExists ? 'YES' : 'NO')

  // 3. Check admin user created in Prompt 0 still exists
  const admin = await client.query(
    "SELECT id, email, role, status FROM users WHERE email = $1",
    [process.env.ADMIN_EMAIL || '']
  )
  if (admin.rows.length === 1) {
    console.log('Admin user verified:', admin.rows[0].email, '| role:', admin.rows[0].role, '| status:', admin.rows[0].status)
  } else {
    console.log('Admin user NOT FOUND — seed may have failed.')
  }

  // 4. Check that invitation endpoint files exist
  const endpoints = [
    'src/app/api/v1/invitations/chapter-leader/route.ts',
    'src/app/api/v1/invitations/member/route.ts',
    'src/app/api/v1/invitations/accept/route.ts',
    'src/app/api/v1/invitations/[id]/resend/route.ts',
    'src/app/api/v1/invitations/route.ts',
  ]
  endpoints.forEach((ep) => {
    const exists = fs.existsSync(ep)
    console.log('Endpoint', ep.split('/').pop() || ep, ':', exists ? 'OK' : 'MISSING')
  })

  // 5. Check lib files exist
  const libs = ['src/lib/auth.ts', 'src/lib/tokens.ts', 'src/lib/invitations.ts', 'src/lib/prisma.ts']
  libs.forEach((l) => {
    console.log('Lib', l.split('/').pop() || l, ':', fs.existsSync(l) ? 'OK' : 'MISSING')
  })

  console.log('=== Verification complete ===')
  await client.end()
}

main().catch((e) => {
  console.error('Test error:', e.message)
  process.exit(1)
})
