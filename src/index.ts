interface Env {
  DB: D1Database;
  EXPECTED_BOT_ID: string;
  KAKAO_SKILL_KEY: string;
}
type Player = {
  id: number; nickname: string; level: number; exp: number; gold: number;
  strength: number; defense: number; agility: number; stat_points: number;
  stamina: number; stage: number; last_hunt_at: number; version: number;
};
type KakaoPayload = {
  bot?: { id?: string };
  userRequest?: { user?: { id?: string }, utterance?: string };
};
const actions = ["게임시작", "내정보", "사냥", "스탯", "힘 올리기", "방어 올리기", "민첩 올리기", "랭킹", "도움말"];
function response(text: string, quick = ["사냥", "내정보", "스탯", "랭킹"]) {
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
  return `🛡️ ${p.nickname}\n레벨 ${p.level} | 경험치 ${p.exp}/${expNeeded(p.level)}\n💰 ${p.gold.toLocaleString()}G | ⚡ 스태미나 ${p.stamina}/20\n💪 힘 ${p.strength} | 🛡️ 방어 ${p.defense} | 💨 민첩 ${p.agility}\n✨ 남은 스탯포인트 ${p.stat_points}\n🗺️ 진행 스테이지 ${p.stage}`;
}
async function handle(command: string, env: Env, botId: string, userKey: string) {
  const db = env.DB;
  if (command === "게임시작") {
    await db.prepare("INSERT OR IGNORE INTO players(bot_id,bot_user_key) VALUES (?,?)").bind(botId,userKey).run();
    const player = await load(db, botId, userKey);
    return response(`🎮 카카오 RPG에 오신 것을 환영합니다!\n\n${info(player!)}`);
  }
  const p = await load(db, botId, userKey);
  if (!p) return response("먼저 '게임시작'을 입력해서 캐릭터를 생성해 주세요.",["게임시작"]);
  if (command === "내정보") return response(info(p));
  if (command === "도움말") return response(`🎮 사용 가능한 명령어\n${actions.join(" / ")}\n\n사냥에는 스태미나 1이 필요합니다. 연속 실행에는 2초 제한이 있습니다.`);
  if (command === "스탯") return response(`✨ 남은 포인트: ${p.stat_points}\n힘 ${p.strength} / 방어 ${p.defense} / 민첩 ${p.agility}\n레벨업마다 1포인트 획득합니다.`,["힘 올리기","방어 올리기","민첩 올리기","내정보"]);
  if (["힘 올리기", "방어 올리기", "민첩 올리기"].includes(command)) {
    const column = ({"힘 올리기":"strength","방어 올리기":"defense","민첩 올리기":"agility"} as const)[command as "힘 올리기" | "방어 올리기" | "민첩 올리기"];
    const result = await db.prepare(`UPDATE players SET ${column}=${column}+1, stat_points=stat_points-1,version=version+1 WHERE id=? AND stat_points>0`).bind(p.id).run();
    if (result.meta.changes !== 1) return response("사용할 스탯 포인트가 없습니다.",["스탯","사냥"]);
    return response(`✅ ${command} 성공!\n${info((await load(db,botId,userKey))!)}`,["스탯","사냥"]);
  }
  if (command === "사냥") {
    const now = Math.floor(Date.now()/1000);
    if (p.stamina < 1) return response("⚡ 스태미나가 부족합니다. 추후 회복/출석 시스템을 추가할 예정입니다.");
    if (now - p.last_hunt_at < 2) return response("⏳ 사냥 간격은 최소 2초입니다.");
    const atk = p.strength * 3 + p.level * 2;
    const monsterHp = 12 + p.stage * 4;
    const won = atk >= monsterHp || Math.random() < Math.min(0.85, atk / (monsterHp * 1.8));
    const earnedGold = won ? 20 + p.stage * 5 : 0;
    const earnedExp = won ? 30 + p.stage * 6 : 0;
    const progress = calcProgress(p, earnedExp);
    // 상태 버전과 쿨다운을 확인하여 오래된 요청의 이중 처리를 차단
    const update = await db.prepare(`UPDATE players SET stamina=stamina-1,gold=gold+?,level=?,exp=?,stat_points=stat_points+?,stage=stage+?,last_hunt_at=?,version=version+1 WHERE id=? AND version=? AND stamina>=1 AND last_hunt_at<=?`)
      .bind(earnedGold,progress.level,progress.exp,progress.points,won?1:0,now,p.id,p.version,now-2).run();
    if (update.meta.changes !== 1) return response("⏳ 상태가 변경되었습니다. 잠시 후 다시 시도해 주세요.");
    return response(won
      ? `⚔️ 사냥 승리!\n👹 스테이지 ${p.stage} 몬스터 처치\n💰 +${earnedGold}G | ✨ +${earnedExp} EXP${progress.points ? `\n🎉 레벨업! Lv.${progress.level} (+${progress.points} 스탯포인트)` : ""}\n⚡ 스태미나 -1`
      : `💀 사냥 실패!\n👹 몬스터에게 패배했습니다.\n⚡ 스태미나 -1`);
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
