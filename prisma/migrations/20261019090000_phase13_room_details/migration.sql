-- CreateEnum
CREATE TYPE "RoomAmenity" AS ENUM ('AC', 'WIFI', 'TV', 'FAN', 'ALMARI', 'STUDY_TABLE', 'ATTACHED_WASHROOM', 'GEYSER', 'BALCONY');

-- CreateEnum
CREATE TYPE "BedBerth" AS ENUM ('LOWER', 'UPPER');

-- AlterTable
ALTER TABLE "beds" ADD COLUMN     "berth" "BedBerth";

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "amenities" "RoomAmenity"[] DEFAULT ARRAY[]::"RoomAmenity"[],
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "pricePerBed" DECIMAL(12,2);
