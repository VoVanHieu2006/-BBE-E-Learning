ALTER TYPE "invitation_role" ADD VALUE IF NOT EXISTS 'DNA_LEAD';

UPDATE "positions" SET "name" = 'Lead Chapter' WHERE "code" IN ('CHAPTER_LEAD', 'CHAPTER_MANAGER');
UPDATE "positions" SET "name" = 'Lead DNA' WHERE "code" = 'DNA_LEAD';
