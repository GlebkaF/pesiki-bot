const OPENDOTA_API_BASE = "https://api.opendota.com/api";

export interface Item {
  id: number;
  name: string;
  dname: string;
  cost: number;
}

// Cache for items data
let itemsCache: Map<number, Item> | null = null;

/**
 * Fetches all items from OpenDota API
 * Results are cached for the lifetime of the process
 */
export async function fetchItems(): Promise<Map<number, Item>> {
  if (itemsCache) {
    return itemsCache;
  }

  const url = `${OPENDOTA_API_BASE}/constants/items`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `OpenDota API error: ${response.status} ${response.statusText}`
    );
  }

  const itemsObj: Record<string, { id: number; dname: string; cost: number }> = await response.json();
  
  // Convert object to Map by item ID
  itemsCache = new Map();
  for (const [name, item] of Object.entries(itemsObj)) {
    if (item.id && item.dname) {
      itemsCache.set(item.id, {
        id: item.id,
        name,
        dname: item.dname,
        cost: item.cost || 0,
      });
    }
  }

  console.log(`[ITEMS] Loaded ${itemsCache.size} items from OpenDota`);
  return itemsCache;
}

/**
 * Gets item name by ID
 * Returns "Unknown Item" if not found
 */
export async function getItemName(itemId: number): Promise<string> {
  if (itemId === 0) return ""; // Empty slot
  
  const items = await fetchItems();
  const item = items.get(itemId);
  return item?.dname ?? `Item #${itemId}`;
}

/**
 * Gets multiple item names by IDs
 * Returns array of item names in the same order
 */
export async function getItemNames(itemIds: number[]): Promise<string[]> {
  const items = await fetchItems();
  return itemIds.map((id) => {
    if (id === 0) return "";
    return items.get(id)?.dname ?? `Item #${id}`;
  });
}

/**
 * Clears the items cache (useful for testing)
 */
export function clearItemsCache(): void {
  itemsCache = null;
}
