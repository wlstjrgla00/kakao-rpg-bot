-- Run once after migration 0003; preserves existing characters and stats.
ALTER TABLE players ADD COLUMN player_hp INTEGER NOT NULL DEFAULT 150;
ALTER TABLE players ADD COLUMN hp_updated_at INTEGER NOT NULL DEFAULT 0;
-- Existing characters start fully healed based on their current level and defense.
UPDATE players SET player_hp=100+level*10+defense*8,
  hp_updated_at=CAST(strftime('%s','now') AS INTEGER)*1000;
