import type { GamePlayer } from "./features";

export type JobClass = "adventurer" | "warrior" | "rogue" | "mage";
export type BaseClass = Exclude<JobClass, "adventurer">;

export const ADVANCE_LEVELS = [20, 100, 500] as const;

const NAMES: Record<BaseClass, [string, string, string]> = {
  warrior: ["⚔️ 전사", "🛡️ 수호기사", "👑 전쟁군주"],
  rogue: ["🗡️ 도적", "🥷 암살자", "🌑 그림자 군주"],
  mage: ["🔮 마법사", "🪄 원소술사", "🌌 아크메이지"]
};

const SKILLS: Record<BaseClass, [string, string, string]> = {
  warrior: [
    "강철 피부: 받는 피해 10% 감소",
    "가시 방패: 피격 시 20% 확률로 받은 피해 50% 반사",
    "불굴의 의지: 전투당 1회 치명적 피해를 받으면 최대 HP의 30%로 생존"
  ],
  rogue: [
    "이중 베기: 20% 확률로 추가 공격",
    "암살 본능: 치명타 피해가 2배로 증가",
    "그림자 분신: 첫 3턴 추가 공격 확률이 50%로 증가"
  ],
  mage: [
    "파이어볼: 25% 확률로 150% 마법 피해",
    "원소 폭발: 15% 확률로 250% 마법 피해",
    "메테오: 전투 첫 공격에 300% 마법 피해 (전투당 1회)"
  ]
};

export function hasJobSchema(p: GamePlayer): boolean {
  return typeof p.job_class === "string" &&
    typeof p.job_tier === "number" &&
    typeof p.intelligence === "number";
}

export function jobClass(p: GamePlayer): JobClass {
  const j = p.job_class;
  return (j === "warrior" || j === "rogue" || j === "mage") &&
    (p.job_tier || 0) >= 1 ? j : "adventurer";
}

export function jobTier(p: GamePlayer): number {
  return jobClass(p) === "adventurer" ? 0 :
    Math.min(3, Math.max(0, p.job_tier || 0));
}

export function jobName(p: GamePlayer): string {
  const kind = jobClass(p), tier = jobTier(p);
  return kind === "adventurer" ? "🛡️ 모험가" : NAMES[kind][tier - 1];
}

export function jobInt(p: GamePlayer): number {
  return p.intelligence ?? 5;
}

export function nextPromotion(p: GamePlayer): { tier: 1 | 2 | 3; level: number } | null {
  const current = jobTier(p);
  if (current >= 3) return null;
  return { tier: (current + 1) as 1 | 2 | 3, level: ADVANCE_LEVELS[current] };
}

export function pointsAfterReset(p: GamePlayer): number {
  return p.stat_points +
    Math.max(0, p.strength - 5) +
    Math.max(0, p.defense - 5) +
    Math.max(0, p.agility - 5) +
    Math.max(0, jobInt(p) - 5);
}

export function jobSkillDescription(kind: BaseClass, tier: number): string {
  return SKILLS[kind].slice(0, Math.max(0, tier)).join("\n");
}

export function promotionPreview(p: GamePlayer, kind: BaseClass): string {
  const target = nextPromotion(p);
  if (!target) return "모든 전직을 완료했어요.";
  const name = NAMES[kind][target.tier - 1];
  return "🎓 " + target.tier + "차 전직 확인\n" +
    "직업: " + jobName(p) + " → " + name + "\n" +
    "레벨: " + p.level + " (요구 " + target.level + ")\n\n" +
    "⚠️ 스탯 초기화 안내\n" +
    "전직을 확정하면 힘·방어·민첩·지능이 모두 5로 초기화됩니다.\n" +
    "기존에 투자한 스탯 포인트는 돌려받고 미사용 포인트와 합쳐집니다.\n" +
    "✨ 초기화 후 재분배 가능: " + pointsAfterReset(p) + "P\n" +
    "❤️ 체력은 변경된 최대 HP까지 회복됩니다.\n" +
    "레벨·경험치·골드·사냥터·출석 기록은 유지됩니다.\n\n" +
    "🔓 자동 스킬\n" + jobSkillDescription(kind, target.tier) +
    "\n\n확정 후 직업 변경은 할 수 없습니다.";
}

export async function promote(db: D1Database, p: GamePlayer, kind: BaseClass): Promise<{
  ok: boolean; message: string
}> {
  if (!hasJobSchema(p) || typeof p.player_hp !== "number") {
    return {ok:false, message:"⚠️ 전직 기능을 사용하려면 운영 D1 DB에 0005 전직 마이그레이션을 적용해야 합니다."};
  }
  const next = nextPromotion(p);
  if (!next) return {ok:false, message:"✅ 이미 3차 전직까지 완료했습니다."};
  if (p.level < next.level) {
    return {ok:false, message:"🔒 " + next.tier + "차 전직은 Lv." + next.level + "부터 가능합니다. 현재 Lv." + p.level};
  }
  const currentClass = jobClass(p);
  if (next.tier > 1 && kind !== currentClass) {
    return {ok:false, message:"⚠️ 2·3차 전직은 기존 계열만 승급할 수 있어요."};
  }
  const points = pointsAfterReset(p);
  const maxResetHp = 100 + p.level * 10 + 5 * 8;
  // Reset stats and grant all previously invested points in one atomic UPDATE.
  // WHERE job_tier + version prevents double promotion and duplicate point refunds.
  const result = await db.prepare(
    "UPDATE players SET job_class=?,job_tier=?,strength=5,defense=5,agility=5," +
    "intelligence=5,stat_points=?,player_hp=?,hp_updated_at=?," +
    "version=version+1 WHERE id=? AND version=? AND job_tier=? AND level>=?"
  ).bind(
    kind, next.tier, points, maxResetHp, Date.now(),
    p.id, p.version, next.tier - 1, next.level
  ).run();
  if (result.meta.changes !== 1) {
    return {ok:false, message:"⏳ 전직 상태가 변경되었습니다. '전직' 명령으로 확인해 주세요."};
  }
  return {
    ok:true,
    message:"🎉 " + next.tier + "차 전직 성공!\n" +
      NAMES[kind][next.tier - 1] + "이(가) 되었습니다!\n\n" +
      "♻️ 스탯 초기화 완료\n" +
      "💪 힘 5 | 🛡️ 방어 5 | 💨 민첩 5 | 🧠 지능 5\n" +
      "✨ 다시 분배할 스탯 포인트: " + points + "P\n" +
      "❤️ HP " + maxResetHp + "/" + maxResetHp + "\n\n" +
      "🔓 해금 스킬\n" + jobSkillDescription(kind, next.tier) +
      "\n\n'스탯'에서 원하는 능력치를 다시 찍어 주세요!"
  };
}
