-- 0007: Three gear slots + five types. Run AFTER 0006.
-- Existing single-type equipment becomes swords; rarity and enhancement stay intact.
UPDATE equipment
SET item_name=CASE rarity
  WHEN 'rare' THEN '청명의 강철검'
  WHEN 'epic' THEN '흑염의 마검'
  WHEN 'legendary' THEN '뇌신의 심판검'
  WHEN 'mythic' THEN '태초를 가르는 천상검'
  ELSE '낡은 철검'
END, item_code='sword'
WHERE item_code='single';

-- Replace the previous one-item index with one UNIQUE index per slot.
DROP INDEX IF EXISTS idx_equipment_single_slot;
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_weapon_slot
ON equipment(player_id) WHERE equipped=1 AND item_code IN ('sword','dagger','staff');
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_armor_slot
ON equipment(player_id) WHERE equipped=1 AND item_code='armor';
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_ring_slot
ON equipment(player_id) WHERE equipped=1 AND item_code='ring';
