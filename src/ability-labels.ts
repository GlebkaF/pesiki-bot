import { abilityNames, ultimateTypes, abilityCatalogSource } from "./ability-catalog.js";

export { abilityCatalogSource };
export const ABILITY_CATALOG_VERSION=abilityCatalogSource.version;

/** Human-readable game names; unknown names are formatted, never classified by name. */
export function abilityLabel(name:string):string {
  if(name==="unknown_or_attack")return "Атака / источник не указан";
  if(name==="unknown"||name==="dota_unknown"||!name)return "Источник не указан";
  return Object.hasOwn(abilityNames,name)?abilityNames[name]:name.replace(/^item_/,"").replace(/_/g," ");
}

/**
 * Explicit AbilityType from the pinned Valve KV mirror, not ability-slot inference.
 * null means no explicit type in this snapshot. This is a current catalog, not
 * proof of a historical match's patch. Valve also labels auxiliary stop/return
 * buttons as Ultimate; this function must not imply successful ultimate activations.
 */
export function abilityIsUltimate(name:string):boolean|null {
  return Object.hasOwn(ultimateTypes,name)?ultimateTypes[name]:null;
}
