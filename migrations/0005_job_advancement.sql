-- Run once after 0004_player_hp.sql
ALTER TABLE players ADD COLUMN job_class TEXT NOT NULL DEFAULT 'adventurer';
ALTER TABLE players ADD COLUMN job_tier INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN intelligence INTEGER NOT NULL DEFAULT 5;
