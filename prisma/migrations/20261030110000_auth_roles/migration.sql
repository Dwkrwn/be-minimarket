CREATE TABLE "m_role" (
 "id" UUID PRIMARY KEY, "nama_role" VARCHAR(100) NOT NULL UNIQUE,
 "kode_role" VARCHAR(100), "catatan" TEXT, "system_key" TEXT UNIQUE,
 "is_active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "m_role_d" (
 "id" UUID PRIMARY KEY, "m_role_id" UUID NOT NULL REFERENCES "m_role"("id") ON DELETE CASCADE,
 "m_menu_id" UUID NOT NULL REFERENCES "m_menu"("id") ON DELETE CASCADE,
 "is_read" BOOLEAN NOT NULL DEFAULT false, "is_create" BOOLEAN NOT NULL DEFAULT false,
 "is_update" BOOLEAN NOT NULL DEFAULT false, "is_delete" BOOLEAN NOT NULL DEFAULT false,
 "is_print" BOOLEAN NOT NULL DEFAULT false,
 CONSTRAINT "m_role_d_m_role_id_m_menu_id_key" UNIQUE ("m_role_id", "m_menu_id")
);
CREATE TABLE "user_default" (
 "id" UUID PRIMARY KEY, "name" VARCHAR(100) NOT NULL, "username" VARCHAR(100) NOT NULL UNIQUE,
 "password_hash" TEXT NOT NULL, "catatan" TEXT, "is_active" BOOLEAN NOT NULL DEFAULT true,
 "role_id" UUID NOT NULL REFERENCES "m_role"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "auth_session" (
 "id" UUID PRIMARY KEY, "token_hash" TEXT NOT NULL UNIQUE,
 "user_id" UUID NOT NULL REFERENCES "user_default"("id") ON DELETE CASCADE,
 "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "auth_session_user_id_idx" ON "auth_session"("user_id");
