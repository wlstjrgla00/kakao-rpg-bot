import type { GamePlayer } from "./features";

const HEAL_INTERVAL_MS = 5 * 60 * 1000;
const HEAL_AMOUNT = 10;

export function hasHpSchema(p: GamePlayer): p is GamePlayer & { player_hp: number; hp_updated_at: number } {
  return typeof p.player_hp === "number" && typeof p.hp_updated_at === "number";
}
export function maxHp(p: GamePlayer): number {
  return 100 + p.level * 10 + p.defense * 8;
}
export function attackPower(p: GamePlayer): number {
  return p.strength * 3 + p.level * 2;
}
export function critChance(p: GamePlayer): number {
  return Math.min(45, 5 + p.agility);
}
export function dodgeChance(p: GamePlayer): number {
  return Math.min(40, p.agility * 2);
}
export function defenseReduction(p: GamePlayer): number {
  return p.defense * 2;
}
export function hpText(p: GamePlayer): string {
  if (!hasHpSchema(p)) return "❤️ 체력 시스템 준비 중 (DB 0004 적용 필요)";
  const cap = maxHp(p);
  return "❤️ 체력 " + Math.min(p.player_hp, cap) + "/" + cap;
}
export function statText(p:GamePlayer): string {
  return [
    "📈 캐릭터 능력치",
    "✨ 남은 스탯 포인트: "+p.stat_points,
    "",
    "💪 힘 "+p.strength+" → 공격력 "+attackPower(p)+" (+1당 공격력 +3)",
    "🛡️ 방어 "+p.defense+" → 반격 피해 -"+defenseReduction(p)+", 최대 HP "+maxHp(p)+" (+1당 HP +8)",
    "💨 민첩 "+p.agility+" → 치명타 "+critChance(p)+"%, 회피 "+dodgeChance(p)+"% (+1당 각각 +1%p/+2%p, 상한 45%/40%)",
    hasHpSchema(p) ? hpText(p) : "⚠️ 체력·방어·회피 전투 효과는 DB 0004 적용 뒤 활성화",
    "",
    "레벨업 때마다 스탯 포인트 +1",
    "버튼을 누르면 해당 능력치에 1포인트를 투자합니다."
  ].join("\n");
}
export async function hydrateHp(db:D1Database, p:GamePlayer):Promise<GamePlayer> {
  if(!hasHpSchema(p))return p;
  const now=Date.now();
  const cap=maxHp(p);
  if (p.player_hp >= cap) return p;
  const originalStamp=p.hp_updated_at||now;
  const elapsed=Math.max(0,now-originalStamp);
  const ticks=Math.floor(elapsed/HEAL_INTERVAL_MS);
  const newHp=Math.min(cap,p.player_hp+ticks*HEAL_AMOUNT);
  const nextStamp=newHp>=cap?now:originalStamp+ticks*HEAL_INTERVAL_MS;
  if(newHp===p.player_hp && nextStamp===p.hp_updated_at)return p;
  const result=await db.prepare(
    "UPDATE players SET player_hp=?,hp_updated_at=?,version=version+1 WHERE id=? AND version=?"
  ).bind(newHp,nextStamp,p.id,p.version).run();
  if(result.meta.changes===1)return {...p,player_hp:newHp,hp_updated_at:nextStamp,version:p.version+1};
  return (await db.prepare("SELECT * FROM players WHERE id=?").bind(p.id).first<GamePlayer>())||p;
}
