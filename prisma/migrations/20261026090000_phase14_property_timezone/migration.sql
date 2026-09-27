-- AlterTable
-- Additive only: existing properties are backfilled with the default.
ALTER TABLE "properties" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';
