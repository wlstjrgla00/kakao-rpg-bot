-- Apply once after the existing migrations. Existing equipment table from 0001 is reused.
-- Enforce exactly one equipped item per character.
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_single_slot
ON equipment(player_id) WHERE equipped = 1;

-- Speed up inventory listing and equipped gear queries.
CREATE INDEX IF NOT EXISTS idx_equipment_player_recent
ON equipment(player_id, id DESC);
