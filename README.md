# EQItems Price Lookup

A Firefox extension that displays live auction prices from [AraduneAuctions.net](https://araduneauctions.net) directly on [EQItems.com](https://eqitems.com) Best-in-Slot search results.

---

## What it does

When you run a Best-in-Slot search on EQItems.com, a green price badge automatically appears next to each item showing the average recent selling price on the Frostreaver server — no tab switching or manual searching required.

![Screenshot placeholder — add your own]()

**Each badge shows:**
- Average selling price (e.g. `avg 666pp`)
- Hover for a tooltip with average price, latest sale price, and number of recorded sales
- Click the badge to open that item's full auction history on AraduneAuctions.net

---

## Installation

**[Install from Firefox Add-ons (AMO)](https://addons.mozilla.org/en-US/firefox/addon/eqitems-price-display/)**

> ⏳ Currently awaiting review from Mozilla. Check back soon!

---

## How it works

The extension makes two lightweight API calls to AraduneAuctions.net per item:

1. `/api/sales` — resolves the item name to a numeric item ID
2. `/api/items/{id}/history/Frostreaver` — fetches recent sell records with actual prices

Results are cached for 5 minutes so browsing through multiple search results is fast and doesn't hammer the API.

No user data is collected or transmitted. Only item names from the EQItems.com page are sent as search terms to the AraduneAuctions.net public API.

---

## Manual installation (while awaiting AMO review)

1. Download or clone this repository
2. Open Firefox and go to `about:debugging`
3. Click **This Firefox** → **Load Temporary Add-on...**
4. Navigate to the folder and select `manifest.json`

The extension will stay active until you close Firefox.

---

## Server

This extension is currently hardcoded to the **Frostreaver** server on AraduneAuctions.net (the merged Aradune/Rizlona server). If there is interest in supporting other servers, open an issue and I'll look into adding a settings page.

---

## Contributing

Bug reports and suggestions are welcome — open an [Issue](../../issues) and describe what you're seeing. Pull requests are also welcome for anyone who wants to pitch in.

---

## License

[MIT](LICENSE)
