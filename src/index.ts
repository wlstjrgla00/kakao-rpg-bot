import {
  type GamePlayer, hydrateStamina, hasDailySchema, hasMonsterSchema, staminaText,
  attendanceInfo, claimAttendance, staminaCap
} from "./features";

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
const actions = ["게임시작", "내정보", "사냥", "탐험", "사냥터", "출석", "출석현황", "휴식", "스탯", "힘 올리기", "방어 올리기", "민첩 올리기", "랭킹", "도움말"];
function response(text: string, quick = ["사냥", "사냥터", "내정보", "출석", "스탯", "휴식"]) {
  return Response.json({
    version: "2.0",
    template: {
      outputs: [{ simpleText: { text: text.slice(0, 950) } }],
      quickReplies: quick.map(label => ({ label, action: "message", messageText: label }))
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
function expNeeded(level: number) { return level * 100; }
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
  return `🛡️ ${p.nickname}\n레벨 ${p.level} | 경험치 ${p.exp}/${expNeeded(p.level)}\n💰 ${p.gold.toLocaleString()}G | ${staminaText(p)}\n💪 힘 ${p.strength} | 🛡️ 방어 ${p.defense} | 💨 민첩 ${p.agility}\n✨ 남은 스탯포인트 ${p.stat_points}\n🗺️ 진행 스테이지 ${p.stage}`;
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
async function monsterBattle(db: D1Database, p: Player, nowMs: number): Promise<string> {
  const mob = currentMonster(p) || makeMonster(p.stage, p.level);
  const critical = Math.random() < 0.12;
  const baseDamage = Math.max(1, p.strength * 3 + p.level * 2 + Math.floor(Math.random() * 7) - 3);
  const rawDamage = critical ? Math.floor(baseDamage * 1.5) : baseDamage;
  const damage = Math.min(mob.hp, rawDamage);
  const remainingHp = Math.max(0, mob.hp - damage);
  const killed = remainingHp === 0;
  const gold = killed ? 20 + p.stage * 5 : 0;
  const exp = killed ? 30 + p.stage * 6 : 0;
  const progress = calcProgress(p, exp);
  const nextStage = p.stage + (killed ? 1 : 0);
  const nextMob = killed ?
    makeMonster(nextStage, progress.level) :
    { ...mob, hp: remainingHp };
  const updatedStamp = p.stamina >= staminaCap(p) ? nowMs : (p.stamina_updated_at || nowMs);
  // Atomic damage, enemy HP, rewards and player stamina update.
  const result = await db.prepare(
    "UPDATE players SET stamina=stamina-1, gold=gold+?,level=?,exp=?," +
    "stat_points=stat_points+?,stage=?,monster_name=?,monster_level=?," +
    "monster_hp=?,monster_max_hp=?,stamina_updated_at=?," +
    "last_hunt_at=?,version=version+1 WHERE id=? AND version=? AND " +
    "stamina>=1 AND last_hunt_at<=?"
  ).bind(
    gold, progress.level, progress.exp, progress.points, nextStage,
    nextMob.name, nextMob.level, nextMob.hp, nextMob.maxHp,
    updatedStamp, nowMs, p.id, p.version, nowMs - 1000
  ).run();
  if (result.meta.changes !== 1) {
    return "⏳ 전투 상황이 갱신됐어요. 잠시 후 다시 사냥하세요.";
  }
  const after: Player = {
    ...p, stamina: p.stamina - 1, stamina_updated_at: updatedStamp
  };
  const resultText = killed
    ? "🏆 몬스터 처치!\n💰 골드 +" + gold + "G | ✨ 경험치 +" + exp +
      (progress.points ? "\n🎉 레벨업! Lv." + progress.level +
      " (스탯포인트 +" + progress.points + ")" : "") +
      "\n\n✨ 다음 몬스터 등장!\n" + monsterView(nextMob)
    : "❤️ 몬스터 남은 HP: " + remainingHp + "/" + mob.maxHp;
  return "⚔️ 전투 결과 · 스테이지 " + p.stage + "\n" +
    "👹 " + mob.name + " Lv." + mob.level + " (HP " + mob.maxHp + ")\n" +
    "🗡️ 내가 준 피해: " + damage + (critical ? " 💥 치명타!" : "") +
    "\n" + resultText + "\n" + staminaText(after);
}

async function handle(command: string, env: Env, botId: string, userKey: string) {
  const db = env.DB;
  if (command === "게임시작") {
    await db.prepare("INSERT OR IGNORE INTO players(bot_id,bot_user_key) VALUES (?,?)").bind(botId,userKey).run();
    const player = await load(db, botId, userKey);
    const refreshed = player ? await hydrateStamina(db, player) : null;
    return response(`🎮 카카오 RPG에 오신 것을 환영합니다!\n\n${info(refreshed!)}`);
  }
  const existing = await load(db, botId, userKey);
  if (!existing) return response("먼저 '게임시작'을 입력해서 캐릭터를 생성해 주세요.",["게임시작"]);
  const p = await hydrateStamina(db, existing);
  if (command === "내정보") return response(info(p));
  if (command === "사냥터") {
    if (!hasMonsterSchema(p)) {
      return response("⚠️ 사냥터 개편 준비 중입니다. D1 데이터베이스 업데이트(0003)를 적용해 주세요.", ["사냥","내정보"]);
    }
    const state = await spawnMonster(db, p);
    return response("🏞️ 현재 사냥터 · 스테이지 " + state.stage + "\n" +
      monsterView(currentMonster(state)!) + "\n⚔️ '사냥'을 눌러 공격하세요!\n" +
      staminaText(state), ["사냥","사냥터","내정보","출석"]);
  }
  if (command === "출석현황") return response(attendanceInfo(p), ["출석","사냥","내정보"]);
  if (command === "출석") {
    const message = await claimAttendance(db, p);
    return response(message, ["출석현황","사냥","내정보"]);
  }
  if (command === "휴식") return response("🌿 휴식 중에도 스태미나는 자동으로 회복돼요.\n" +
    staminaText(p) + "\n최대 20, 10분당 1 회복", ["사냥","출석","내정보"]);
  if (command === "도움말") return response(`🎮 사용 가능한 명령어\n${actions.join(" / ")}\n\n사냥에는 스태미나 1이 필요합니다. 연속 실행에는 1초 제한이 있습니다. 스태미나는 10분마다 1씩 자동 회복합니다. 출석은 한국시간 매일 1회 가능합니다.`);
  if (command === "스탯") return response(`✨ 남은 포인트: ${p.stat_points}\n힘 ${p.strength} / 방어 ${p.defense} / 민첩 ${p.agility}\n레벨업마다 1포인트 획득합니다.`,["힘 올리기","방어 올리기","민첩 올리기","내정보"]);
  if (["힘 올리기", "방어 올리기", "민첩 올리기"].includes(command)) {
    const column = ({"힘 올리기":"strength","방어 올리기":"defense","민첩 올리기":"agility"} as const)[command as "힘 올리기" | "방어 올리기" | "민첩 올리기"];
    const result = await db.prepare(`UPDATE players SET ${column}=${column}+1, stat_points=stat_points-1,version=version+1 WHERE id=? AND stat_points>0`).bind(p.id).run();
    if (result.meta.changes !== 1) return response("사용할 스탯 포인트가 없습니다.",["스탯","사냥"]);
    return response(`✅ ${command} 성공!\n${info((await load(db,botId,userKey))!)}`,["스탯","사냥"]);
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
      return response(await monsterBattle(db, p, nowMs), ["사냥","사냥터","내정보","출석","휴식"]);
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
    return response(battle + "\n" + staminaText(after), ["사냥","사냥터","내정보","출석","휴식"]);
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
