import type { GamePlayer } from "./features";

// There is exactly one equipment slot. Items vary ONLY by rarity and upgrade.
export const RARITIES = ["common","rare","epic","legendary","mythic"] as const;
export type Rarity = typeof RARITIES[number];
const LABEL: Record<Rarity,string> = {
  common:"⚪ 일반", rare:"🔵 희귀", epic:"🟣 영웅",
  legendary:"🟠 전설", mythic:"🔴 신화"
};
const BASE: Record<Rarity,number> = {
  common:5, rare:12, epic:24, legendary:42, mythic:70
};
const RATE: Record<Rarity,number> = {
  common:1,rare:1.35,epic:1.8,legendary:2.4,mythic:3.2
};
export type Equipment = {
  id:number; player_id:number; item_code:string; item_name:string;
  rarity:string; attack_bonus:number; upgrade_level:number; equipped:number;
};
export function rarityOf(value:string):Rarity {
  return (RARITIES as readonly string[]).includes(value) ? value as Rarity : "common";
}
export function power(rarity:string,level:number):number {
  const r=rarityOf(rarity), n=Math.max(0,Math.min(20,level));
  return Math.round(BASE[r]*(1 + 0.17*n + 0.022*n*n));
}
export function display(e:Equipment):string {
  return LABEL[rarityOf(e.rarity)]+" 장비 +"+e.upgrade_level+" (공격 +"+e.attack_bonus+")";
}
export function dropRarity(random=Math.random):Rarity {
  const roll=random()*100;
  return roll<60?"common":roll<85?"rare":roll<95?"epic":roll<99?"legendary":"mythic";
}
export function rollDrop(random=Math.random):Rarity|null {
  return random()<0.18?dropRarity(random):null;
}
export function cost(rarity:string,level:number):number {
  return Math.round((80+35*(level+1)*(level+1))*RATE[rarityOf(rarity)]);
}
export type Odds={success:number;keep:number;down:number;destroy:number};
export function odds(level:number):Odds {
  if(level<5)return {success:85,keep:15,down:0,destroy:0};
  if(level<10)return {success:65,keep:30,down:5,destroy:0};
  if(level<15)return {success:45,keep:35,down:17,destroy:3};
  if(level<18)return {success:30,keep:35,down:27,destroy:8};
  return {success:20,keep:35,down:30,destroy:15};
}
export type Outcome="success"|"keep"|"down"|"destroy";
export function rollUpgrade(level:number,random=Math.random):Outcome {
  const p=odds(level),value=random()*100;
  if(value<p.success)return "success";
  if(value<p.success+p.keep)return "keep";
  if(value<p.success+p.keep+p.down)return "down";
  return "destroy";
}
export function oddsLine(level:number):string {
  const o=odds(level);
  return "✅ 성공 "+o.success+"% | ➖ 유지 "+o.keep+"%\n"+
    "🔻 하락 "+o.down+"% | 💥 파괴 "+o.destroy+"%";
}
export async function equipped(db:D1Database,playerId:number):Promise<Equipment|null> {
  return (await db.prepare(
    "SELECT * FROM equipment WHERE player_id=? AND equipped=1 ORDER BY id DESC LIMIT 1"
  ).bind(playerId).first<Equipment>())||null;
}
export async function equipmentInfo(db:D1Database,p:GamePlayer):Promise<string> {
  const e=await equipped(db,p.id);
  return e?"🛡️ 착용 장비: "+display(e)+"\n💰 강화 비용 "+(e.upgrade_level>=20?"최대 강화":cost(e.rarity,e.upgrade_level).toLocaleString()+"G"):
    "🛡️ 착용 장비가 없어요. 몬스터를 사냥해서 장비를 획득하세요!";
}
export async function inventory(db:D1Database,p:GamePlayer,page=1):Promise<string> {
  const total=await db.prepare("SELECT COUNT(*) AS total FROM equipment WHERE player_id=?")
    .bind(p.id).first<{total:number}>();
  const number=total?.total||0;
  if(!number)return "🎒 인벤토리가 비어 있어요. 사냥으로 장비를 얻어보세요!";
  const pages=Math.max(1,Math.ceil(number/8));
  if(page>pages)return "🎒 마지막 페이지는 "+pages+"페이지입니다.";
  const rows=await db.prepare(
    "SELECT * FROM equipment WHERE player_id=? ORDER BY equipped DESC,id DESC LIMIT 8 OFFSET ?"
  ).bind(p.id,(page-1)*8).all<Equipment>();
  const lines=(rows.results||[]).map(e=>
    (e.equipped?"✅ 착용 | ":"📦 보유 | ")+"#"+e.id+" "+display(e));
  return "🎒 인벤토리 "+page+"/"+pages+" ("+number+"개)\n"+lines.join("\n")+
    "\n\n장착 방법: 장착 12 (장비 번호)\n판매 방법: 판매 12\n다음 페이지: 인벤토리 "+(page+1);
}
export async function equip(db:D1Database,p:GamePlayer,id:number):Promise<string> {
  const e=await db.prepare(
    "SELECT * FROM equipment WHERE id=? AND player_id=?"
  ).bind(id,p.id).first<Equipment>();
  if(!e)return "⚠️ 해당 장비는 인벤토리에 없어요.";
  if(e.equipped)return "✅ 이미 착용 중입니다.\n"+display(e);
  const out=await db.batch([
    db.prepare("UPDATE players SET version=version+1 WHERE id=? AND version=?")
      .bind(p.id,p.version),
    db.prepare("UPDATE equipment SET equipped=0 WHERE player_id=? AND changes()=1 AND EXISTS (SELECT 1 FROM players WHERE id=? AND version=?)")
      .bind(p.id,p.id,p.version+1),
    db.prepare("UPDATE equipment SET equipped=1 WHERE id=? AND player_id=? AND changes()>0 AND EXISTS (SELECT 1 FROM players WHERE id=? AND version=?)")
      .bind(id,p.id,p.id,p.version+1)
  ]);
  if(out[0].meta.changes!==1||out[2].meta.changes!==1)
    return "⏳ 장착 상태가 바뀌었습니다. 인벤토리를 다시 확인해 주세요.";
  return "✅ 장비 장착 완료!\n"+display(e)+"\n기존 장비는 인벤토리에 보관됩니다.";
}
export async function sell(db:D1Database,p:GamePlayer,id:number):Promise<string> {
  const e=await db.prepare("SELECT * FROM equipment WHERE id=? AND player_id=?")
    .bind(id,p.id).first<Equipment>();
  if(!e)return "⚠️ 해당 장비는 인벤토리에 없어요.";
  if(e.equipped)return "⚠️ 착용 중인 장비는 판매할 수 없어요. 다른 장비를 장착한 후 판매해 주세요.";
  const price=Math.round(BASE[rarityOf(e.rarity)]*15 + e.upgrade_level*25);
  const out=await db.batch([
    db.prepare("UPDATE players SET gold=gold+?,version=version+1 WHERE id=? AND version=?")
      .bind(price,p.id,p.version),
    db.prepare("DELETE FROM equipment WHERE id=? AND player_id=? AND equipped=0 AND changes()=1 AND EXISTS (SELECT 1 FROM players WHERE id=? AND version=?)")
      .bind(id,p.id,p.id,p.version+1)
  ]);
  if(out[0].meta.changes!==1||out[1].meta.changes!==1)
    return "⏳ 판매 상태가 변경됐어요. 인벤토리를 다시 확인해 주세요.";
  return "💰 판매 완료! "+display(e)+"\n골드 +"+price.toLocaleString()+"G";
}
export async function enhance(db:D1Database,p:GamePlayer):Promise<string> {
  const e=await equipped(db,p.id);
  if(!e)return "⚠️ 착용한 장비가 없어요. 인벤토리에서 장착해 주세요.";
  if(e.upgrade_level>=20)return "🏆 "+display(e)+"\n이미 최대 강화(+20)에 도달했습니다!";
  const price=cost(e.rarity,e.upgrade_level);
  if(p.gold<price)return "💰 골드 부족!\n필요: "+price.toLocaleString()+"G / 보유: "+p.gold.toLocaleString()+"G";
  const event=rollUpgrade(e.upgrade_level);
  const level=event==="success"?e.upgrade_level+1:event==="down"?Math.max(0,e.upgrade_level-1):e.upgrade_level;
  const nextPower=power(e.rarity,level);
  const statement=event==="destroy"
    ? db.prepare("DELETE FROM equipment WHERE id=? AND player_id=? AND equipped=1 AND upgrade_level=? AND changes()=1 AND EXISTS (SELECT 1 FROM players WHERE id=? AND version=?)")
      .bind(e.id,p.id,e.upgrade_level,p.id,p.version+1)
    : db.prepare("UPDATE equipment SET upgrade_level=?,attack_bonus=? WHERE id=? AND player_id=? AND equipped=1 AND upgrade_level=? AND changes()=1 AND EXISTS (SELECT 1 FROM players WHERE id=? AND version=?)")
      .bind(level,nextPower,e.id,p.id,e.upgrade_level,p.id,p.version+1);
  const out=await db.batch([
    db.prepare("UPDATE players SET gold=gold-?,version=version+1 WHERE id=? AND version=? AND gold>=?")
      .bind(price,p.id,p.version,price),statement
  ]);
  if(out[0].meta.changes!==1||out[1].meta.changes!==1)
    return "⏳ 강화 상태가 바뀌었습니다. 장비 상태를 다시 확인해 주세요.";
  const prefix=event==="success"?"🎉 강화 성공!":event==="keep"?"➖ 강화 유지":event==="down"?"🔻 강화 하락!":"💥 장비 파괴!";
  return prefix+"\n"+(event==="destroy"
    ?"착용 장비가 파괴되었습니다. 인벤토리의 다른 장비를 장착하세요."
    :display({...e,upgrade_level:level,attack_bonus:nextPower}))+
    "\n💰 소모 "+price.toLocaleString()+"G";
}
