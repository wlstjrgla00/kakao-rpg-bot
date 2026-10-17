-- 기존 players 테이블 및 캐릭터 데이터 보존
-- Cloudflare D1 Console에서 이 파일의 SQL을 한 번만 실행하세요.
ALTER TABLE players ADD COLUMN stamina_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN attendance_day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN last_attendance_date TEXT;
ALTER TABLE players ADD COLUMN attendance_total INTEGER NOT NULL DEFAULT 0;
