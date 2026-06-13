const SERVER_NAME = "Frostreaver";
const CUSTOM_UA = "EQItems-Price-Lookup-Extension/1.1 (Firefox; https://github.com/bawbcawx/eqitems-price-lookup)";

// Rewrite User-Agent on all requests to araduneauctions.net
browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const headers = details.requestHeaders.filter(
      (h) => h.name.toLowerCase() !== "user-agent"
    );
    headers.push({ name: "User-Agent", value: CUSTOM_UA });
    return { requestHeaders: headers };
  },
  { urls: ["*://araduneauctions.net/*"] },
  ["blocking", "requestHeaders"]
);

// ---------------------------------------------------------------------------
// Catalog cache — fetched once per service worker lifetime, maps
// lowercase item name → { itemId, price } for instant ID resolution.
// ---------------------------------------------------------------------------
let catalogPromise = null;
let catalogMap = null; // Map<string, { itemId: number, price: number|null }>

function getCatalog() {
  if (catalogMap) return Promise.resolve(catalogMap);
  if (catalogPromise) return catalogPromise;

  catalogPromise = fetch(
    `https://araduneauctions.net/api/items/catalog?serverName=${encodeURIComponent(SERVER_NAME)}`,
    { headers: { Accept: "application/json" } }
  )
    .then((r) => r.json())
    .then((data) => {
      catalogMap = new Map();
      for (const item of data.items || []) {
        catalogMap.set(item.name.toLowerCase(), {
          itemId: item.itemId,
          price: item.price ?? null,
        });
      }
      catalogPromise = null;
      return catalogMap;
    })
    .catch(() => {
      catalogPromise = null;
      return new Map();
    });

  return catalogPromise;
}

// ---------------------------------------------------------------------------
// Bulk prices cache — keyed by sorted itemId list string, TTL 5 minutes.
// ---------------------------------------------------------------------------
const bulkCache = new Map(); // cacheKey → { data: Map<itemId, priceData>, time }
const CACHE_TTL = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Message handler — content script sends all item names at once.
// ---------------------------------------------------------------------------
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "fetchPrices") {
    fetchPrices(message.itemNames).then(sendResponse);
    return true;
  }
});

async function fetchPrices(itemNames) {
  const catalog = await getCatalog();

  // Resolve names → itemIds using catalog; collect any not found for fallback
  const resolved = new Map(); // itemId → itemName (first match)
  const notFound = [];

  for (const name of itemNames) {
    const entry = catalog.get(name.toLowerCase());
    if (entry) {
      // Use first name that maps to this itemId
      if (!resolved.has(entry.itemId)) resolved.set(entry.itemId, name);
    } else {
      notFound.push(name);
    }
  }

  // Bulk price fetch for all resolved IDs in one call
  const itemIds = Array.from(resolved.keys());
  const bulkPrices = itemIds.length ? await fetchBulkPrices(itemIds) : new Map();

  // Build result map: itemName → { average, latest, count }
  const result = {};

  for (const [itemId, itemName] of resolved) {
    const bulk = bulkPrices.get(itemId);
    if (bulk) {
      result[itemName] = bulk;
    } else {
      // Fall back to catalog price if bulk returned nothing for this item
      const entry = catalog.get(itemName.toLowerCase());
      if (entry && entry.price != null) {
        result[itemName] = { average: Math.round(entry.price), latest: null, count: null };
      }
    }
  }

  // Fallback for items not in catalog: individual lookup (rare)
  for (const name of notFound) {
    const data = await fetchIndividual(name);
    if (data) result[name] = data;
  }

  return result;
}

// POST /api/prices/bulk — returns price summaries for an array of item IDs.
async function fetchBulkPrices(itemIds) {
  const cacheKey = itemIds.slice().sort((a, b) => a - b).join(",");
  const cached = bulkCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.data;

  try {
    const resp = await fetch("https://araduneauctions.net/api/prices/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ serverName: SERVER_NAME, itemIds }),
    });

    if (!resp.ok) return new Map();
    const data = await resp.json();
    const priceMap = parseBulkPricesResponse(data);
    bulkCache.set(cacheKey, { data: priceMap, time: Date.now() });
    return priceMap;
  } catch (_) {
    return new Map();
  }
}

// Parse /api/prices/bulk response — handle array or object shapes.
function parseBulkPricesResponse(data) {
  const map = new Map();

  const items = Array.isArray(data) ? data : (data.items || data.results || data.prices || []);

  for (const item of items) {
    const id = item.itemId ?? item.id;
    if (id == null) continue;

    const avg = item.averagePrice ?? item.average ?? item.avgPrice ?? null;
    const latest = item.latestPrice ?? item.latest ?? item.lastPrice ?? null;
    const count = item.sampleSize ?? item.count ?? item.totalSales ?? null;

    if (avg != null || latest != null) {
      map.set(id, {
        average: avg != null ? Math.round(avg) : null,
        latest: latest != null ? Math.round(latest) : null,
        count,
      });
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Individual fallback for items missing from the catalog.
// Uses the original two-step approach: sales search → item history.
// ---------------------------------------------------------------------------
async function fetchIndividual(itemName) {
  const itemId = await resolveItemId(itemName);
  if (!itemId) return null;
  return await fetchHistory(itemId);
}

async function resolveItemId(itemName) {
  for (const exact of [true, false]) {
    const url =
      `https://araduneauctions.net/api/sales` +
      `?serverName=${encodeURIComponent(SERVER_NAME)}` +
      `&searchTerm=${encodeURIComponent(itemName)}` +
      `&isBuy=false&exactMatch=${exact}&page=1&pageSize=5`;
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.singleItem && data.singleItemId) return data.singleItemId;
    } catch (_) {}
  }
  return null;
}

async function fetchHistory(itemId) {
  const url = `https://araduneauctions.net/api/items/${itemId}/history/${encodeURIComponent(SERVER_NAME)}`;
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) return null;
    const data = await resp.json();

    const sellPoints = (data.points || []).filter((p) => !p.isBuy && p.platPrice > 0);
    if (!sellPoints.length) return null;

    sellPoints.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    const prices = sellPoints.map((p) => p.platPrice);
    return {
      average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      latest: prices[prices.length - 1],
      count: prices.length,
    };
  } catch (_) {
    return null;
  }
}
