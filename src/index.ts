import {
  type GamePlayer, hydrateStamina, hasDailySchema, hasMonsterSchema, staminaText,
  attendanceInfo, claimAttendance, staminaCap
} from "./features";
import { hasHpSchema, hpText, maxHp, statText, hydrateHp } from "./stats";
import { resolveFight } from "./combat";
import { MONSTER_IMAGES } from "./monster-images";
import {
  type BaseClass, jobName, jobClass, jobTier, jobInt,
  nextPromotion, promotionPreview, promote, hasJobSchema
} from "./jobs";
import {
  type Equipment, type GearSlot, SLOT_LABEL,
  equipped, loadout, bonuses, slotOf, equipmentInfo,
  inventory, equip, sell, sellAll, bulkSaleSummary, enhance, rollDrop, power, display, gearName, cost, oddsLine, saleValue
} from "./equipment";
import {GROUNDS,currentGround,suggestedGround,targetMonsterLevel,
  groundList,hasGroundSchema,rewardForMonster} from "./hunting-grounds";

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
const actions = ["게임시작", "내정보", "전직", "사냥", "탐험", "사냥터", "사냥터 목록", "추천 사냥터", "출석", "출석현황", "휴식", "회복", "스탯", "힘 올리기", "방어 올리기", "민첩 올리기", "지능 올리기", "장비", "인벤토리", "장착 메뉴", "판매 메뉴", "강화", "랭킹", "도움말"];

