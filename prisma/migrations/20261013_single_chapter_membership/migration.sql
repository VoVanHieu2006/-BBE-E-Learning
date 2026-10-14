-- One account may belong to one Chapter only. DNA memberships remain separate
-- organization memberships, so the same person may serve in DNA and Chapter.
CREATE UNIQUE INDEX "chapter_members_user_id_key" ON "chapter_members"("user_id");
