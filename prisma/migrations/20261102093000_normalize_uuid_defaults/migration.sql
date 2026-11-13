-- Menyelaraskan default kolom id tabel legacy dengan migration history.
-- Default gen_random_uuid() dibuat manual di database (di luar migration),
-- sedangkan id selalu digenerate oleh Prisma (@default(uuid())).
ALTER TABLE "auth_session" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "m_menu" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "m_role" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "m_role_d" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "user_default" ALTER COLUMN "id" DROP DEFAULT;
