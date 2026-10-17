import type { GamePlayer } from "./features";
import { attackPower, critChance, dodgeChance, defenseReduction } from "./stats";

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

/**
 * A whole fight runs synchronously on the server in one Kakao skill request.
 * Normal fights finish in a few rounds. On extreme inputs, exhaustion causes
 * defeat after 1000 rounds so no request can loop indefinitely.
 */
export function resolveFight(
  p: GamePlayer & { player_hp: number },
  monster: Monster,
  random: RandomGenerator = Math.random
): BattleResult {
  const monsterMax = Math.max(1, Math.floor(monster.maxHp));
  let monsterHp = Math.max(1, Math.min(monsterMax, Math.floor(monster.hp)));
  let heroHp = Math.max(1, Math.floor(p.player_hp));
  let dealt = 0, taken = 0, criticalHits = 0, dodges = 0, rounds = 0;
  const logs: string[] = [];
  for (let round = 1; round <= 1000; round++) {
    rounds = round;
    const bonus = Math.floor(random() * 7) - 3;
    const crit = random() * 100 < critChance(p);
    const raw = Math.max(1, attackPower(p) + bonus);
    const inflicted = Math.min(monsterHp, crit ? Math.floor(raw * 1.5) : raw);
    if (crit) criticalHits++;
    dealt += inflicted;
    monsterHp -= inflicted;
    if (monsterHp === 0) {
      logs.push("⚔️ " + round + "턴: " + inflicted + " 피해 · 몬스터 처치!");
      break;
    }
    const dodge = random() * 100 < dodgeChance(p);
    let received = 0;
    if (dodge) {
      dodges++;
    } else {
      // Guarantee eventual risk against strong monsters without invalidating
      // defense scaling. A sufficiently armored low-level hero may take 0.
      received = Math.max(0, Math.ceil(6 + monster.level * 1.6) - defenseReduction(p));
      received = Math.min(heroHp, received);
      heroHp -= received;
      taken += received;
    }
    if (round <= 3) {
      logs.push("⚔️ " + round + "턴: +" + inflicted + " 피해" + (crit ? " 💥" : "") +
        " / 반격 " + (dodge ? "회피" : received + " 피해"));
    }
    if (heroHp === 0) {
      logs.push("💀 " + round + "턴: 전투 불능");
      break;
    }
    if (round === 1000) {
      heroHp = 0;
      logs.push("💀 장기전으로 탈진하여 패배했습니다.");
    }
  }
  return {
    victory: monsterHp === 0 && heroHp > 0,
    rounds, dealt, taken,
    remainingHeroHp: heroHp,
    remainingMonsterHp: monsterHp,
    criticalHits, dodges, logs
  };
}
