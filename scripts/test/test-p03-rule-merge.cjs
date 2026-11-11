// Explicit local rehearsal only. Never reads environment/database URLs or changes the template.
const { Client } = require('pg')
const { readFileSync } = require('node:fs')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const config = { host: '127.0.0.1', port: 54329, user: 'postgres', password: 'bbe_local_test_only', connectionTimeoutMillis: 3000 }
const database = `bbe_test_p03_${Date.now()}`
if (!/^bbe_test_p03_\d+$/.test(database)) throw new Error('Unsafe test database name')
async function main() {
  const admin = new Client({ ...config, database: 'postgres' })
  let created = false
  let db
  try {
    await admin.connect()
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE bbe_test_head`)
    created = true
    db = new Client({ ...config, database })
    await db.connect()
    const user = randomUUID(), course = randomUUID(), unit = randomUUID()
    await db.query(`INSERT INTO users(id,email,password_hash,display_name,role,updated_at) VALUES($1,$2,'test-only','P03 test','ADMIN',now())`, [user, `${user}@example.test`])
    await db.query(`INSERT INTO courses(id,title,created_by,updated_at) VALUES($1,'P03 rule collision',$2,now())`, [course, user])
    await db.query(`INSERT INTO organization_units(id,name,type,updated_at) VALUES($1,'P03 test ban','DEPARTMENT',now())`, [unit])
    const pairs = [['MEMBER', 'DEPARTMENT_MEMBER'], ['DEPARTMENT_LEADER', 'DEPARTMENT_LEAD'], ['TT', 'DNA_MEMBER'], ['TRAINEE', 'DNA_MEMBER']]
    const ruleIds = []
    for (const [oldCode, code] of pairs) {
      const scope = code === 'DNA_MEMBER' ? 'DNA' : 'DEPARTMENT'
      for (const name of [oldCode, code]) await db.query(`INSERT INTO positions(id,code,name,scope) VALUES($1,$2,$2,$3) ON CONFLICT(code) DO NOTHING`, [randomUUID(), name, scope])
    }
    // NULL and non-NULL unit scopes, two legacy names converging on DNA_MEMBER, plus closed history.
    for (const code of [...new Set(pairs.flat())]) {
      for (const scope of [null, unit]) {
        const id = randomUUID(); ruleIds.push(id)
        await db.query(`INSERT INTO learning_rules(id,course_id,organization_unit_id,position_id,target_code) SELECT $1,$2,$3,id,$4 FROM positions WHERE code=$5`, [id, course, scope, code === 'MEMBER' ? 'MEMBER_BTV' : code === 'DEPARTMENT_MEMBER' ? 'DEPARTMENT_MEMBER_BTV' : null, code])
      }
    }
    const history = randomUUID(); ruleIds.push(history)
    await db.query(`INSERT INTO learning_rules(id,course_id,position_id,effective_until) SELECT $1,$2,id,now()-interval '1 day' FROM positions WHERE code='MEMBER'`, [history, course])
    await db.query(readFileSync('prisma/migrations/20261110_standardize_roles_positions/migration.sql', 'utf8'))
    const result = await db.query(`SELECT r.*,p.code FROM learning_rules r JOIN positions p ON p.id=r.position_id WHERE r.id=ANY($1::uuid[])`, [ruleIds])
    assert.equal(result.rows.length, ruleIds.length, 'all historical rules survive')
    assert.equal(result.rows.filter(r => r.effective_until === null).length, 6, 'one rule per canonical position/unit scope')
    assert.equal(result.rows.find(r => r.id === history).code, 'DEPARTMENT_MEMBER')
    assert.equal(result.rows.some(r => r.target_code === 'MEMBER_BTV'), false)
    console.log('PASS: migration preserves duplicate-rule history in NULL/non-NULL scopes and converging aliases')
  } finally {
    if (db) await db.end()
    if (created) await admin.query(`DROP DATABASE "${database}"`)
    await admin.end()
  }
}
main().catch(error => { console.error(`P03 local rehearsal failed: ${error.code || error.name}`); process.exitCode = 1 })
