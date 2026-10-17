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
}

const STAMINA_CAP = 20;
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
  const heading = "⚡ 스태미나 " + p.stamina + "/" + STAMINA_CAP;
  if (p.stamina >= STAMINA_CAP || !hasDailySchema(p) || !p.stamina_updated_at) {
    return heading;
  }
  const remaining = Math.max(0, REGEN_INTERVAL_MS - (now - p.stamina_updated_at) % REGEN_INTERVAL_MS);
  const minutes = Math.floor(Math.ceil(remaining / 1000) / 60);
  const seconds = Math.ceil(remaining / 1000) % 60;
  return heading + "\n⏳ 다음 회복까지 " + minutes + "분 " + seconds + "초 (10분마다 +1)";
}

// Lazy regeneration: no scheduled jobs are required, and existing players
// keep their balance. A version check prevents overwriting newer game state.
export async function hydrateStamina(db: D1Database, p: GamePlayer): Promise<GamePlayer> {
  if (!hasDailySchema(p)) return p; // Existing game remains usable until migration 0002.
  const now = Date.now();
  const start = p.stamina_updated_at || now;
  if (p.stamina >= STAMINA_CAP && p.stamina_updated_at) return p;
  const gained = p.stamina >= STAMINA_CAP ? 0 :
    Math.floor(Math.max(0, now - start) / REGEN_INTERVAL_MS);
  const nextStamina = Math.min(STAMINA_CAP, p.stamina + gained);
  const nextStamp = nextStamina >= STAMINA_CAP ? now :
    start + gained * REGEN_INTERVAL_MS;
  if (nextStamina === p.stamina && nextStamp === p.stamina_updated_at) return p;
  const result = await db.prepare(
    "UPDATE players SET stamina=?, stamina_updated_at=?, version=version+1 WHERE id=? AND version=?"
  ).bind(nextStamina, nextStamp, p.id, p.version).run();
  if (result.meta.changes === 1) {
    return { ...p, stamina: nextStamina, stamina_updated_at: nextStamp, version: p.version + 1 };
  }
  const fresh = await db.prepare("SELECT * FROM players WHERE id=?").bind(p.id).first<GamePlayer>();
  return fresh || p;
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
    "\n총 출석 " + p.attendance_total + "회\n\n🎁 일차별 보상\n" + schedule +
    "\n\n한국시간 00:00에 갱신, 하루 건너뛰면 1일차로 초기화\n7일차 완료 뒤 다음 날 다시 1일차";
}

export async function claimAttendance(db: D1Database, p: GamePlayer): Promise<string> {
  if (!hasDailySchema(p)) return "⚠️ 출석 기능을 사용하려면 D1 DB 업데이트(0002)를 먼저 적용해 주세요.";
  const today = koreaDate();
  const prev = p.last_attendance_date || "";
  if (prev === today) return "✅ 오늘은 이미 출석했어요!\n내일 00:00(한국시간)에 다시 출석할 수 있어요.\n" + staminaText(p);
  const next = prev === yesterdayOf(today) ? (p.attendance_day % 7) + 1 : 1;
  const gold = GOLD_REWARDS[next - 1];
  const staminaReward = STAMINA_REWARDS[next - 1];
  const staminaGain = Math.min(STAMINA_CAP - p.stamina, staminaReward);
  const now = Date.now();
  // Claim metadata + both rewards are committed atomically in a single UPDATE.
  // Optimistic locking plus the date predicate prevents duplicate rewards.
  const query = "UPDATE players SET gold=gold+?, stamina=MIN(20,stamina+?), " +
    "attendance_day=?,last_attendance_date=?,attendance_total=attendance_total+1," +
    "stamina_updated_at=CASE WHEN stamina+?>=20 THEN ? ELSE stamina_updated_at END," +
    "version=version+1 WHERE id=? AND version=? AND " +
    "(last_attendance_date IS NULL OR last_attendance_date<>?)";
  const result = await db.prepare(query).bind(
    gold, staminaReward, next, today, staminaReward, now, p.id, p.version, today
  ).run();
  if (result.meta.changes !== 1) {
    return "⏳ 출석 상태가 변경됐어요. 출석현황을 확인하고 다시 시도해 주세요.";
  }
  return "🎉 " + next + "일차 출석 완료!\n" +
    "💰 골드 +" + gold.toLocaleString() + "G\n" +
    "⚡ 스태미나 +" + staminaGain + " (" + (p.stamina + staminaGain) + "/20)\n" +
    (staminaGain < staminaReward ? "ℹ️ 스태미나는 최대 20까지만 받을 수 있어요.\n" : "") +
    (next === 7 ? "🏆 7일 연속 달성! 내일부터 새 주기가 시작돼요." :
      "📅 내일은 " + (next + 1) + "일차 보상!") +
    "\n한국시간 자정 이후 다음 출석 가능";
}
