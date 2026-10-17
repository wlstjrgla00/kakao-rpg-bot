export interface GamePlayer {
  id: number;
  nickname: string;
  level: number;
  exp: number;
  gold: number;
  strength: number;
  defense: number;
  agility: number;
  stat_points: number;
  stamina: number;
  stage: number;
  last_hunt_at: number;
  version: number;
  stamina_updated_at?: number;
  attendance_day?: number;
  attendance_total?: number;
  last_attendance_date?: string | null;
  stamina_max?: number;
  monster_name?: string | null;
  monster_level?: number;
  monster_hp?: number;
  monster_max_hp?: number;
  player_hp?: number;
  hp_updated_at?: number;
}

const STAMINA_CAP = 100;
export function staminaCap(p: GamePlayer): number {
  return Math.max(STAMINA_CAP, Math.floor(p.stamina_max || STAMINA_CAP));
}
export function hasMonsterSchema(p: GamePlayer): boolean {
  return typeof p.stamina_max === "number" &&
    typeof p.monster_level === "number" &&
    typeof p.monster_hp === "number" &&
    typeof p.monster_max_hp === "number";
}
const REGEN_INTERVAL_MS = 10 * 60 * 1000;
const GOLD_REWARDS = [100, 200, 300, 400, 500, 700, 1200];
const STAMINA_REWARDS = [3, 3, 4, 4, 5, 5, 10];

type UpgradedPlayer = GamePlayer & {
  stamina_updated_at: number;
  attendance_day: number;
  attendance_total: number;
};

export function hasDailySchema(p: GamePlayer): p is UpgradedPlayer {
  return typeof p.stamina_updated_at === "number" &&
    typeof p.attendance_day === "number" &&
    typeof p.attendance_total === "number";
}

// Convert to Korea Standard Time without depending on the client's timezone.
export function koreaDate(now = Date.now()): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function yesterdayOf(date: string): string {
  return new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
}

export function staminaText(p: GamePlayer, now = Date.now()): string {
  const cap = staminaCap(p);
  const heading = "⚡ 스태미나 " + p.stamina + "/" + cap;
  if (p.stamina >= cap || !hasDailySchema(p) || !p.stamina_updated_at) {
    return heading;
  }
  const elapsed = Math.max(0, now - p.stamina_updated_at);
  const remaining = REGEN_INTERVAL_MS - (elapsed % REGEN_INTERVAL_MS);
  const secs = Math.ceil(remaining / 1000);
  return heading + "\n⏳ 다음 회복까지 " +
    Math.floor(secs / 60) + "분 " + (secs % 60) + "초 (10분마다 +1)";
}

// Lazy recovery: existing players keep their HP, gold, equipment and attendance.
export async function hydrateStamina(db: D1Database, p: GamePlayer): Promise<GamePlayer> {
  if (!hasDailySchema(p)) return p;
  const cap = staminaCap(p);
  const now = Date.now();
  const start = p.stamina_updated_at || now;
  if (p.stamina >= cap && p.stamina_updated_at) return p;
  const gained = p.stamina >= cap ? 0 :
    Math.floor(Math.max(0, now - start) / REGEN_INTERVAL_MS);
  const nextStamina = Math.min(cap, p.stamina + gained);
  const nextStamp = nextStamina >= cap ? now :
    start + gained * REGEN_INTERVAL_MS;
  if (nextStamina === p.stamina && nextStamp === p.stamina_updated_at) return p;
  const result = await db.prepare(
    "UPDATE players SET stamina=?, stamina_updated_at=?, version=version+1 WHERE id=? AND version=?"
  ).bind(nextStamina, nextStamp, p.id, p.version).run();
  if (result.meta.changes === 1) {
    return { ...p, stamina: nextStamina, stamina_updated_at: nextStamp, version: p.version + 1 };
  }
  return (await db.prepare("SELECT * FROM players WHERE id=?").bind(p.id).first<GamePlayer>()) || p;
}

