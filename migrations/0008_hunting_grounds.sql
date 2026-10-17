-- Apply once after 0007. Existing characters, loot, stages and monsters remain untouched.
-- "auto" selects the highest hunting ground unlocked for the player's level.
ALTER TABLE players ADD COLUMN hunting_ground TEXT NOT NULL DEFAULT 'auto';
