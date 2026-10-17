import type { GamePlayer } from "./features";

// One weapon, one armor, and one ring may be worn at once.
// Sword, dagger, and staff compete for the same weapon slot.
export const RARITIES = ["common","rare","epic","legendary","mythic"] as const;
export type Rarity = typeof RARITIES[number];
export type GearKind = "sword"|"dagger"|"staff"|"armor"|"ring";
export type GearSlot = "weapon"|"armor"|"ring";
export const SLOTS: GearSlot[] = ["weapon","armor","ring"];
export const LABEL: Record<Rarity,string> = {
  common:"⚪ 일반", rare:"🔵 희귀", epic:"🟣 영웅",
  legendary:"🟠 전설", mythic:"🔴 신화"
};
export const SLOT_LABEL:Record<GearSlot,string> = {
  weapon:"⚔️ 무기",armor:"🛡️ 갑옷",ring:"💍 반지"
};
const NAMES:Record<GearKind,Record<Rarity,string>> = {
  sword:{
    common:"낡은 철검",rare:"청명의 강철검",epic:"흑염의 마검",
    legendary:"뇌신의 심판검",mythic:"태초를 가르는 천상검"
  },
  dagger:{
    common:"무딘 단검",rare:"달빛 은단검",epic:"그림자 송곳니",
    legendary:"망령군주의 암살도",mythic:"영겁을 찢는 그림자 칼날"
  },
  staff:{
    common:"견습 마법사의 지팡이",rare:"푸른 룬의 지팡이",epic:"별빛 현자의 지팡이",
    legendary:"심연의 성좌 마도봉",mythic:"창세의 아스트랄 홀"
  },
  armor:{
    common:"낡은 가죽갑옷",rare:"강철 수호갑옷",epic:"용비늘 전투갑옷",
    legendary:"불멸왕의 수호갑주",mythic:"천상의 창세갑주"
  },
  ring:{
    common:"빛바랜 은반지",rare:"푸른 달의 계약반지",epic:"비전의 마력반지",
    legendary:"운명을 지배하는 왕의 반지",mythic:"무한의 창세 반지"
  }
};
const BASE:Record<GearKind,Record<Rarity,number>> = {
 sword:{common:5,rare:12,epic:24,legendary:42,mythic:70},
 dagger:{common:4,rare:10,epic:20,legendary:36,mythic:60},
 staff:{common:5,rare:12,epic:24,legendary:42,mythic:70},
 armor:{common:3,rare:7,epic:14,legendary:25,mythic:42},
 ring:{common:2,rare:5,epic:10,legendary:18,mythic:30}
};
const RATE:Record<Rarity,number> = {
 common:1,rare:1.35,epic:1.8,legendary:2.4,mythic:3.2
};
const KINDS: GearKind[] = ["sword","dagger","staff","armor","ring"];
export type Equipment={
 id:number;player_id:number;item_code:string;item_name:string;
 rarity:string;attack_bonus:number;upgrade_level:number;equipped:number;
};
export function kindOf(code:string):GearKind {
 return KINDS.includes(code as GearKind)?code as GearKind:"sword";
}
export function slotOf(code:string):GearSlot {
 const kind=kindOf(code);
 return kind==="armor"?"armor":kind==="ring"?"ring":"weapon";
}
export function rarityOf(s:string):Rarity {
 return (RARITIES as readonly string[]).includes(s)?s as Rarity:"common";
}
export function gearName(kind:GearKind,rarity:Rarity):string {
 return NAMES[kind][rarity];
}
export function power(rarity:string,level:number,code:GearKind="sword"):number {
 const r=rarityOf(rarity),n=Math.max(0,Math.min(20,level));
 return Math.round(BASE[code][r]*(1+0.17*n+0.022*n*n));
}
export function effect(e:Equipment):string {
 const n=e.attack_bonus,kind=kindOf(e.item_code);
 if(kind==="armor")return "받는 피해 -"+n;
 if(kind==="ring")return "공격 +"+Math.ceil(n/2)+" / 치명타 +"+Math.min(12,Math.ceil(n/8))+"%p";
 if(kind==="staff")return "공격 +"+n+" / 마법 스킬 +"+Math.ceil(n/3);
 if(kind==="dagger")return "공격 +"+n+" / 치명타 +4%p";
 return "공격 +"+n;
}
export function display(e:Equipment):string {
 const kind=kindOf(e.item_code),r=rarityOf(e.rarity);
 return LABEL[r]+" "+gearName(kind,r)+" +"+e.upgrade_level+" ("+effect(e)+")";
}
export function dropRarity(random=Math.random):Rarity {
 const n=random()*100;
 return n<60?"common":n<85?"rare":n<95?"epic":n<99?"legendary":"mythic";
}
export function dropKind(random=Math.random):GearKind {
 const n=random()*100;
 return n<22?"sword":n<40?"dagger":n<60?"staff":n<84?"armor":"ring";
}
export type DroppedGear={kind:GearKind;rarity:Rarity};
export function rollDrop(random=Math.random):DroppedGear|null {
 return random()<0.18?{kind:dropKind(random),rarity:dropRarity(random)}:null;
}
export function cost(rarity:string,level:number):number {
 return Math.round((80+35*(level+1)*(level+1))*RATE[rarityOf(rarity)]);
}
export type Odds={success:number;keep:number;down:number;destroy:number};
export function odds(level:number):Odds {
 if(level<5)return {success:85,keep:15,down:0,destroy:0};
 if(level<10)return {success:65,keep:30,down:5,destroy:0};
 if(level<15)return {success:35,keep:35,down:25,destroy:5};
 if(level<18)return {success:25,keep:30,down:35,destroy:10};
 return {success:15,keep:30,down:35,destroy:20};
}
export type Outcome="success"|"keep"|"down"|"destroy";
export function rollUpgrade(level:number,random=Math.random):Outcome {
 const p=odds(level),n=random()*100;
 if(n<p.success)return "success";
 if(n<p.success+p.keep)return "keep";
 if(n<p.success+p.keep+p.down)return "down";
 return "destroy";
}
export function oddsLine(level:number):string {
 const p=odds(level);
 return "✅ 성공 "+p.success+"% | ➖ 유지 "+p.keep+"%\n"+
   "🔻 하락 "+p.down+"% | 💥 파괴 "+p.destroy+"%";
}
const SLOT_SQL:Record<GearSlot,string>={
 weapon:"item_code IN ('sword','dagger','staff','single')",
 armor:"item_code='armor'",
 ring:"item_code='ring'"
};
export async function equipped(db:D1Database,id:number,slot:GearSlot="weapon"):Promise<Equipment|null> {
 return (await db.prepare("SELECT * FROM equipment WHERE player_id=? AND equipped=1 AND "+
   SLOT_SQL[slot]+" ORDER BY id DESC LIMIT 1").bind(id).first<Equipment>())||null;
}
export async function loadout(db:D1Database,id:number):Promise<Equipment[]> {
 const result=await db.prepare("SELECT * FROM equipment WHERE player_id=? AND equipped=1 ORDER BY id")
   .bind(id).all<Equipment>();
 return result.results||[];
}
export function bonuses(items:Equipment[]):{attack:number;guard:number;crit:number;magic:number} {
 let attack=0,guard=0,crit=0,magic=0;
 for(const e of items){
   const kind=kindOf(e.item_code),n=e.attack_bonus;
   if(kind==="armor")guard+=n;
   else if(kind==="ring"){attack+=Math.ceil(n/2);crit+=Math.min(12,Math.ceil(n/8));}
   else if(kind==="dagger"){attack+=n;crit+=4;}
   else if(kind==="staff"){attack+=n;magic+=Math.ceil(n/3);}
   else attack+=n;
 }
 return {attack,guard,crit,magic};
}
export async function equipmentInfo(db:D1Database,p:GamePlayer):Promise<string> {
 const items=await loadout(db,p.id);
 return SLOTS.map(slot=>{
   const e=items.find(x=>slotOf(x.item_code)===slot);
   return SLOT_LABEL[slot]+": "+(e?display(e):"미착용");
 }).join("\n");
}
export async function inventory(db:D1Database,p:GamePlayer,page=1):Promise<string> {
 const total=await db.prepare("SELECT COUNT(*) AS total FROM equipment WHERE player_id=?")
   .bind(p.id).first<{total:number}>();
 const number=total?.total||0;
 if(!number)return "🎒 인벤토리가 비어 있어요. 사냥으로 장비를 얻어보세요!";
 const pages=Math.ceil(number/8);
 if(page>pages)return "🎒 마지막 페이지는 "+pages+"페이지입니다.";
 const result=await db.prepare(
   "SELECT * FROM equipment WHERE player_id=? ORDER BY equipped DESC,id DESC LIMIT 8 OFFSET ?"
 ).bind(p.id,(page-1)*8).all<Equipment>();
 const lines=(result.results||[]).map(e=>
   (e.equipped?"✅ 착용 | ":"📦 보유 | ")+"#"+e.id+" "+display(e));
 return "🎒 인벤토리 "+page+"/"+pages+" ("+number+"개)\n"+lines.join("\n")+
   "\n\n아래 장착 메뉴/판매 메뉴 버튼에서 장비를 선택하세요."+(page<pages?"\n다음 페이지: 인벤토리 "+(page+1):"");
}
export async function equip(db:D1Database,p:GamePlayer,id:number):Promise<string> {
 const e=await db.prepare("SELECT * FROM equipment WHERE id=? AND player_id=?")
   .bind(id,p.id).first<Equipment>();
 if(!e)return "⚠️ 해당 장비는 인벤토리에 없어요.";
 if(e.equipped)return "✅ 이미 착용 중입니다.\n"+display(e);
 const slot=slotOf(e.item_code);
 const out=await db.batch([
   db.prepare("UPDATE players SET version=version+1 WHERE id=? AND version=?")
     .bind(p.id,p.version),
   db.prepare("UPDATE equipment SET equipped=0 WHERE player_id=? AND equipped=1 AND "+
     SLOT_SQL[slot]+" AND changes()=1 AND EXISTS(SELECT 1 FROM players WHERE id=? AND version=?)")
     .bind(p.id,p.id,p.version+1),
   db.prepare("UPDATE equipment SET equipped=1 WHERE id=? AND player_id=? AND equipped=0 AND "+
     SLOT_SQL[slot]+" AND EXISTS(SELECT 1 FROM players WHERE id=? AND version=?)")
     .bind(id,p.id,p.id,p.version+1)
 ]);
 if(out[0].meta.changes!==1||out[2].meta.changes!==1)
   return "⏳ 장착 상태가 바뀌었습니다. 인벤토리를 다시 확인해 주세요.";
 return "✅ "+SLOT_LABEL[slot]+" 장착 완료!\n"+display(e)+
   "\n같은 슬롯의 기존 장비는 인벤토리에 보관됩니다.";
}
export function saleValue(e:Equipment):number {
 return Math.round(BASE[kindOf(e.item_code)][rarityOf(e.rarity)]*15+e.upgrade_level*25);
}
export async function sell(db:D1Database,p:GamePlayer,id:number):Promise<string> {
 const e=await db.prepare("SELECT * FROM equipment WHERE id=? AND player_id=?")
   .bind(id,p.id).first<Equipment>();
 if(!e)return "⚠️ 해당 장비는 인벤토리에 없어요.";
 if(e.equipped)return "⚠️ 착용 중인 장비는 판매할 수 없어요. 다른 장비로 교체해 주세요.";
 const price=saleValue(e);
 const out=await db.batch([
   db.prepare("UPDATE players SET gold=gold+?,version=version+1 WHERE id=? AND version=? "+
     "AND EXISTS(SELECT 1 FROM equipment WHERE id=? AND player_id=? AND equipped=0)")
     .bind(price,p.id,p.version,id,p.id),
   db.prepare("DELETE FROM equipment WHERE id=? AND player_id=? AND equipped=0 AND changes()=1 "+
     "AND EXISTS(SELECT 1 FROM players WHERE id=? AND version=?)")
     .bind(id,p.id,p.id,p.version+1)
 ]);
 if(out[0].meta.changes!==1||out[1].meta.changes!==1)
   return "⏳ 판매 상태가 변경됐어요. 다시 확인해 주세요.";
 return "💰 판매 완료! "+display(e)+"\n골드 +"+price.toLocaleString()+"G";
}
export async function enhance(db:D1Database,p:GamePlayer,slot:GearSlot="weapon"):Promise<string> {
 const e=await equipped(db,p.id,slot);
 if(!e)return "⚠️ "+SLOT_LABEL[slot]+" 슬롯에 착용한 장비가 없어요.";
 if(e.upgrade_level>=20)return "🏆 "+display(e)+"\n이미 최대 강화(+20)에 도달했습니다!";
 const price=cost(e.rarity,e.upgrade_level);
 if(p.gold<price)return "💰 골드 부족!\n필요: "+price.toLocaleString()+"G / 보유: "+p.gold.toLocaleString()+"G";
 const event=rollUpgrade(e.upgrade_level);
 const level=event==="success"?e.upgrade_level+1:
   event==="down"?Math.max(0,e.upgrade_level-1):e.upgrade_level;
 const strength=power(e.rarity,level,kindOf(e.item_code));
 const mutate=event==="destroy"
   ?db.prepare("DELETE FROM equipment WHERE id=? AND player_id=? AND equipped=1 "+
     "AND upgrade_level=? AND changes()=1 AND EXISTS(SELECT 1 FROM players WHERE id=? AND version=?)")
     .bind(e.id,p.id,e.upgrade_level,p.id,p.version+1)
   :db.prepare("UPDATE equipment SET upgrade_level=?,attack_bonus=? WHERE id=? AND player_id=? "+
     "AND equipped=1 AND upgrade_level=? AND changes()=1 "+
     "AND EXISTS(SELECT 1 FROM players WHERE id=? AND version=?)")
     .bind(level,strength,e.id,p.id,e.upgrade_level,p.id,p.version+1);
 const out=await db.batch([
   db.prepare("UPDATE players SET gold=gold-?,version=version+1 WHERE id=? AND version=? AND gold>=?")
     .bind(price,p.id,p.version,price),mutate
 ]);
 if(out[0].meta.changes!==1||out[1].meta.changes!==1)
   return "⏳ 강화 상태가 바뀌었어요. 장비를 다시 확인해 주세요.";
 const heading=event==="success"?"🎉 강화 성공!":event==="keep"?"➖ 강화 유지":
   event==="down"?"🔻 강화 하락!":"💥 장비 파괴!";
 return heading+"\n"+(event==="destroy"
   ?"해당 장비가 파괴되었습니다. 다른 슬롯과 보관 장비는 그대로입니다."
   :display({...e,upgrade_level:level,attack_bonus:strength}))+
   "\n💰 소모 "+price.toLocaleString()+"G";
}
