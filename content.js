// Inject styles for price badges
const style = document.createElement("style");
style.textContent = `
  .eq-price-badge {
    display: inline-block;
    margin-left: 6px;
    font-size: 0.82em;
    font-weight: bold;
    border-radius: 3px;
    padding: 1px 5px;
    vertical-align: middle;
    white-space: nowrap;
  }
  .eq-price-badge.loading {
    background: #e8e8e8;
    color: #888;
    border: 1px solid #ccc;
  }
  .eq-price-badge.has-price {
    background: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
    cursor: pointer;
  }
  .eq-price-badge.no-price {
    background: #f8f9fa;
    color: #aaa;
    border: 1px solid #dee2e6;
    font-weight: normal;
  }
  .eq-price-badge.error {
    background: #fff3cd;
    color: #856404;
    border: 1px solid #ffc107;
    font-weight: normal;
    cursor: pointer;
  }
`;
document.head.appendChild(style);

function extractItemName(text) {
  return text.replace(/\s*\((quested|dropped|crafted|no-drop|lore|magic|score:[^)]*)\)[^(]*/gi, "").trim();
}

function formatPp(val) {
  if (val == null) return null;
  return Number(val).toLocaleString() + "pp";
}

function makeBadge() {
  const badge = document.createElement("span");
  badge.className = "eq-price-badge loading";
  badge.textContent = "…";
  return badge;
}

function setBadgePrice(badge, itemName, data) {
  if (!data) {
    badge.className = "eq-price-badge no-price";
    badge.textContent = "no price";
    badge.title = `No price data found on AraduneAuctions for "${itemName}"`;
    return;
  }

  const avgStr = formatPp(data.average);
  const latestStr = formatPp(data.latest);

  if (!avgStr && !latestStr) {
    badge.className = "eq-price-badge no-price";
    badge.textContent = "no price";
    badge.title = `No price data found on AraduneAuctions for "${itemName}"`;
    return;
  }

  badge.className = "eq-price-badge has-price";
  badge.textContent = avgStr || latestStr;
  badge.title = [
    `AraduneAuctions (selling):`,
    avgStr    ? `  Average: ${avgStr}`      : null,
    latestStr ? `  Latest:  ${latestStr}`   : null,
    data.count ? `  Sales:   ${data.count}` : null,
    `\nClick to view on AraduneAuctions`,
  ].filter(Boolean).join("\n");

  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(`https://araduneauctions.net/?q=${encodeURIComponent(itemName)}&selling=1`, "_blank");
  });
}

function setBadgeError(badge, itemName) {
  badge.className = "eq-price-badge error";
  badge.textContent = "error";
  badge.title = `Error fetching price for "${itemName}". Click to search manually.`;
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(`https://araduneauctions.net/?q=${encodeURIComponent(itemName)}&selling=1`, "_blank");
  });
}

// ---------------------------------------------------------------------------
// Batching — collect all item names found on the page, debounce 150ms,
// then send ONE message to the background with all names at once.
// ---------------------------------------------------------------------------
const processed = new WeakSet();
const pendingBadges = new Map(); // itemName → badge[]
let batchTimer = null;

function scheduleBatch() {
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(flushBatch, 150);
}

async function flushBatch() {
  batchTimer = null;
  if (!pendingBadges.size) return;

  const batch = new Map(pendingBadges);
  pendingBadges.clear();

  try {
    const prices = await browser.runtime.sendMessage({
      type: "fetchPrices",
      itemNames: Array.from(batch.keys()),
    });

    for (const [name, badges] of batch) {
      const data = prices?.[name] ?? null;
      for (const badge of badges) setBadgePrice(badge, name, data);
    }
  } catch (_) {
    for (const [name, badges] of batch) {
      for (const badge of badges) setBadgeError(badge, name);
    }
  }
}

// ---------------------------------------------------------------------------
// DOM scanning
// ---------------------------------------------------------------------------
function findItemAnchors() {
  const byPath = Array.from(
    document.querySelectorAll('li a[href*="/item/"], li a[href*="item="], li a[href*="itemId="]')
  );
  if (byPath.length) return byPath;

  return Array.from(document.querySelectorAll("ul li a")).filter((a) => {
    const text = a.textContent.trim();
    return text.length > 3 && text.length < 80 && /^[A-Z]/.test(text);
  });
}

function processItems() {
  for (const anchor of findItemAnchors()) {
    if (processed.has(anchor)) continue;
    processed.add(anchor);

    const itemName = extractItemName(anchor.textContent.trim());
    if (!itemName || itemName.length < 3) continue;

    const badge = makeBadge();
    anchor.insertAdjacentElement("afterend", badge);

    if (!pendingBadges.has(itemName)) pendingBadges.set(itemName, []);
    pendingBadges.get(itemName).push(badge);
    scheduleBatch();
  }
}

processItems();

const observer = new MutationObserver(processItems);
observer.observe(document.body, { childList: true, subtree: true });
