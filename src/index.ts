import {
  type GamePlayer, hydrateStamina, hasDailySchema, hasMonsterSchema, staminaText,
  attendanceInfo, claimAttendance, staminaCap
} from "./features";
import { hasHpSchema, hpText, maxHp, statText, hydrateHp } from "./stats";
import { resolveFight } from "./combat";
import { MONSTER_IMAGES } from "./monster-images";

interface Env {
  DB: D1Database;
  EXPECTED_BOT_ID: string;
  KAKAO_SKILL_KEY: string;
}
type Player = GamePlayer;
type KakaoPayload = {
  bot?: { id?: string };
  userRequest?: { user?: { id?: string }, utterance?: string };
};
const actions = ["게임시작", "내정보", "사냥", "탐험", "사냥터", "출석", "출석현황", "휴식", "회복", "스탯", "힘 올리기", "방어 올리기", "민첩 올리기", "랭킹", "도움말"];

type MonsterCard = {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  stage: number;
  cleared?: boolean;
};
const MONSTER_DESCRIPTIONS: Record<string, string> = {
  slime: "작고 말랑한 몬스터. 방심하면 몸을 던져 공격합니다.",
  goblin: "동굴을 지키는 고블린 전사. 날카로운 무기에 주의하세요.",
  wolf: "먹잇감을 노리는 야생 늑대. 빠른 발톱을 조심하세요.",
  skeleton: "오래된 갑옷을 걸친 암흑 해골. 쉬지 않고 덤벼듭니다.",
  golem: "단단한 마력 골렘. 강력한 일격을 견뎌내야 합니다.",
  knight: "어둠의 힘을 품은 심연의 기사. 강력한 적입니다."
};
function monsterCard(monster: MonsterCard) {
  const slug = monsterSlug(monster.name);
  const name = monster.name.replace(/^[^가-힣A-Za-z]+/, "").trim();
  const statusText = monster.cleared
    ? "✅ 몬스터 퇴치 완료"
    : "❤️ 몬스터 HP: " + monster.hp + "/" + monster.maxHp;
  return {
    basicCard: {
      title: "Lv." + monster.level + " " + name,
      description:
        "🗺️ 스테이지 " + monster.stage + " · 등급: 일반\n" +
        statusText + "\n" +
        MONSTER_DESCRIPTIONS[slug],
      thumbnail: {
        imageUrl: "https://kakao-rpg-bot.bongham.workers.dev/monsters/" + slug + ".jpg",
        altText: name + " 몬스터 그림",
        width: 800, height: 800,
        fixedRatio: true
      },
      buttonLayout: "horizontal",
      buttons: [
        { label: "휴식", action: "message", messageText: "휴식" },
        // Reuse existing '사냥' block; no extra '탐험' block required.
        { label: "탐험", action: "message", messageText: "사냥" }
      ]
    }
  };
}
function response(
  text: string,
  quick = ["사냥", "사냥터", "회복", "내정보", "스탯", "휴식"],
  monster?: MonsterCard
) {
  // Present battle summary above the image card and its action buttons.
  const outputs: any[] = [{ simpleText: { text: text.slice(0, 950) } }];
  if (monster) outputs.push(monsterCard(monster));
  return Response.json({
    version: "2.0",
    template: {
      outputs,
      quickReplies: quick.map(label => ({ label, action: "message", messageText: label }))
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
function expNeeded(level: number) { return level * 100; }
function expProgress(level: number, exp: number) {
  const target = expNeeded(level);
  const percentage = Math.min(100, Math.max(0, exp / target * 100));
  return "⭐ Lv." + level + " 경험치 " + exp + "/" + target +
    " (" + percentage.toFixed(1) + "%)";
}
function calcProgress(p: Player, gainedExp: number) {
  let level = p.level, exp = p.exp + gainedExp, points = 0;
  while (exp >= expNeeded(level) && level < 1000) {
    exp -= expNeeded(level); level++; points++;
  }
  return { level, exp, points };
}
async function load(db: D1Database, botId: string, userKey: string) {
  return db.prepare("SELECT * FROM players WHERE bot_id=? AND bot_user_key=?")
    .bind(botId, userKey).first<Player>();
}
function info(p: Player) {
  return `🛡️ ${p.nickname}\n레벨 ${p.level} | 경험치 ${p.exp}/${expNeeded(p.level)} (${(p.exp/expNeeded(p.level)*100).toFixed(1)}%)\n💰 ${p.gold.toLocaleString()}G | ${staminaText(p)}\n${hpText(p)}\n💪 힘 ${p.strength} | 🛡️ 방어 ${p.defense} | 💨 민첩 ${p.agility}\n✨ 남은 스탯포인트 ${p.stat_points}\n🗺️ 진행 스테이지 ${p.stage}`;
}
type Monster = { name: string; level: number; hp: number; maxHp: number };

const MONSTERS = ["🟢 슬라임", "👺 숲 고블린", "🐺 야생 늑대", "💀 암흑 해골", "🪨 마력 골렘", "⚔️ 심연의 기사"];

function makeMonster(stage: number, playerLevel: number): Monster {
  const level = Math.max(1, Math.round((stage + playerLevel) / 2));
  const hp = 30 + level * 9 + stage * 3;
  return {
    name: MONSTERS[(Math.max(1, stage) - 1) % MONSTERS.length],
    level, hp, maxHp: hp
  };
}
function currentMonster(p: Player): Monster | null {
  if (!p.monster_name || !p.monster_hp || !p.monster_max_hp || !p.monster_level) return null;
  return { name: p.monster_name, hp: p.monster_hp, maxHp: p.monster_max_hp, level: p.monster_level };
}
const MONSTER_SLUGS = ["slime","goblin","wolf","skeleton","golem","knight"];
function monsterSlug(name: string): string {
  const index = MONSTERS.indexOf(name);
  return MONSTER_SLUGS[index < 0 ? 0 : index];
}
function monsterView(m: Monster): string {
  return "👹 " + m.name + " | Lv." + m.level +
    "\n❤️ 몬스터 HP: " + m.hp + "/" + m.maxHp;
}
async function spawnMonster(db: D1Database, p: Player): Promise<Player> {
  if (currentMonster(p)) return p;
  const mob = makeMonster(p.stage, p.level);
  const result = await db.prepare(
    "UPDATE players SET monster_name=?,monster_level=?,monster_hp=?,monster_max_hp=?," +
    "version=version+1 WHERE id=? AND version=? AND (monster_hp<=0 OR monster_name IS NULL)"
  ).bind(mob.name, mob.level, mob.hp, mob.maxHp, p.id, p.version).run();
  if (result.meta.changes === 1) return {
    ...p, monster_name: mob.name, monster_level: mob.level, monster_hp: mob.hp,
    monster_max_hp: mob.maxHp, version: p.version + 1
  };
  return (await db.prepare("SELECT * FROM players WHERE id=?").bind(p.id).first<Player>()) || p;
}
async function monsterBattle(
  db: D1Database, p: Player, nowMs: number
): Promise<{ text: string; monster?: MonsterCard }> {
  const mob = currentMonster(p) || makeMonster(p.stage, p.level);
  if (!hasHpSchema(p)) {
    return {
      text: "⚠️ 자동 전투는 플레이어 HP가 필요해요.\nD1 0004_player_hp.sql을 적용해 주세요.",
    };
  }
  // One skill call simulates the full fight until either combatant reaches zero HP.
  const fight = resolveFight({ ...p, player_hp: p.player_hp }, mob);
  const won = fight.victory;
  const gold = won ? 20 + p.stage * 5 : 0;
  const earnedExp = won ? 30 + p.stage * 6 : 0;
  const progress = calcProgress(p, earnedExp);
  const nextStage = p.stage + (won ? 1 : 0);
  // Loss resets current monster's HP for the next encounter.
  const nextMob = won ? makeMonster(nextStage, progress.level) :
    { ...mob, hp: mob.maxHp };
  const updatedStamp = p.stamina >= staminaCap(p) ? nowMs : (p.stamina_updated_at || nowMs);
  const nextHpAt = fight.taken > 0 ? nowMs : (p.hp_updated_at || nowMs);
  const sql =
    "UPDATE players SET stamina=stamina-1,gold=gold+?,level=?,exp=?," +
    "stat_points=stat_points+?,stage=?,monster_name=?,monster_level=?," +
    "monster_hp=?,monster_max_hp=?,stamina_updated_at=?," +
    "player_hp=?,hp_updated_at=?,last_hunt_at=?,version=version+1 " +
    "WHERE id=? AND version=? AND stamina>=1 AND last_hunt_at<=?";
  const result = await db.prepare(sql).bind(
    gold,progress.level,progress.exp,progress.points,nextStage,
    nextMob.name,nextMob.level,nextMob.hp,nextMob.maxHp,updatedStamp,
    fight.remainingHeroHp,nextHpAt,nowMs,p.id,p.version,nowMs-1000
  ).run();
  if (result.meta.changes !== 1) {
    return {
      text: "⏳ 전투 기록이 갱신되었어요. 잠시 후 다시 시도해 주세요.",
    };
  }
  const after: Player = {
    ...p, stamina: p.stamina - 1, stamina_updated_at: updatedStamp,
    player_hp: fight.remainingHeroHp, hp_updated_at: nextHpAt,
    level: progress.level, exp: progress.exp
  };
  const combatLines = fight.logs.length === 4 && fight.rounds > 4
    ? [
        ...fight.logs.slice(0, 3),
        "… 중간 " + (fight.rounds - 4) + "턴 생략 …",
        fight.logs[3]
      ]
    : fight.logs;
  const resultLines = won
    ? [
        "🏆 승리! " + mob.name + " 처치",
        "💰 +" + gold + "G · ✨ 경험치 +" + earnedExp,
        ...(progress.points ? ["🎉 레벨업! 스탯 포인트 +" + progress.points] : []),
        "🗺️ 다음 몬스터: " + nextMob.name + " Lv." + nextMob.level +
          " (HP " + nextMob.hp + "/" + nextMob.maxHp + ")"
      ]
    : [
        "💀 패배! 플레이어가 쓰러졌어요.",
        "👹 패배 순간 몬스터 남은 HP " +
          fight.remainingMonsterHp + "/" + mob.maxHp,
        "🔄 재도전 시 몬스터 HP는 " + mob.maxHp +
          "/" + mob.maxHp + "로 초기화됩니다.",
        "💚 회복 또는 휴식 후 재도전하세요."
      ];
  const text = [
    "⚔️ 자동 전투 결과 · STAGE " + p.stage,
    "👹 " + mob.name + " Lv." + mob.level +
      " | HP " + mob.hp + "/" + mob.maxHp,
    "",
    "—— 전투 기록 (" + fight.rounds + "턴) ——",
    ...combatLines,
    "",
    "—— 전투 결과 ——",
    ...resultLines,
    "🗡️ 총 가한 피해 " + fight.dealt +
      " | 🛡️ 총 받은 피해 " + fight.taken,
    "💥 치명타 " + fight.criticalHits +
      "회 | 💨 회피 " + fight.dodges + "회",
    expProgress(progress.level, progress.exp),
    hpText(after),
    staminaText(after)
  ].join("\n");
  // The displayed card belongs to the monster just fought, not the next stage.
  // When defeated, display HP at the moment combat ended. The database reset
  // for the next attempt is unchanged.
  const cardMonster: MonsterCard = won
    ? { ...mob, hp: 0, stage: p.stage, cleared: true }
    : { ...mob, hp: fight.remainingMonsterHp, stage: p.stage, cleared: false };
  return { monster: cardMonster, text };
}

async function handle(command: string, env: Env, botId: string, userKey: string) {
  const db = env.DB;
  if (command === "게임시작") {
    await db.prepare("INSERT OR IGNORE INTO players(bot_id,bot_user_key) VALUES (?,?)").bind(botId,userKey).run();
    const player = await load(db, botId, userKey);
    const refreshed = player ? await hydrateHp(db, await hydrateStamina(db, player)) : null;
    return response(`🎮 카카오 RPG에 오신 것을 환영합니다!\n\n${info(refreshed!)}`);
  }
  const existing = await load(db, botId, userKey);
  if (!existing) return response("먼저 '게임시작'을 입력해서 캐릭터를 생성해 주세요.",["게임시작"]);
  const p = await hydrateHp(db, await hydrateStamina(db, existing));
  if (command === "내정보") return response(info(p));
  if (command === "사냥터") {
    if (!hasMonsterSchema(p)) {
      return response("⚠️ 사냥터 개편 준비 중입니다. D1 데이터베이스 업데이트(0003)를 적용해 주세요.", ["사냥","내정보"]);
    }
    const state = await spawnMonster(db, p);
    const spawned = currentMonster(state);
    if (!spawned) return response("⏳ 사냥터 상태를 불러오는 중이에요. 다시 시도해 주세요.", ["사냥터","내정보"]);
    return response("🏞️ 현재 사냥터 · 스테이지 " + state.stage + "\n" +
      monsterView(spawned) + "\n⚔️ '사냥'을 눌러 공격하세요!\n" +
      staminaText(state), ["사냥","사냥터","내정보","출석"], { ...spawned, stage: state.stage });
  }
  if (command === "출석현황") return response(attendanceInfo(p), ["출석","사냥","내정보"]);
  if (command === "출석") {
    const message = await claimAttendance(db, p);
    return response(message, ["출석현황","사냥","내정보"]);
  }
  if (command === "회복") {
    if (!hasHpSchema(p)) {
      return response("⚠️ 체력 회복을 사용하려면 DB 업데이트(0004)를 먼저 적용해 주세요.", ["내정보", "휴식"]);
    }
    const cap = maxHp(p);
    if (p.player_hp >= cap) {
      return response("💚 이미 체력이 가득합니다!\n❤️ HP " + cap + "/" + cap,
        ["사냥", "내정보", "휴식"]);
    }
    // Restore 45% of the CURRENT maximum HP, rounded up. Never exceed the cap.
    const healAmount = Math.ceil(cap * 0.45);
    const actualHeal = Math.min(healAmount, cap - p.player_hp);
    const now = Date.now();
    const update = await db.prepare(
      "UPDATE players SET player_hp=MIN(?,player_hp+?)," +
      "hp_updated_at=CASE WHEN player_hp+?>=? THEN ? ELSE hp_updated_at END," +
      "version=version+1 WHERE id=? AND version=? AND player_hp<?"
    ).bind(cap, healAmount, healAmount, cap, now, p.id, p.version, cap).run();
    if (update.meta.changes !== 1) {
      return response("⏳ 체력 상태가 변경됐어요. 다시 확인한 후 회복해 주세요.", ["내정보", "회복"]);
    }
    const healed = p.player_hp + actualHeal;
    return response(
      "💚 회복 성공!\n" +
      "💊 최대 체력의 45% 회복 (" + healAmount + " HP 기준)\n" +
      "❤️ 실제 회복량 +" + actualHeal + " HP\n" +
      "❤️ 현재 체력 " + healed + "/" + cap +
      "\n\n사냥을 계속할 수 있어요!",
      ["사냥", "회복", "내정보", "스탯", "휴식"]
    );
  }
  if (command === "휴식") return response("🌿 휴식 중에도 스태미나는 자동으로 회복돼요.\n" +
    staminaText(p) + "\n" + hpText(p) + "\n스태미나는 10분마다 1, HP는 5분마다 10 회복", ["사냥","회복","출석","내정보"]);
  if (command === "도움말") return response(`🎮 사용 가능한 명령어\n${actions.join(" / ")}\n\n사냥에는 스태미나 1이 필요합니다. 연속 실행에는 1초 제한이 있습니다. 스태미나는 10분마다 1씩 자동 회복합니다. 출석은 한국시간 매일 1회 가능합니다. 회복은 사용할 때마다 최대 HP의 45%를 보충합니다.`);
  if (command === "스탯") return response(
    statText(p), ["힘 올리기","방어 올리기","민첩 올리기","내정보"]
  );
  if (["힘 올리기", "방어 올리기", "민첩 올리기"].includes(command)) {
    const column = ({
      "힘 올리기":"strength",
      "방어 올리기":"defense",
      "민첩 올리기":"agility"
    } as const)[command as "힘 올리기" | "방어 올리기" | "민첩 올리기"];
    if (p.stat_points <= 0) return response(
      "✨ 남은 스탯 포인트가 없어요. 사냥으로 레벨업해 주세요.\n" + statText(p),
      ["스탯","사냥"]
    );
    // +8 HP on defense allocation if the optional HP migration was installed.
    const heal = column === "defense" && hasHpSchema(p);
    const sql = "UPDATE players SET " + column + "=" + column + "+1," +
      "stat_points=stat_points-1,version=version+1" +
      (heal ? ",player_hp=player_hp+8" : "") +
      " WHERE id=? AND version=? AND stat_points>0";
    const result = await db.prepare(sql).bind(p.id,p.version).run();
    if (result.meta.changes !== 1) return response(
      "⏳ 포인트 상태가 바뀌었어요. 스탯을 다시 확인해 주세요.", ["스탯"]
    );
    const fresh = await load(db,botId,userKey);
    return response("✅ " + command + " 성공! (포인트 -1)\n\n" + statText(fresh!),
      ["힘 올리기","방어 올리기","민첩 올리기","사냥","내정보"]
    );
  }
  if (command === "사냥" || command === "탐험") {
    const nowMs = Date.now();
    // Prior versions stored last_hunt_at as epoch seconds.
    const lastHuntMs = p.last_hunt_at < 100_000_000_000
      ? p.last_hunt_at * 1000 : p.last_hunt_at;
    if (p.stamina < 1) return response(
      "⚡ 스태미나가 부족해요!\n" + staminaText(p) +
      "\n출석 보상이나 자동 회복을 이용해 주세요.",
      ["출석","출석현황","휴식","내정보"]
    );
    if (nowMs - lastHuntMs < 1000) return response(
      "⏳ 사냥 간격은 최소 1초입니다.\n" + staminaText(p),
      ["사냥","휴식","내정보"]
    );
    if (hasMonsterSchema(p)) {
      if (hasHpSchema(p) && p.player_hp <= 0) return response(
        "💔 체력이 부족해서 사냥할 수 없어요.\n" + hpText(p) +
        "\n회복 또는 휴식 후 다시 도전해 주세요.", ["회복","휴식","내정보","스탯"]
      );
      const outcome = await monsterBattle(db, p, nowMs);
      return response(outcome.text, ["사냥","사냥터","회복","내정보","스탯","휴식"], outcome.monster);
    }
    // Fallback until migration 0003 is applied: keep the old hunting engine playable.
    const atk = p.strength * 3 + p.level * 2;
    const monsterHp = 12 + p.stage * 4;
    const won = atk >= monsterHp ||
      Math.random() < Math.min(0.85, atk / (monsterHp * 1.8));
    const earnedGold = won ? 20 + p.stage * 5 : 0;
    const earnedExp = won ? 30 + p.stage * 6 : 0;
    const progress = calcProgress(p, earnedExp);
    // In upgraded databases, consuming from the cap starts a fresh recharge timer.
    const upgraded = hasDailySchema(p);
    const updateSql = upgraded
      ? "UPDATE players SET stamina=stamina-1,gold=gold+?,level=?,exp=?," +
        "stat_points=stat_points+?,stage=stage+?,last_hunt_at=?," +
        "stamina_updated_at=CASE WHEN stamina>=20 THEN ? ELSE stamina_updated_at END," +
        "version=version+1 WHERE id=? AND version=? AND stamina>=1 AND last_hunt_at<=?"
      : "UPDATE players SET stamina=stamina-1,gold=gold+?,level=?,exp=?," +
        "stat_points=stat_points+?,stage=stage+?,last_hunt_at=?," +
        "version=version+1 WHERE id=? AND version=? AND stamina>=1 AND last_hunt_at<=?";
    const params = [
      earnedGold, progress.level, progress.exp, progress.points,
      won ? 1 : 0, nowMs,
      ...(upgraded ? [nowMs] : []),
      p.id, p.version, nowMs - 1000
    ];
    const result = await db.prepare(updateSql).bind(...params).run();
    if (result.meta.changes !== 1) return response(
      "⏳ 상태가 변경됐어요. 잠시 후 다시 시도해 주세요.",
      ["사냥","내정보"]
    );
    const after: Player = {
      ...p, stamina: p.stamina - 1,
      stamina_updated_at: upgraded && p.stamina >= 20
        ? nowMs : p.stamina_updated_at
    };
    const battle = won
      ? "⚔️ 사냥 승리!\n👹 스테이지 " + p.stage + " 몬스터 처치\n" +
        "💰 +" + earnedGold + "G | ✨ +" + earnedExp + " EXP" +
        (progress.points ? "\n🎉 레벨업! Lv." + progress.level +
          " (+" + progress.points + " 스탯포인트)" : "")
      : "💀 사냥 실패!\n👹 몬스터에게 패배했습니다.";
    return response(battle + "\n" + expProgress(progress.level, progress.exp) + "\n" + staminaText(after), ["사냥","사냥터","내정보","출석","휴식"]);
  }
  if (command === "랭킹") {
    const result = await db.prepare("SELECT nickname,level,stage FROM players WHERE bot_id=? ORDER BY level DESC,exp DESC,stage DESC LIMIT 10").bind(botId).all<{nickname:string,level:number,stage:number}>();
    const lines = (result.results || []).map((x,i)=>`${i+1}위 ${x.nickname} Lv.${x.level} (ST.${x.stage})`);
    return response(`🏆 TOP 10 랭킹\n${lines.join("\n") || "기록 없음"}`);
  }
  return response("명령어를 인식하지 못했습니다. 도움말을 선택해 주세요.",["도움말","사냥","내정보"]);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return Response.json({ok:true,service:"kakao-rpg-bot"});
    const imageMatch = request.method === "GET" && url.pathname.match(/^\/monsters\/([a-z]+)\.jpg$/);
    if (imageMatch) {
      const encoded = MONSTER_IMAGES[imageMatch[1] as keyof typeof MONSTER_IMAGES];
      if (!encoded) return new Response("Not found", {status:404});
      const raw = atob(encoded);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return new Response(bytes.buffer as ArrayBuffer, { headers: {
        "Content-Type":"image/jpeg",
        "Cache-Control":"public, max-age=86400",
        "Access-Control-Allow-Origin":"*"
      } });
    }
    if (request.method !== "POST" || url.pathname !== "/kakao/skill") return new Response("Not found",{status:404});
    if (!env.KAKAO_SKILL_KEY || request.headers.get("x-api-key") !== env.KAKAO_SKILL_KEY)
      return new Response("Forbidden",{status:403});
    let data: KakaoPayload;
    try {
      data = await request.json() as KakaoPayload;
    } catch {
      console.warn("Kakao skill payload validation failed", { reason: "INVALID_JSON" });
      return response("⚠️ 요청 데이터 형식을 읽을 수 없습니다. [INVALID_JSON]", ["게임시작"]);
    }
    // Each Worker serves exactly one Kakao bot. Authentication is enforced
    // by KAKAO_SKILL_KEY, while the configured bot ID remains the stable
    // database namespace for both builder tests and the live channel.
    // Kakao may supply a distinct bot.id for a test environment.
    const botId = env.EXPECTED_BOT_ID?.trim();
    const userKey = data?.userRequest?.user?.id;
    const utterance = data?.userRequest?.utterance;
    const command = typeof utterance === "string" ? utterance.trim() : "";
    const rejectReason =
      !botId || botId === "REPLACE_WITH_KAKAO_BOT_ID" ? "BOT_CONFIG_MISSING" :
      typeof userKey !== "string" || !userKey ? "USER_ID_MISSING" :
      userKey.length > 300 ? "USER_ID_TOO_LONG" :
      !command ? "UTTERANCE_MISSING" :
      command.length > 100 ? "UTTERANCE_TOO_LONG" : null;
    if (rejectReason) {
      // Only log the validation reason, never the user identifier or secret.
      console.warn("Kakao skill payload validation failed", { reason: rejectReason });
      return response(`⚠️ RPG 요청 확인 필요 [${rejectReason}]\n관리자에게 이 오류 코드를 전달해 주세요.`, ["게임시작"]);
    }
    try { return await handle(command!,env,botId!,userKey!); }
    catch (e) { console.error("Game handler failed",e); return response("서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."); }
  }
};
