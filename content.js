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
    cursor: help;
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
  }
`;
document.head.appendChild(style);

// Extract item name from a link/element on eqitems.com
// Item links are like "Golden Black Sapphire Earring (dropped) (score: 3500)"
// We want just "Golden Black Sapphire Earring"
function extractItemName(text) {
  // Remove trailing parentheticals: (quested), (dropped), (crafted), (score: NNN)
  return text.replace(/\s*\((quested|dropped|crafted|no-drop|lore|magic|score:[^)]*)\)[^(]*/gi, "").trim();
}

// Format a platinum value: "1,234pp"
function formatPp(val) {
  if (val == null) return null;
  return Number(val).toLocaleString() + "pp";
}

// Build the badge element
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
  const parts = [];
  if (avgStr) parts.push("avg " + avgStr);
  if (latestStr && latestStr !== avgStr) parts.push("latest " + latestStr);

  if (!parts.length) {
    badge.className = "eq-price-badge no-price";
    badge.textContent = "no price";
    badge.title = `No price data found on AraduneAuctions for "${itemName}"`;
    return;
  }

  badge.className = "eq-price-badge has-price";
  badge.textContent = parts[0]; // show avg by default
  const tooltip = [
    `AraduneAuctions (selling):`,
    avgStr ? `  Average: ${avgStr}` : null,
    latestStr ? `  Latest:  ${latestStr}` : null,
    data.count ? `  Sales:   ${data.count}` : null,
    `\nClick to search on AraduneAuctions`,
  ]
    .filter(Boolean)
    .join("\n");
  badge.title = tooltip;

  // Make badge clickable to open search on araduneauctions
  badge.style.cursor = "pointer";
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const url = `https://araduneauctions.net/?q=${encodeURIComponent(itemName)}&selling=1`;
    window.open(url, "_blank");
  });
}

function setBadgeError(badge, itemName) {
  badge.className = "eq-price-badge error";
  badge.textContent = "fetch err";
  badge.title = `Error fetching price for "${itemName}". Click to search manually.`;
  badge.style.cursor = "pointer";
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(`https://araduneauctions.net/?q=${encodeURIComponent(itemName)}&selling=1`, "_blank");
  });
}

// Throttle: max N concurrent requests at a time
const MAX_CONCURRENT = 3;
let activeRequests = 0;
const queue = [];

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    drain();
  });
}

function drain() {
  while (activeRequests < MAX_CONCURRENT && queue.length > 0) {
    const { fn, resolve, reject } = queue.shift();
    activeRequests++;
    fn()
      .then(resolve, reject)
      .finally(() => {
        activeRequests--;
        drain();
      });
  }
}

async function lookupPrice(itemName) {
  return enqueue(() =>
    browser.runtime.sendMessage({ type: "fetchPrice", itemName })
  );
}

// Find all item anchor tags on the page.
// EQItems renders items in <li> tags; the item name is in an <a> tag.
// Links go to pages like /item/14702 or include item= / itemId= params.
function findItemAnchors() {
  const byPath = Array.from(
    document.querySelectorAll('li a[href*="/item/"], li a[href*="item="], li a[href*="itemId="]')
  );
  if (byPath.length) return byPath;

  // Fallback: any <li> anchor with title-cased text that looks like an item name
  return Array.from(document.querySelectorAll("ul li a")).filter((a) => {
    const text = a.textContent.trim();
    return text.length > 3 && text.length < 80 && /^[A-Z]/.test(text);
  });
}

const processed = new WeakSet();

async function processItems() {
  const anchors = findItemAnchors();

  for (const anchor of anchors) {
    if (processed.has(anchor)) continue;
    processed.add(anchor);

    // Get the item name — prefer the anchor's own text, strip trailing junk
    const rawText = anchor.textContent.trim();
    const itemName = extractItemName(rawText);
    if (!itemName || itemName.length < 3) continue;

    // Insert badge immediately after the anchor
    const badge = makeBadge();
    anchor.insertAdjacentElement("afterend", badge);

    // Kick off async price lookup (throttled)
    lookupPrice(itemName)
      .then((data) => setBadgePrice(badge, itemName, data))
      .catch(() => setBadgeError(badge, itemName));
  }
}

// Run on load and watch for dynamic content additions
processItems();

const observer = new MutationObserver(() => {
  processItems();
});
observer.observe(document.body, { childList: true, subtree: true });
