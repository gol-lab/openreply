-- Strict follow gate: links are released only on a confirmed follow.

-- CreateEnum
CREATE TYPE "FollowCheckResult" AS ENUM ('FOLLOWS', 'NOT_FOLLOWING', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "followGateStrict" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "followNotFollowingMessage" TEXT,
ADD COLUMN     "followUnknownMessage" TEXT,
ADD COLUMN     "profileButtonLabel" TEXT,
ADD COLUMN     "publicReplyAfterDm" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FollowCheck" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "result" "FollowCheckResult" NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FollowCheck_automationId_result_idx" ON "FollowCheck"("automationId", "result");

-- CreateIndex
CREATE INDEX "FollowCheck_automationId_userId_idx" ON "FollowCheck"("automationId", "userId");

-- CreateIndex
CREATE INDEX "FollowCheck_workspaceId_idx" ON "FollowCheck"("workspaceId");

-- AddForeignKey
ALTER TABLE "FollowCheck" ADD CONSTRAINT "FollowCheck_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
