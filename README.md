# Investment Agent

Automated investment suggestion agent built on Google Apps Script. Runs daily, pulls your Wallbit balance and available assets, uses a two-phase Gemini architecture to select and size positions, and sends an HTML email with actionable buy recommendations — all free.

> **Disclaimer:** This tool provides informational suggestions only and does not constitute financial advice. Always make your own investment decisions.

---

## How It Works

```
Wallbit API
  ↓
Fetch balance + full asset list
(stocks + ETFs, paginated)
  ↓
Gemini Phase 1
Selects top 10 candidates
(5 ETFs + 5 stocks)
from the full list
  ↓
Yahoo Finance
Enriches the 10 candidates
with today's price, % change,
and volume signal
  ↓
Gemini Phase 2
Assigns USD amounts to each
based on intraday behavior
  ↓
HTML email digest
with tables, color-coded
by asset type
```

---

## Features

- **Two-phase AI architecture** — Phase 1: Gemini screens the full catalog and picks 10 conservative candidates. Phase 2: Gemini analyzes real-time data and distributes capital across them.
- **Yahoo Finance enrichment** — daily price change and volume signal (high/normal/low) for each candidate
- **Conservative allocation rules** — no single asset gets more than 15% or less than 7% of available capital
- **Wallbit integration** — reads live balance and full asset catalog (stocks + ETFs) via official API
- **HTML email digest** — separate tables for ETFs and stocks, with ticker, price, daily change, suggested amount, and reasoning
- **Free tier only** — Gemini API (free), Yahoo Finance (public endpoint), Wallbit API

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Google Apps Script |
| Brokerage data | Wallbit API |
| Market data | Yahoo Finance (public endpoint) |
| AI | Gemini 2.5 Flash-Lite (two-phase) |
| Notifications | Gmail (HTML email) |
| Scheduler | Apps Script time-based trigger |

---

## Setup

### 1. Get API keys

- **Gemini API key** — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free)
- **Wallbit API key** — from your Wallbit account dashboard

### 2. Deploy

1. Go to [script.google.com](https://script.google.com) and create a new project
2. Paste the contents of `Investment_Agent.gs`
3. Fill in your credentials in the `CONFIG` block:

```javascript
const CONFIG = {
  GEMINI_API_KEY:  "your_gemini_key",
  WALLBIT_API_KEY: "your_wallbit_key",
  EMAIL_DESTINO:   "your@email.com",
  HORA_EJECUCION:  9,   // 24h format
};
```

4. Run `testAgent()` manually to verify everything works
5. Run `setupTrigger()` once to activate the daily scheduler

### 3. Authorize permissions

On first run, Google will ask you to authorize Gmail access. Accept.

---

## AI Logic

### Phase 1 — Candidate Selection

Gemini receives the full list of available stocks and ETFs (name, ticker, sector) and selects 5 ETFs and 5 stocks based on conservative criteria: diversification, sector stability, and suitability for beginners.

### Phase 2 — Capital Allocation

Gemini receives the enriched data for the 10 candidates (price, daily % change, volume signal) and distributes the available balance across them, with explicit rules:

- Sum of all allocations must equal the exact balance
- No asset receives more than 15% of capital
- No asset receives less than 7% of capital
- Assets with a daily drop above 2% are penalized with reduced allocation

---

## Email Output

Daily HTML email includes:

- Available balance and total suggested investment
- ETF table: ticker, name, sector, price, daily change, suggested USD amount, and reasoning
- Stock table: same structure
- Disclaimer

---

## License

MIT
