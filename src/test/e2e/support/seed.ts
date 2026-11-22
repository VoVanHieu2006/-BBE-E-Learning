import { readFileSync } from 'node:fs'
import path from 'node:path'

// Demo accounts come from prisma/seed.ts; read its shared demo password instead of copying it here.
const seedSource = readFileSync(path.resolve(__dirname, '../../../../prisma/seed.ts'), 'utf8')
function seedConstant(name: string) {
  const match = seedSource.match(new RegExp(`${name} = "([^"]+)"`))
  if (!match) throw new Error(`prisma/seed.ts no longer defines ${name}`)
  return match[1]
}

export const SEED_PASSWORD = seedConstant('SHARED_PASSWORD')
export const ACCOUNTS = {
  admin: seedConstant('adminEmail'),
  chapterLead: 'chapter.lead.demo@bbe.vn', // Lead of the first seeded Chapter
  otherChapterLead: 'quoc.bao@bbe.vn', // Lead of the second seeded Chapter
  transferChapterLead: 'mai.anh@bbe.vn', // Lead of the third seeded Chapter, reserved for term-transfer specs
  transferChapterMember: 'bao.chau@bbe.vn',
  dnaLead: 'dna.lead.demo@bbe.vn',
  member: 'member.demo@bbe.vn', // first Chapter, department BTV
  departmentLead: 'department.lead.demo@bbe.vn', // first Chapter, department BND
  president: 'phuong.hoa@bbe.vn',
  dnaMember: 'dna.member.demo@bbe.vn',
  otherChapterMember: 'minh.tuan@bbe.vn', // second Chapter
  seededLocked: 'locked.member@bbe.vn',
} as const
export type AccountKey = keyof typeof ACCOUNTS
