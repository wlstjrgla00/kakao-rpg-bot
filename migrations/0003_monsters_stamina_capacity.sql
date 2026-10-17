-- Apply ONCE in D1 Console after 0002_attendance_stamina.sql.
-- Keeps user IDs, levels, experience, gold, stats and attendance history.
ALTER TABLE players ADD COLUMN stamina_max INTEGER NOT NULL DEFAULT 100;
ALTER TABLE players ADD COLUMN monster_name TEXT;
ALTER TABLE players ADD COLUMN monster_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN monster_hp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN monster_max_hp INTEGER NOT NULL DEFAULT 0;

-- One-time refill to the new basic cap on upgrade (existing characters included).
-- Permanent bonuses are earned prospectively on the next completed day-7 streak.
UPDATE players SET stamina=100 WHERE stamina_max=100;