export function attendanceInfo(p: GamePlayer): string {
  if (!hasDailySchema(p)) return "⚠️ 출석 시스템 준비 중입니다.\n관리자가 DB 업데이트(0002)를 적용해야 합니다.";
  const today = koreaDate();
  const last = p.last_attendance_date || "";
  const current = last === today || last === yesterdayOf(today) ? p.attendance_day : 0;
  const claimed = last === today;
  const next = (current % 7) + 1;
  const progress = Array.from({ length: 7 }, (_, i) => {
    const checked = i + 1 <= current;
    return (checked ? "✅" : "⬜") + (i + 1) + "일";
  }).join(" ");
  const schedule = GOLD_REWARDS.map((g, i) =>
    (i + 1) + "일: " + g.toLocaleString() + "G / ⚡+" + STAMINA_REWARDS[i]
  ).join("\n");
  return "📅 7일 연속 출석\n" + progress +
    "\n" + (claimed ? "✅ 오늘 출석 완료! 내일 다시 받아요." : "🎁 오늘 받을 보상: " + next + "일차") +
    "\n영구 최대 스태미나: " + staminaCap(p) + "\n총 출석 " + p.attendance_total + "회\n\n🎁 일차별 보상\n" + schedule +
    "\n\n한국시간 00:00에 갱신, 하루 건너뛰면 1일차로 초기화\n7일차 완료 시 최대 스태미나 영구 +10, 다음 날 다시 1일차";
}

export async function claimAttendance(db: D1Database, p: GamePlayer): Promise<string> {
  if (!hasDailySchema(p)) return "⚠️ 먼저 D1 업데이트(0002)를 적용해 주세요.";
  if (!hasMonsterSchema(p)) return "⚠️ 먼저 D1 업데이트(0003)를 적용해야 영구 스태미나 보너스를 받을 수 있어요.";
  const today = koreaDate();
  const prev = p.last_attendance_date || "";
  if (prev === today) return "✅ 오늘은 이미 출석했어요!\n내일 00:00(한국시간)에 다시 출석하세요.\n" + staminaText(p);
  const day = prev === yesterdayOf(today) ? (p.attendance_day % 7) + 1 : 1;
  const gold = GOLD_REWARDS[day - 1];
  const staminaReward = STAMINA_REWARDS[day - 1];
  const bonusMax = day === 7 ? 10 : 0;
  const oldCap = staminaCap(p);
  const newCap = oldCap + bonusMax;
  const received = Math.max(0, Math.min(newCap - p.stamina, staminaReward));
  const newStamina = p.stamina + received;
  const now = Date.now();
  // One atomic UPDATE prevents duplicate daily claims and keeps permanent cap increments durable.
  const sql = "UPDATE players SET gold=gold+?," +
    "stamina=MIN(stamina_max+?, stamina+?)," +
    "stamina_max=stamina_max+?," +
    "attendance_day=?,last_attendance_date=?,attendance_total=attendance_total+1," +
    "stamina_updated_at=CASE WHEN stamina+?>=stamina_max+? THEN ? " +
    "WHEN stamina_updated_at=0 THEN ? ELSE stamina_updated_at END," +
    "version=version+1 WHERE id=? AND version=? " +
    "AND (last_attendance_date IS NULL OR last_attendance_date<>?)";
  const result = await db.prepare(sql).bind(
    gold, bonusMax, staminaReward, bonusMax,
    day, today, staminaReward, bonusMax, now, now,
    p.id, p.version, today
  ).run();
  if (result.meta.changes !== 1) {
    return "⏳ 출석 상태가 변경됐어요. 출석현황을 확인해 주세요.";
  }
  return "🎉 " + day + "일차 출석 완료!\n" +
    "💰 골드 +" + gold.toLocaleString() + "G\n" +
    "⚡ 스태미나 +" + received + " (" + newStamina + "/" + newCap + ")\n" +
    (bonusMax ? "🏆 최대 스태미나 영구 +10! (" + oldCap + " → " + newCap + ")\n" : "") +
    (received < staminaReward ? "ℹ️ 스태미나는 최대치까지만 지급돼요.\n" : "") +
    (day === 7 ? "📅 내일부터 다시 1일차! 7일 달성마다 영구 +10\n" :
      "📅 내일은 " + (day + 1) + "일차 보상!\n") +
    "한국시간 00:00부터 다음 출석 가능";
}