type MonsterCard = {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  stage: number;
  ground?: string;
  cleared?: boolean;
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
        "🗺️ " + (monster.ground || "사냥터") + " · 누적 "+(monster.cleared?monster.stage:monster.stage-1)+"회\n" +
        statusText,
      thumbnail: {
        imageUrl: "https://kakao-rpg-bot.bongham.workers.dev/monsters/" + slug + ".jpg",
        altText: name + " 몬스터 그림",
        width: 800, height: 800,
        fixedRatio: true
      },
      buttonLayout: "horizontal",
      buttons: [
        { label: "회복", action: "message", messageText: "회복" },
        // Reuse existing '사냥' block; no extra '탐험' block required.
        { label: "탐험", action: "message", messageText: "사냥" }
      ]
    }
  };
}
function response(
  text: string,
  quick = ["사냥", "회복", "내정보", "스탯", "장비", "인벤토리", "강화"],
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
function healCard(title: string, description: string) {
  return Response.json({
    version: "2.0",
    template: {
      outputs: [{
        textCard: {
          title,
          description,
          buttonLayout: "horizontal",
          buttons: [
            { label: "회복", action: "message", messageText: "회복" },
            { label: "사냥", action: "message", messageText: "사냥" }
          ]
        }
      }]
    }
  }, { headers: { "Cache-Control": "no-store" } });
}

function jobCard(
  title: string,
  description: string,
  buttons: Array<{label:string; messageText:string}>,
  quick: string[] = ["스탯"]
) {
  return Response.json({
    version:"2.0",
    template: {
      outputs:[{textCard: {
        title, description:description.slice(0, 950),
        buttonLayout:"vertical",
        buttons:buttons.slice(0,3).map(b=>({
          label:b.label, action:"message", messageText:b.messageText
        }))
      }}],
      quickReplies:quick.map(label=>({label,action:"message",messageText:label}))
    }
  }, {headers:{"Cache-Control":"no-store"}});
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
  const next = nextPromotion(p);
  const notice = next && p.level >= next.level
    ? "\n🎓 " + next.tier + "차 전직 가능! '전직'을 입력하세요." : "";
  return `🛡️ ${p.nickname}\n${jobName(p)} | 레벨 ${p.level}\n경험치 ${p.exp}/${expNeeded(p.level)} (${(p.exp/expNeeded(p.level)*100).toFixed(1)}%)\n💰 ${p.gold.toLocaleString()}G | ${staminaText(p)}\n${hpText(p)}\n💪 힘 ${p.strength} | 🛡️ 방어 ${p.defense} | 💨 민첩 ${p.agility} | 🧠 지능 ${jobInt(p)}\n✨ 남은 스탯포인트 ${p.stat_points}\n🏞️ 현재 사냥터 ${hasGroundSchema(p)?currentGround(p).name:"사냥터 DB 업데이트 필요"}${p.hunting_ground==="auto"?" (자동)":""}\n🗺️ 누적 처치 ${p.stage-1}회` + notice;
}
type Monster = { name: string; level: number; hp: number; maxHp: number };

const MONSTERS = ["🟢 슬라임", "👺 숲 고블린", "🐺 야생 늑대", "💀 암흑 해골", "🪨 마력 골렘", "⚔️ 심연의 기사"];

function makeMonster(stage:number,playerLevel:number,ground=currentGround({level:playerLevel,hunting_ground:"auto"} as Player)):Monster {
  // Stage is retained only as a lifetime clear counter, never a combat scale.
  const level=targetMonsterLevel(playerLevel,ground);
  const hp=Math.ceil(28+level*6.2);
  return {name:MONSTERS[ground.monsterIndex],level,hp,maxHp:hp};
}
function currentMonster(p:Player):Monster|null {
  if(!p.monster_name||!p.monster_hp||!p.monster_max_hp||!p.monster_level)return null;
  return {name:p.monster_name,hp:p.monster_hp,maxHp:p.monster_max_hp,level:p.monster_level};
}
const MONSTER_SLUGS=["slime","goblin","wolf","skeleton","golem","knight"];
function monsterSlug(name:string):string {
  const index=MONSTERS.indexOf(name);
  return MONSTER_SLUGS[index<0?0:index];
}
function monsterView(m:Monster):string {
  return "👹 "+m.name+" | Lv."+m.level+"\n❤️ 몬스터 HP: "+m.hp+"/"+m.maxHp;
}
async function spawnMonster(db:D1Database,p:Player):Promise<Player> {
  if(!hasGroundSchema(p))return p;
  const expected=makeMonster(p.stage,p.level,currentGround(p));
  const existing=currentMonster(p);
  // Keep wounded foes after defeat. Old stage-scaled or wrong-zone enemies
  // are automatically replaced once after migration with fair leveled mobs.
  if(existing && existing.name===expected.name &&
     Math.abs(existing.level-expected.level)<=2 &&
     existing.maxHp<=Math.ceil(expected.maxHp*1.25))return p;
  const result=await db.prepare(
    "UPDATE players SET monster_name=?,monster_level=?,monster_hp=?,monster_max_hp=?,"+
    "version=version+1 WHERE id=? AND version=?"
  ).bind(expected.name,expected.level,expected.hp,expected.maxHp,p.id,p.version).run();
  if(result.meta.changes===1)return {
    ...p,monster_name:expected.name,monster_level:expected.level,
    monster_hp:expected.hp,monster_max_hp:expected.maxHp,version:p.version+1
  };
  return (await db.prepare("SELECT * FROM players WHERE id=?")
    .bind(p.id).first<Player>())||p;
}
async function monsterBattle(
  db: D1Database, p: Player, nowMs: number
): Promise<{ text: string; monster?: MonsterCard }> {
  const mob = currentMonster(p) || makeMonster(p.stage,p.level,currentGround(p));
  if (!hasHpSchema(p)) {
    return {
      text: "⚠️ 자동 전투는 플레이어 HP가 필요해요.\nD1 0004_player_hp.sql을 적용해 주세요.",
    };
  }
  // One skill call simulates the full fight until either combatant reaches zero HP.
  const worn = await loadout(db,p.id);
  const fight = resolveFight({ ...p, player_hp: p.player_hp }, mob, undefined, bonuses(worn));
  const won = fight.victory;
  const rewards=rewardForMonster(mob.level);
  const gold=won?rewards.gold:0;
  const earnedExp=won?rewards.exp:0;
  const progress = calcProgress(p, earnedExp);
  const nextStage = p.stage + (won ? 1 : 0);
  const loot = won ? rollDrop(mob.level) : null;
  const slotOccupied = loot ? worn.some(item => slotOf(item.item_code) === slotOf(loot.kind)) : false;
  // Preserve the monster's remaining HP after defeat. A healed player
  // resumes the same encounter rather than getting a fresh full-HP monster.
  const nextMob = won ? makeMonster(nextStage,progress.level,currentGround({...p,level:progress.level})) :
    { ...mob, hp: fight.remainingMonsterHp };
  const updatedStamp = p.stamina >= staminaCap(p) ? nowMs : (p.stamina_updated_at || nowMs);
  const nextHpAt = fight.taken > 0 ? nowMs : (p.hp_updated_at || nowMs);
  const sql =
    "UPDATE players SET stamina=stamina-1,gold=gold+?,level=?,exp=?," +
    "stat_points=stat_points+?,stage=?,monster_name=?,monster_level=?," +
    "monster_hp=?,monster_max_hp=?,stamina_updated_at=?," +
    "player_hp=?,hp_updated_at=?,last_hunt_at=?,version=version+1 " +
    "WHERE id=? AND version=? AND stamina>=1 AND last_hunt_at<=?";
  const battleUpdate = db.prepare(sql).bind(
    gold,progress.level,progress.exp,progress.points,nextStage,
    nextMob.name,nextMob.level,nextMob.hp,nextMob.maxHp,updatedStamp,
    fight.remainingHeroHp,nextHpAt,nowMs,p.id,p.version,nowMs-1000
  );
  // The battle update and optional loot INSERT commit as one D1 transaction.
  // A failed battle CAS cannot create a free item.
  const lootInsert = loot ? db.prepare(
    "INSERT INTO equipment (player_id,item_code,item_name,rarity,attack_bonus,upgrade_level,equipped) " +
    "SELECT id,?,?,?,?,0,? FROM players " +
    "WHERE id=? AND version=? AND last_hunt_at=?"
  ).bind(loot.kind,gearName(loot.kind,loot.rarity),loot.rarity,power(loot.rarity,0,loot.kind),
    slotOccupied?0:1,p.id,p.version+1,nowMs) : null;
  const batch = await db.batch(lootInsert ? [battleUpdate,lootInsert] : [battleUpdate]);
  const result = batch[0];
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
  const lootLine = loot && batch.length > 1 && batch[1].meta.changes === 1
    ? "🎁 장비 획득! " + display({
        item_code:loot.kind,rarity:loot.rarity,upgrade_level:0,
        attack_bonus:power(loot.rarity,0,loot.kind)
      } as Equipment) + (slotOccupied ? " (인벤토리 보관)" : " (빈 슬롯 자동 장착)")
    : "";
  const resultLines = won
    ? [
        "🏆 승리! " + mob.name + " 처치",
        "💰 +" + gold + "G · ✨ 경험치 +" + earnedExp,
        ...(progress.points ? ["🎉 레벨업! 스탯 포인트 +" + progress.points] : []),
        ...(lootLine ? [lootLine] : [])
      ]
    : [
        "💀 패배! 플레이어가 쓰러졌어요.",
        "👹 몬스터 남은 HP " + fight.remainingMonsterHp + "/" + mob.maxHp,
        "✅ 몬스터 HP가 저장됐어요. 회복 후 이어서 전투할 수 있어요.",
        "💚 회복 또는 휴식 후 재도전하세요."
      ];
  const text = [
    "⚔️ 자동 전투 · "+currentGround(p).name+" · STAGE " + p.stage,
    "👹 " + mob.name + " Lv." + mob.level +
      " | HP " + mob.hp + "/" + mob.maxHp,
    "",
    "—— 전투 기록 (" + fight.rounds + "턴) ——",
    ...combatLines,
    "",
    "—— 전투 결과 ——",
    ...resultLines,
    expProgress(progress.level, progress.exp),
    ...(nextPromotion(after) && progress.level >= nextPromotion(after)!.level ? ["🎓 전직 가능! '전직' 명령을 입력하세요."] : []),
    ...(won && p.hunting_ground==="auto" && currentGround(after).id!==currentGround(p).id
       ? ["🏞️ 새 사냥터 해금! "+currentGround(after).name+" (자동 이동)"] : []),
    hpText(after),
    staminaText(after)
  ].join("\n");
  // Show the monster just fought, not the next stage. The defeat card's HP
  // matches the HP saved to D1 and used when the player returns after healing.
  const cardMonster: MonsterCard = won
    ? { ...mob, hp: 0, stage: p.stage, ground:currentGround(p).name, cleared: true }
    : { ...mob, hp: fight.remainingMonsterHp, stage: p.stage, ground:currentGround(p).name, cleared: false };
  return { monster: cardMonster, text };
}

async function handle(command: string, env: Env, botId: string, userKey: string) {
  const db = env.DB;
  if (command === "게임시작") {
    await db.prepare("INSERT OR IGNORE INTO players(bot_id,bot_user_key) VALUES (?,?)").bind(botId,userKey).run();
    const player = await load(db, botId, userKey);
    const refreshed = player ? await hydrateHp(db, await hydrateStamina(db, player)) : null;
    return response(`🎮 카카오 RPG에 오신 것을 환영합니다!\n\n${info(refreshed!)}\n${await equipmentInfo(db,refreshed!)}`,
      nextPromotion(refreshed!) && refreshed!.level >= nextPromotion(refreshed!)!.level
        ? ["전직","사냥","내정보","장비","인벤토리"] : ["사냥","내정보","장비","인벤토리"]);
  }
  const existing = await load(db, botId, userKey);
  if (!existing) return response("먼저 '게임시작'을 입력해서 캐릭터를 생성해 주세요.",["게임시작"]);
  const p = await hydrateHp(db, await hydrateStamina(db, existing));
  if (command === "전직 취소") {
    return response("전직이 취소됐어요. 스탯과 직업은 변경되지 않았습니다.", ["전직","사냥","내정보"]);
  }
  if (command === "전직") {
    if (!hasJobSchema(p) || !hasHpSchema(p)) {
      return response("⚠️ 전직 기능 준비 중입니다. Cloudflare D1에 0005 전직 SQL을 적용해 주세요.", ["내정보"]);
    }
    const next = nextPromotion(p);
    if (!next) return response("👑 3차 전직까지 모두 완료했어요!\n현재 직업: " + jobName(p));
    if (p.level < next.level) return response(
      "🔒 " + next.tier + "차 전직은 Lv." + next.level + "부터 가능합니다.\n현재 Lv." + p.level,
      ["사냥","내정보","스탯"]);
    if (next.tier === 1) return jobCard(
      "🎓 1차 전직 가능! · Lv.20",
      "전사·도적·마법사 중 직업을 선택해 주세요.\n⚠️ 전직 확정 시 기존 투자 스탯을 초기화하고 포인트를 전액 돌려줍니다.",
      ["전사","도적","마법사"].map(name=>({label:name,messageText:name+" 선택"}))
    );
    const kind = jobClass(p);
    if (kind === "adventurer") return response("직업 정보를 확인할 수 없습니다. 관리자에게 문의해 주세요.");
    return jobCard("🎓 " + next.tier + "차 전직 가능! · Lv." + next.level,
      promotionPreview(p, kind), [
        {label:"전직 확정",messageText:"전직 확정"},
        {label:"취소",messageText:"전직 취소"}
      ]);
  }
  const picked = ({
    "전사 선택":"warrior","도적 선택":"rogue","마법사 선택":"mage"
  } as Record<string,BaseClass>)[command];
  if (picked) {
    const next = nextPromotion(p);
    if (!next || next.tier !== 1 || p.level < 20) {
      return response("1차 전직 직업은 Lv.20 이상인 모험가만 선택할 수 있어요.", ["전직"]);
    }
    return jobCard("🎓 " + (picked==="warrior"?"전사":picked==="rogue"?"도적":"마법사") + " 전직 확인",
      promotionPreview(p,picked),[
        {label:"전직 확정",messageText:command.replace(" 선택"," 전직 확정")},
        {label:"취소",messageText:"전직 취소"}
      ]);
  }
  const firstCommit = ({
    "전사 전직 확정":"warrior","도적 전직 확정":"rogue","마법사 전직 확정":"mage"
  } as Record<string,BaseClass>)[command];
  if (firstCommit || command === "전직 확정") {
    const next = nextPromotion(p);
    if (!next) return response("✅ 모든 전직을 완료했습니다.", ["내정보","사냥"]);
    if ((firstCommit && next.tier !== 1) || (!firstCommit && next.tier === 1)) {
      return response("⚠️ 현재 전직 단계에 맞지 않는 요청입니다. '전직'에서 다시 선택해 주세요.", ["전직"]);
    }
    const chosen = firstCommit || jobClass(p);
    if (chosen === "adventurer") return response("⚠️ 전직할 직업을 먼저 선택해 주세요.", ["전직"]);
    const result = await promote(db,p,chosen);
    return response(result.message,result.ok?["스탯","지능 올리기","힘 올리기","내정보"]:["전직","내정보"]);
  }
  if (command === "장비") {
    return jobCard("🛡️ 착용 장비 3슬롯",
      await equipmentInfo(db,p)+"\n💰 보유 골드 "+p.gold.toLocaleString()+"G",
      [{label:"강화",messageText:"강화"},
       {label:"인벤토리",messageText:"인벤토리"},
       {label:"사냥",messageText:"사냥"}]);
  }
  if (command === "강화") {
    return jobCard("⚒️ 어떤 장비를 강화할까요?",
      await equipmentInfo(db,p)+"\n\n강화 최대 +20. 성공·유지·하락·파괴 확률은 강화 화면에서 확인할 수 있어요.",
      [{label:"⚔️ 무기 강화",messageText:"무기 강화"},
       {label:"🛡️ 갑옷 강화",messageText:"갑옷 강화"},
       {label:"💍 반지 강화",messageText:"반지 강화"}]);
  }
  const enhanceMatch=command.match(/^(무기|갑옷|반지) 강화(?: (실행))?$/);
  if(enhanceMatch || command==="강화 실행") {
    const selected=enhanceMatch?.[1]||"무기";
    const slot:GearSlot=selected==="갑옷"?"armor":selected==="반지"?"ring":"weapon";
    const execute=command==="강화 실행"||enhanceMatch?.[2]==="실행";
    if(execute) {
      const result=await enhance(db,p,slot);
      return jobCard("⚒️ "+selected+" 강화 결과",result,
        [{label:"다시 "+selected+" 강화",messageText:selected+" 강화"},
         {label:"강화 메뉴",messageText:"강화"},
         {label:"장비",messageText:"장비"}]);
    }
    const item=await equipped(db,p.id,slot);
    if(!item)return jobCard("⚒️ "+selected+" 강화",
      SLOT_LABEL[slot]+" 슬롯이 비어 있어요.\n사냥에서 획득하거나 인벤토리에서 장착해 주세요.",
      [{label:"인벤토리",messageText:"인벤토리"},{label:"강화 메뉴",messageText:"강화"}]);
    if(item.upgrade_level>=20)return jobCard("🏆 "+selected+" +20 달성!",
      display(item)+"\n이미 최대 강화에 도달했습니다.",
      [{label:"강화 메뉴",messageText:"강화"},{label:"장비",messageText:"장비"}]);
    return jobCard("⚒️ "+selected+" +"+item.upgrade_level+" → +"+(item.upgrade_level+1),
      display(item)+"\n💰 필요 "+cost(item.rarity,item.upgrade_level).toLocaleString()+
      "G / 보유 "+p.gold.toLocaleString()+"G\n\n"+oddsLine(item.upgrade_level)+
      "\n\n⚠️ 하락은 -1강, 파괴 시 해당 장비가 사라집니다. 골드는 결과와 관계없이 소모돼요.",
      [{label:selected+" 강화 실행",messageText:selected+" 강화 실행"},
       {label:"강화 메뉴",messageText:"강화"},
       {label:"장비",messageText:"장비"}]);
  }
  const inventoryMatch=command.match(/^인벤토리(?:\s+(\d+))?$/);
  if(inventoryMatch) {
    const page=inventoryMatch[1]?Number(inventoryMatch[1]):1;
    if(!Number.isSafeInteger(page)||page<1||page>100000)
      return response("⚠️ 올바른 인벤토리 페이지를 입력해 주세요.",["인벤토리"]);
    const content=await inventory(db,p,page);
    const navigation=[
      ...(page>1?["인벤토리 "+(page-1)]:[]),
      "장착 메뉴","판매 메뉴",
      ...(content.includes("다음 페이지:")?["인벤토리 "+(page+1)]:[])
    ];
    return jobCard("🎒 인벤토리",content,[
      {label:"🛡️ 장착 메뉴",messageText:"장착 메뉴"},
      {label:"💰 판매 메뉴",messageText:"판매 메뉴"},
      {label:"장비 확인",messageText:"장비"}
    ],navigation);
  }
  // Separate action menus: show two unequipped items per page and navigation.
  const manageMenu=command.match(/^(장착|판매) 메뉴(?:\s+(\d+))?$/);
  if(manageMenu) {
    const mode=manageMenu[1] as "장착"|"판매";
    const page=manageMenu[2]?Number(manageMenu[2]):1;
    if(!Number.isSafeInteger(page)||page<1||page>100000)
      return response("⚠️ 페이지는 1 이상의 정수로 입력해 주세요.",["인벤토리"]);
    const summary=await db.prepare(
      "SELECT COUNT(*) AS total FROM equipment WHERE player_id=? AND equipped=0"
    ).bind(p.id).first<{total:number}>();
    const total=summary?.total||0;
    const pages=Math.max(1,Math.ceil(total/2));
    if(page>pages)return jobCard("🎒 "+mode+" 메뉴",
      "마지막 페이지는 "+pages+"페이지예요.",
      [{label:"마지막 페이지",messageText:mode+" 메뉴 "+pages},
       {label:"인벤토리",messageText:"인벤토리"}],
      ["장착 메뉴","판매 메뉴"]);
    const rows=await db.prepare(
      "SELECT * FROM equipment WHERE player_id=? AND equipped=0 ORDER BY id DESC LIMIT 2 OFFSET ?"
    ).bind(p.id,(page-1)*2).all<Equipment>();
    const items=rows.results||[];
    if(!items.length)return jobCard("🎒 "+mode+" 메뉴",
      mode==="장착"?"장착할 수 있는 보관 장비가 없어요.":"판매할 수 있는 미착용 장비가 없어요.",
      [{label:"인벤토리",messageText:"인벤토리"},
       {label:mode==="장착"?"판매 메뉴":"장착 메뉴",
        messageText:mode==="장착"?"판매 메뉴":"장착 메뉴"}],
      ["사냥","장비"]);
    const lines=items.map(item=>
      "#"+item.id+" "+display(item)+(mode==="판매"
        ?"\n  💰 판매 가격 "+saleValue(item).toLocaleString()+"G":""));
    const buttons=items.map(item=>({
      label:mode+" #"+item.id,
      messageText:mode+" "+item.id
    }));
    // Put "모두 판매" directly in the third card button on every sale page.
    buttons.push(mode==="판매"
      ? {label:"💰 모두 판매",messageText:"모두 판매"}
      : page<pages
        ? {label:"다음 페이지",messageText:mode+" 메뉴 "+(page+1)}
        : {label:"인벤토리",messageText:"인벤토리"});
    return jobCard("🎒 "+mode+" 메뉴 "+page+"/"+pages,
      (mode==="장착"?"🛡️ 장착할 장비를 선택하세요. 같은 슬롯의 기존 장비는 보관됩니다.":
        "💰 판매할 장비를 선택하세요. '모두 판매'는 미착용 장비 전체에만 적용됩니다.")+
      "\n\n"+lines.join("\n\n"),buttons,
      ["인벤토리",mode==="장착"?"판매 메뉴":"장착 메뉴",
       ...(page>1?[mode+" 메뉴 "+(page-1)]:[]),
       ...(page<pages?[mode+" 메뉴 "+(page+1)]:[]),
       ...(mode==="장착"?["최고 장비 장착"]:["모두 판매"])]);
  }
  if (command === "최고 장비 장착") {
    // Pick the largest upgrade compared with the currently occupied SAME slot.
    // Repeated clicks can equip improvements across all three slots.
    const worn=await loadout(db,p.id);
    const candidates=await db.prepare(
      "SELECT * FROM equipment WHERE player_id=? AND equipped=0 ORDER BY attack_bonus DESC LIMIT 300"
    ).bind(p.id).all<Equipment>();
    let best:Equipment|null=null, gain=0;
    for(const item of candidates.results||[]) {
      const slot=slotOf(item.item_code);
      const current=worn.find(x=>slotOf(x.item_code)===slot);
      const difference=item.attack_bonus-(current?.attack_bonus||0);
      if(difference>gain){best=item;gain=difference;}
    }
    if(!best)return jobCard("🛡️ 최고 장비 장착",
      "현재 모든 슬롯에 보유한 장비 중 가장 강한 장비를 착용 중이에요.",
      [{label:"장비",messageText:"장비"},{label:"인벤토리",messageText:"인벤토리"}]);
    const result=await equip(db,p,best.id);
    return jobCard("🛡️ 최고 장비 자동 장착",result,
      [{label:"다음 장비도 확인",messageText:"최고 장비 장착"},
       {label:"장비",messageText:"장비"},
       {label:"인벤토리",messageText:"인벤토리"}]);
  }
  if(command==="모두 판매") {
    const summary=await bulkSaleSummary(db,p.id);
    if(!summary.count)return jobCard("💰 모두 판매",
      "판매할 미착용 장비가 없어요.\n🛡️ 착용 중인 무기·갑옷·반지는 판매되지 않습니다.",
      [{label:"판매 메뉴",messageText:"판매 메뉴"},
       {label:"인벤토리",messageText:"인벤토리"}]);
    return jobCard("💰 모두 판매 확인",
      "📦 판매 대상: 미착용 장비 "+summary.count+"개\n"+
      "💰 예상 획득: +"+summary.gold.toLocaleString()+"G\n\n"+
      "🛡️ 착용 중인 무기·갑옷·반지는 판매 대상에서 제외됩니다.\n\n"+
      "⚠️ 확정하면 미착용 장비를 모두 삭제합니다. 복구할 수 없습니다.",
      [{label:"모두 판매 확정",
        messageText:"모두 판매 확정 "+p.version+" "+summary.count+" "+summary.gold+" "+summary.newest},
       {label:"취소",messageText:"판매 취소"},
       {label:"판매 메뉴",messageText:"판매 메뉴"}],
      ["인벤토리"]);
  }
  const allSaleConfirm=command.match(/^모두 판매 확정\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/);
  if(allSaleConfirm) {
    const args=allSaleConfirm.slice(1).map(Number);
    if(args.some(x=>!Number.isSafeInteger(x)||x<0) || args[1]===0)
      return response("⚠️ 모두 판매 확인 데이터가 올바르지 않아요.",["모두 판매","판매 메뉴"]);
    const result=await sellAll(db,p,args[0],
      {count:args[1],gold:args[2],newest:args[3]});
    return jobCard("💰 모두 판매 결과",result,
      [{label:"판매 메뉴",messageText:"판매 메뉴"},
       {label:"인벤토리",messageText:"인벤토리"},
       {label:"장비 확인",messageText:"장비"}],
      ["사냥","장착 메뉴"]);
  }
  if(command==="판매 취소")
    return jobCard("💰 판매 취소","장비는 판매되지 않았습니다.",
      [{label:"판매 메뉴",messageText:"판매 메뉴"},
       {label:"인벤토리",messageText:"인벤토리"}]);
  const saleConfirm=command.match(/^판매 확정\s+(\d+)$/);
  if(saleConfirm) {
    const id=Number(saleConfirm[1]);
    if(!Number.isSafeInteger(id)||id<1)
      return response("⚠️ 장비 번호가 올바르지 않습니다.",["판매 메뉴"]);
    const result=await sell(db,p,id);
    return jobCard("💰 장비 판매 결과",result,
      [{label:"판매 메뉴",messageText:"판매 메뉴"},
       {label:"장착 메뉴",messageText:"장착 메뉴"},
       {label:"인벤토리",messageText:"인벤토리"}],
      ["장비","사냥"]);
  }
  const gearAction=command.match(/^(장착|판매)\s+(\d+)$/);
  if(gearAction) {
    const id=Number(gearAction[2]);
    if(!Number.isSafeInteger(id)||id<1)
      return response("⚠️ 장비 번호가 올바르지 않습니다.",["인벤토리"]);
    if(gearAction[1]==="판매") {
      const item=await db.prepare("SELECT * FROM equipment WHERE id=? AND player_id=?")
        .bind(id,p.id).first<Equipment>();
      if(!item)return response("⚠️ 해당 장비가 인벤토리에 없어요.",["판매 메뉴"]);
      if(item.equipped)return response(
        "⚠️ 착용 중인 장비는 판매할 수 없어요. 다른 장비를 장착해 주세요.",
        ["장착 메뉴","판매 메뉴"]);
      return jobCard("💰 장비 판매 확인",
        "판매할 장비\n"+display(item)+"\n\n💰 판매 가격: "+
        saleValue(item).toLocaleString()+"G\n\n⚠️ 판매한 장비는 복구할 수 없습니다.",
        [{label:"판매 확정",messageText:"판매 확정 "+id},
         {label:"취소",messageText:"판매 취소"},
         {label:"판매 메뉴",messageText:"판매 메뉴"}],
        ["인벤토리"]);
    }
    const result=await equip(db,p,id);
    return jobCard("🛡️ 장비 장착 결과",result,
      [{label:"장착 메뉴",messageText:"장착 메뉴"},
       {label:"판매 메뉴",messageText:"판매 메뉴"},
       {label:"인벤토리",messageText:"인벤토리"}],
      ["장비","강화"]);
  }
  if (command === "내정보") return response(info(p)+"\n"+await equipmentInfo(db,p));
  const groundListMatch=command.match(/^사냥터 목록(?:\s+(\d+))?$/);
  if(groundListMatch) {
    if(!hasGroundSchema(p))return response(
      "⚠️ 사냥터 선택 기능을 사용하려면 D1에 0008_hunting_grounds.sql을 먼저 실행해 주세요.",
      ["내정보"]);
    const page=groundListMatch[1]?Number(groundListMatch[1]):1;
    const unlocked=GROUNDS.filter(g=>p.level>=g.minLevel);
    const pages=Math.ceil(unlocked.length/2);
    if(!Number.isSafeInteger(page)||page<1||page>pages)
      return response("⚠️ 사냥터 페이지 범위를 확인해 주세요. (1~"+pages+")",["사냥터 목록"]);
    const shown=unlocked.slice((page-1)*2,page*2);
    const buttons=shown.map(g=>({
      label:g.id+". "+g.name,messageText:"사냥터 이동 "+g.id
    }));
    buttons.push(page<pages
      ? {label:"다음 사냥터",messageText:"사냥터 목록 "+(page+1)}
      : {label:"자동 추천",messageText:"추천 사냥터"});
    return jobCard("🗺️ 레벨별 사냥터 "+page+"/"+pages,
      "⭐ 내 레벨 "+p.level+" | 현재 "+currentGround(p).name+"\n"+
      "몬스터 레벨은 선택한 지역과 내 레벨을 기준으로 정해져요.\n"+
      "스테이지는 누적 기록이며 적의 강함에 영향을 주지 않아요.\n\n"+
      groundList(p.level),buttons,
      ["사냥터","추천 사냥터",
       ...(page>1?["사냥터 목록 "+(page-1)]:[]),
       ...(page<pages?["사냥터 목록 "+(page+1)]:[])]);
  }
  const moveGroundMatch=command.match(/^사냥터 이동\s+(\d+)$/);
  if(command==="추천 사냥터"||moveGroundMatch) {
    if(!hasGroundSchema(p))return response(
      "⚠️ Cloudflare D1에 0008_hunting_grounds.sql을 먼저 적용해 주세요.",["내정보"]);
    const target=command==="추천 사냥터"
      ? suggestedGround(p.level)
      : GROUNDS.find(g=>g.id===Number(moveGroundMatch![1]));
    if(!target)return response("⚠️ 해당 사냥터가 없어요.",["사냥터 목록"]);
    if(p.level<target.minLevel)return jobCard("🔒 사냥터 잠김",
      target.name+"은(는) Lv."+target.minLevel+"부터 입장할 수 있어요.\n현재 Lv."+p.level,
      [{label:"사냥터 목록",messageText:"사냥터 목록"},
       {label:"추천 사냥터",messageText:"추천 사냥터"}]);
    const choice=command==="추천 사냥터"?"auto":String(target.id);
    const sameZone=currentGround(p).id===target.id;
    if(choice===p.hunting_ground && sameZone)
      return jobCard("🏞️ 이미 선택한 사냥터",target.name+"\n👹 몬스터 Lv."+
        targetMonsterLevel(p.level,target)+
        "\n기존 몬스터의 남은 HP를 유지합니다.",
        [{label:"사냥",messageText:"사냥"},{label:"사냥터",messageText:"사냥터"},
         {label:"사냥터 목록",messageText:"사냥터 목록"}]);
    // Traveling to another zone starts a fresh encounter; the old foe is not
    // allowed to leak its high stage-scaled level into the selected zone.
    const mob=makeMonster(p.stage,p.level,target);
    const sql=sameZone
      ? "UPDATE players SET hunting_ground=?,version=version+1 WHERE id=? AND version=?"
      : "UPDATE players SET hunting_ground=?,monster_name=?,monster_level=?,"+
        "monster_hp=?,monster_max_hp=?,version=version+1 WHERE id=? AND version=?";
    const args=sameZone
      ? [choice,p.id,p.version]
      : [choice,mob.name,mob.level,mob.hp,mob.maxHp,p.id,p.version];
    const result=await db.prepare(sql).bind(...args).run();
    if(result.meta.changes!==1)
      return response("⏳ 사냥터가 변경됐어요. 다시 확인해 주세요.",["사냥터"]);
    return jobCard("✅ 사냥터 선택 완료",
      target.name+" (Lv."+target.minLevel+"~"+target.maxLevel+")\n"+
      "👹 출현 몬스터 Lv."+mob.level+"\n"+
      (sameZone?"진행 중인 몬스터 HP는 유지됩니다.":
        "새 지역으로 이동하여 새 몬스터가 등장합니다.")+
      (choice==="auto"?"\n🔄 레벨에 따라 자동으로 사냥터를 변경합니다.":""),
      [{label:"사냥",messageText:"사냥"},
       {label:"사냥터 확인",messageText:"사냥터"},
       {label:"사냥터 목록",messageText:"사냥터 목록"}]);
  }
  if(command==="사냥터") {
    if(!hasMonsterSchema(p)||!hasGroundSchema(p))return response(
      "⚠️ 사냥터 개편 준비 중입니다. 운영 D1에 0008_hunting_grounds.sql을 실행해 주세요.",
      ["내정보"]);
    const state=await spawnMonster(db,p);
    const mob=currentMonster(state);
    if(!mob)return response("⏳ 사냥터 상태를 다시 확인해 주세요.",["사냥터"]);
    const ground=currentGround(state);
    return response("🏞️ "+ground.name+" · 몬스터 Lv."+mob.level+
      "\n🗺️ 전체 누적 처치 "+(state.stage-1)+"회"+
      "\n"+monsterView(mob)+
      "\n✅ 지역 변경은 '사냥터 목록'에서 가능해요.\n"+
      staminaText(state),["사냥","사냥터 목록","추천 사냥터","회복","내정보"],
      {...mob,stage:state.stage,ground:ground.name});
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
      return healCard("💚 이미 체력이 가득합니다!", "❤️ 현재 체력 " + cap + "/" + cap + "\n사냥을 계속할 수 있어요!");
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
      return healCard("⏳ 체력 상태가 변경됐어요", "회복 버튼을 눌러 다시 시도해 주세요.");
    }
    const healed = p.player_hp + actualHeal;
    return healCard(
      "💚 회복 성공!",
      "💊 최대 체력의 45% 회복 (" + healAmount + " HP 기준)\n" +
      "❤️ 실제 회복량 +" + actualHeal + " HP\n" +
      "❤️ 현재 체력 " + healed + "/" + cap +
      "\n\n사냥을 계속할 수 있어요!"
    );
  }
  if (command === "휴식") return response("🌿 휴식 중에도 스태미나는 자동으로 회복돼요.\n" +
    staminaText(p) + "\n" + hpText(p) + "\n스태미나는 10분마다 1, HP는 5분마다 10 회복", ["사냥","회복","출석","내정보"]);
  if (command === "도움말") return response(`🎮 사용 가능한 명령어\n${actions.join(" / ")}\n\n사냥에는 스태미나 1이 필요합니다. 연속 실행에는 1초 제한이 있습니다. 스태미나는 10분마다 1씩 자동 회복합니다. 출석은 한국시간 매일 1회 가능합니다. 회복은 사용할 때마다 최대 HP의 45%를 보충합니다.`);
  if (command === "스탯") return response(
    statText(p), ["힘 올리기","방어 올리기","민첩 올리기","지능 올리기","전직"]
  );
  // "힘 올리기" remains a 1-point action; "힘 올리기 24" spends 24
  // points in a single atomic D1 update. All four attributes are supported.
  const statMatch = command.match(/^(힘|방어|민첩|지능)\s+올리기(?:\s+(\S+))?$/);
  if (statMatch) {
    const statName = statMatch[1];
    const column = ({
      "힘": "strength", "방어": "defense",
      "민첩": "agility", "지능": "intelligence"
    } as Record<string, "strength" | "defense" | "agility" | "intelligence">)[statName];
    const countText = statMatch[2];
    if (countText !== undefined && !/^\d{1,8}$/.test(countText)) {
      return response("⚠️ 스탯 개수는 1 이상의 정수로 입력해 주세요.\n예: 힘 올리기 24", ["스탯"]);
    }
    const amount = countText === undefined ? 1 : Number(countText);
    if (!Number.isSafeInteger(amount) || amount < 1) {
      return response("⚠️ 스탯은 1개 이상 올려야 해요.\n예: 힘 올리기 24", ["스탯"]);
    }
    if (column === "intelligence" && !hasJobSchema(p)) {
      return response("⚠️ 지능 스탯은 D1 전직 업데이트(0005)가 필요합니다.", ["스탯"]);
    }
    if (p.stat_points < amount) {
      return response(
        "⚠️ 스탯 포인트가 부족합니다.\n" +
        "✨ 보유 " + p.stat_points + "P / 요청 " + amount + "P\n" +
        "포인트가 부족하면 아무것도 변경되지 않아요.",
        ["스탯","사냥"]
      );
    }
    // Defense increases both maximum and current HP by 8 per point.
    const heal = column === "defense" && hasHpSchema(p);
    const sql = "UPDATE players SET " + column + "=" + column + "+?," +
      "stat_points=stat_points-?,version=version+1" +
      (heal ? ",player_hp=player_hp+?" : "") +
      " WHERE id=? AND version=? AND stat_points>=?";
    const result = await db.prepare(sql).bind(
      amount, amount, ...(heal ? [amount * 8] : []), p.id, p.version, amount
    ).run();
    if (result.meta.changes !== 1) return response(
      "⏳ 포인트 상태가 바뀌었어요. 스탯을 다시 확인해 주세요.", ["스탯"]
    );
    const fresh = await load(db,botId,userKey);
    return response(
      "✅ " + statName + " +" + amount + " 적용! (스탯 포인트 -" + amount + ")\n\n" +
      statText(fresh!),
      ["힘 올리기","방어 올리기","민첩 올리기","지능 올리기","사냥","전직"]
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
      if (!hasGroundSchema(p)) return response(
        "⚠️ 운영 D1에 0008_hunting_grounds.sql을 적용해 주세요. 사냥터가 안전하게 구성된 다음 사냥할 수 있어요.",
        ["사냥터","내정보"]);
      if (hasHpSchema(p) && p.player_hp <= 0) return response(
        "💔 체력이 부족해서 사냥할 수 없어요.\n" + hpText(p) +
        "\n회복 또는 휴식 후 다시 도전해 주세요.", ["회복","휴식","내정보","스탯"]
      );
      const ready=await spawnMonster(db,p);
      const outcome = await monsterBattle(db, ready, nowMs);
      return response(outcome.text, ["사냥","회복","사냥터 목록","장비","인벤토리","강화"], outcome.monster);
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
