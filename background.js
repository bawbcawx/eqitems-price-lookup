// Server name as shown on AraduneAuctions — Aradune merged into Frostreaver
const SERVER_NAME = "Frostreaver";

// Cache keyed by item name (lowercase), TTL 5 minutes
const priceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

// In-flight deduplication
const inFlight = new Map();

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "fetchPrice") {
    fetchPrice(message.itemName).then(sendResponse);
    return true; // keep channel open for async response
  }
});

async function fetchPrice(itemName) {
  const key = itemName.toLowerCase().trim();

  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = doFetch(itemName);
  inFlight.set(key, promise);
  try {
    const result = await promise;
    priceCache.set(key, { data: result, time: Date.now() });
    return result;
  } finally {
    inFlight.delete(key);
  }
}

async function doFetch(itemName) {
  // Step 1: search sales to resolve item ID
  const itemId = await resolveItemId(itemName);
  if (!itemId) return null;

  // Step 2: fetch price history (pre-filtered, no zero-price records)
  return await fetchHistory(itemId);
}

// Find the numeric itemId for an item name via the sales search API.
// Uses exactMatch=true first; falls back to exactMatch=false if no single result.
async function resolveItemId(itemName) {
  for (const exact of [true, false]) {
    const url =
      `https://araduneauctions.net/api/sales` +
      `?serverName=${encodeURIComponent(SERVER_NAME)}` +
      `&searchTerm=${encodeURIComponent(itemName)}` +
      `&isBuy=false` +
      `&exactMatch=${exact}` +
      `&page=1&pageSize=5`;

    try {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) continue;
      const data = await resp.json();
      // singleItem=true means the search resolved to exactly one item
      if (data.singleItem && data.singleItemId) return data.singleItemId;
    } catch (_) {
      // network error, try next
    }
  }
  return null;
}

// Fetch the price history chart data for an item.
// This endpoint only returns records with actual prices (platPrice > 0)
// and is what the website uses to display average/latest prices.
async function fetchHistory(itemId) {
  const url = `https://araduneauctions.net/api/items/${itemId}/history/${encodeURIComponent(SERVER_NAME)}`;
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resp.ok) return null;
    const data = await resp.json();

    const sellPoints = (data.points || []).filter(
      (p) => !p.isBuy && p.platPrice > 0
    );
    if (!sellPoints.length) return null;

    // Sort ascending by datetime to find latest
    sellPoints.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    const prices = sellPoints.map((p) => p.platPrice);
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const latest = prices[prices.length - 1];

    return {
      average: avg,
      latest,
      count: prices.length,
      itemId,
    };
  } catch (_) {
    return null;
  }
}
