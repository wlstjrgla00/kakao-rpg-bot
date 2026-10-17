import type { GamePlayer } from "./features";
import { attackPower, critChance, dodgeChance, defenseReduction, maxHp } from "./stats";
import { jobClass, jobTier, jobInt } from "./jobs";

export interface Monster {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
}
export interface BattleResult {
  victory: boolean;
  rounds: number;
  dealt: number;
  taken: number;
  remainingHeroHp: number;
  remainingMonsterHp: number;
  criticalHits: number;
  dodges: number;
  logs: string[];
}
export type RandomGenerator = () => number;

// One Kakao skill call resolves all combat turns. The surviving monster's HP
// is returned to the caller for durable persistence, even after player defeat.
export function resolveFight(
  p: GamePlayer & { player_hp: number },
  monster: Monster,
  random: RandomGenerator = Math.random
): BattleResult {
  let monsterHp = Math.max(1, Math.min(Math.max(1, monster.maxHp), Math.floor(monster.hp)));
  let heroHp = Math.max(1, Math.floor(p.player_hp));
  let dealt = 0, taken = 0, criticalHits = 0, dodges = 0, rounds = 0;
  let revived = false;
  const kind = jobClass(p);
  const tier = jobTier(p);
  const logs: string[] = [];
  for (let round = 1; round <= 1000; round++) {
    rounds = round;
    const bonus = Math.floor(random() * 7) - 3;
    const crit = random() * 100 < critChance(p);
    if (crit) criticalHits++;
    const raw = Math.max(1, attackPower(p) + bonus);
    const magic = Math.max(1, attackPower(p) + Math.max(0, jobInt(p) - 5) * 4);
    let attack = crit ? Math.floor(raw * (kind === "rogue" && tier >= 2 ? 2 : 1.5)) : raw;
    const skills: string[] = [];
    if (kind === "mage") {
      if (tier >= 3 && round === 1) {
        attack += magic * 3; skills.push("🌠 메테오");
      } else if (tier >= 2 && random() < 0.15) {
        attack += Math.floor(magic * 2.5); skills.push("⚡ 원소 폭발");
      } else if (tier >= 1 && random() < 0.25) {
        attack += Math.floor(magic * 1.5); skills.push("🔥 파이어볼");
      }
    } else if (kind === "rogue" && tier >= 1) {
      const chance = tier >= 3 && round <= 3 ? 0.5 : 0.2;
      if (random() < chance) {
        attack += raw; skills.push(tier >= 3 && round <= 3 ? "🌑 그림자 분신" : "🗡️ 이중 베기");
      }
    }
    const inflicted = Math.min(monsterHp, attack);
    monsterHp -= inflicted;
    dealt += inflicted;
    const log = "⚔️ " + round + "턴: +" + inflicted + " 피해" +
      (crit ? " 💥" : "") + (skills.length ? " [" + skills.join(", ") + "]" : "");
    if (monsterHp === 0) {
      logs.push(log + " → 몬스터 처치!");
      break;
    }

    const dodged = random() * 100 < dodgeChance(p);
    let received = 0;
    if (dodged) {
      dodges++;
    } else {
      const base = Math.max(0, Math.ceil(6 + monster.level * 1.6) - defenseReduction(p));
      received = kind === "warrior" && tier >= 1 ? Math.ceil(base * 0.9) : base;
      received = Math.min(heroHp, received);
      heroHp -= received;
      taken += received;
      if (kind === "warrior" && tier >= 2 && received > 0 && random() < 0.2) {
        const reflect = Math.min(monsterHp, Math.max(1, Math.floor(received * 0.5)));
        monsterHp -= reflect;
        dealt += reflect;
        skills.push("🛡️ 가시 방패 반사 " + reflect);
      }
    }
    if (heroHp === 0 && kind === "warrior" && tier >= 3 && !revived) {
      heroHp = Math.max(1, Math.ceil(maxHp(p) * 0.3));
      revived = true;
      skills.push("👑 불굴의 의지 부활");
    }
    let turnLog = log + " / 반격 " + (dodged ? "회피" : received + " 피해");
    if (skills.some(x => x.includes("가시 방패") || x.includes("불굴의"))) {
      turnLog += " [" + skills.filter(x => x.includes("가시 방패") || x.includes("불굴의")).join(", ") + "]";
    }
    if (monsterHp === 0) {
      logs.push(turnLog + " → 반사 피해로 처치!");
      break;
    }
    if (heroHp === 0) {
      logs.push(turnLog + " → 전투 불능");
      break;
    }
    if (round === 1000) {
      heroHp = 0;
      logs.push(turnLog + " → 장기전 탈진");
      break;
    }
    if (round <= 3) logs.push(turnLog);
  }
  return {
    victory: monsterHp === 0 && heroHp > 0,
    rounds, dealt, taken,
    remainingHeroHp: heroHp,
    remainingMonsterHp: monsterHp,
    criticalHits, dodges, logs
  };
}
