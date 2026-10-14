-- "Next post or reel" counts from when it was switched on, not from creation.
ALTER TABLE "Automation" ADD COLUMN "pendingNextSince" TIMESTAMP(3);
