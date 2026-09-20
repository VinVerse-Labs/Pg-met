-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('SINGLE', 'DOUBLE', 'TRIPLE', 'FOUR', 'DORMITORY', 'OTHER');

-- AlterEnum
BEGIN;
CREATE TYPE "BedStatus_new" AS ENUM ('AVAILABLE', 'INACTIVE', 'ARCHIVED');
ALTER TABLE "beds" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "beds" ALTER COLUMN "status" TYPE "BedStatus_new" USING ("status"::text::"BedStatus_new");
ALTER TYPE "BedStatus" RENAME TO "BedStatus_old";
ALTER TYPE "BedStatus_new" RENAME TO "BedStatus";
DROP TYPE "BedStatus_old";
ALTER TABLE "beds" ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';
COMMIT;

-- AlterEnum
ALTER TYPE "RoomStatus" ADD VALUE 'ARCHIVED';

-- DropIndex
DROP INDEX "beds_roomId_label_key";

-- DropIndex
DROP INDEX "rooms_propertyId_name_key";

-- AlterTable
ALTER TABLE "beds" DROP COLUMN "label",
ADD COLUMN     "bedNumber" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'AVAILABLE';

-- AlterTable
ALTER TABLE "rooms" DROP COLUMN "name",
ADD COLUMN     "capacity" INTEGER NOT NULL,
ADD COLUMN     "roomNumber" TEXT NOT NULL,
ADD COLUMN     "roomType" "RoomType" NOT NULL;

-- CreateIndex
CREATE INDEX "beds_roomId_status_idx" ON "beds"("roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "beds_roomId_bedNumber_key" ON "beds"("roomId", "bedNumber");

-- CreateIndex
CREATE INDEX "rooms_propertyId_status_idx" ON "rooms"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_propertyId_roomNumber_key" ON "rooms"("propertyId", "roomNumber");

