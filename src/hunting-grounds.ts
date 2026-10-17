import type { GamePlayer } from "./features";

export type Ground = {id:number;name:string;minLevel:number;maxLevel:number;monsterIndex:number};

// The chosen zone, never the lifetime clear count, determines enemy strength.
// "auto" always follows the player's current level; manual zones stay selected.
export const GROUNDS:Ground[]=[
 {id:1,name:"🌿 초보자의 숲",minLevel:1,maxLevel:19,monsterIndex:0},
 {id:2,name:"🏕️ 고블린 야영지",minLevel:20,maxLevel:49,monsterIndex:1},
 {id:3,name:"🐺 울부짖는 계곡",minLevel:50,maxLevel:99,monsterIndex:2},
 {id:4,name:"💀 망자의 묘지",minLevel:100,maxLevel:199,monsterIndex:3},
 {id:5,name:"🪨 고대 골렘 유적",minLevel:200,maxLevel:349,monsterIndex:4},
 {id:6,name:"⚔️ 심연의 성채",minLevel:350,maxLevel:499,monsterIndex:5},
 {id:7,name:"🔥 붉은 황무지",minLevel:500,maxLevel:699,monsterIndex:4},
 {id:8,name:"🌙 고대 별빛 신전",minLevel:700,maxLevel:899,monsterIndex:3},
 {id:9,name:"🌌 천공의 균열",minLevel:900,maxLevel:1000,monsterIndex:5}
];
export function hasGroundSchema(p:GamePlayer):boolean {
 return typeof p.hunting_ground==="string";
}
export function suggestedGround(level:number):Ground {
 return GROUNDS.reduce((acc,x)=>x.minLevel<=level?x:acc,GROUNDS[0]);
}
export function currentGround(p:GamePlayer):Ground {
 const chosen=p.hunting_ground;
 if(!chosen||chosen==="auto")return suggestedGround(p.level);
 const id=Number(chosen);
 const found=GROUNDS.find(x=>x.id===id);
 return found&&p.level>=found.minLevel?found:suggestedGround(p.level);
}
export function targetMonsterLevel(playerLevel:number,ground:Ground):number {
 return Math.max(ground.minLevel,Math.min(ground.maxLevel,playerLevel));
}
export function groundList(level:number):string {
 return GROUNDS.map(x=>
   (level>=x.minLevel?"✅ ":"🔒 ")+x.id+". "+x.name+" (Lv."+
   x.minLevel+"~"+x.maxLevel+")"
 ).join("\n");
}
export function rewardForMonster(monsterLevel:number):{gold:number;exp:number} {
 return {gold:25+monsterLevel*8,exp:55+monsterLevel*15};
}
