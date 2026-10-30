-- CreateTable
CREATE TABLE "m_menu" (
    "id" UUID NOT NULL,
    "parent" UUID,
    "name" VARCHAR(100) NOT NULL,
    "desc" TEXT,
    "icon" VARCHAR(100),
    "is_actiive" BOOLEAN NOT NULL DEFAULT true,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "module" VARCHAR(100),
    "path" VARCHAR(100),

    CONSTRAINT "m_menu_pkey" PRIMARY KEY ("id")
);
