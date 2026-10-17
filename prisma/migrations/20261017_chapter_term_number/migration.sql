-- AlterTable
ALTER TABLE "chapters" ADD COLUMN "current_term_number" INTEGER;

-- AlterTable
ALTER TABLE "chapter_reorganizations" ADD COLUMN "term_number" INTEGER;
