/** Commands issued, not physical clicks or successful spell casts. Unknown types stay visible. */
export const ACTION_GROUPS = [
  {key:"move", label:"Перемещения", color:"#28a99b", types:["MOVE_TO_POSITION","MOVE_TO_TARGET","MOVE_TO_DIRECTION","PATROL","MOVE_RELATIVE"]},
  {key:"attack", label:"Атаки", color:"#e3a047", types:["ATTACK_MOVE","ATTACK_TARGET"]},
  {key:"cast", label:"Способности и предметы", color:"#9b86e9", types:["CAST_POSITION","CAST_TARGET","CAST_TARGET_TREE","CAST_NO_TARGET","CAST_TOGGLE","CAST_TOGGLE_AUTO","CAST_RUNE","VECTOR_TARGET_POSITION","CAST_RIVER_PAINT","CAST_TOGGLE_ALT","CONSUME_ITEM"]},
  {key:"inventory", label:"Инвентарь и покупки", color:"#639aca", types:["DROP_ITEM","GIVE_ITEM","PICKUP_ITEM","PURCHASE_ITEM","SELL_ITEM","DISASSEMBLE_ITEM","MOVE_ITEM","EJECT_ITEM_FROM_STASH","SET_ITEM_COMBINE_LOCK","PREGAME_ADJUST_ITEM_ASSIGNMENT","DROP_ITEM_AT_FOUNTAIN","TAKE_ITEM_FROM_NEUTRAL_ITEM_STASH","SET_ITEM_MARK_FOR_SELL"]},
  {key:"other", label:"Стоп и остальное", color:"#8a929e", types:[]},
] as const;
export function validActionCounts(value: unknown, actions: number): value is Record<string, number> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).every(([k,v]) => k.length <= 100 && Number.isSafeInteger(v) && v >= 0) &&
    Object.values(value).reduce((s:number,n) => s + Number(n), 0) === actions;
}
export function groupActions(counts: Record<string, number>) {
  const groups = ACTION_GROUPS.map(g => ({...g, count:0}));
  for (const [type,n] of Object.entries(counts)) {
    const key = type.replace(/^DOTA_UNIT_ORDER_/, "");
    const group = groups.find(g => (g.types as readonly string[]).includes(key)) ?? groups[groups.length-1];
    group.count += n;
  }
  return groups;
}
