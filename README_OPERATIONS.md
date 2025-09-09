
# Stonks Fix Pack — How to deploy

This bundle includes:
- `server.js` (fixed fundamentals selection, new endpoints: /api/top10, /api/top10_track, weights endpoints, scheduler-safe)
- `config/defaultWeights.json` and `config/weights.json`
- `db/migrations/20250909_add_peg3.sql`
- `scripts/fetchFundamentalsFromPolygon.js` — loads fundamentals_latest + fundamentals_history from Polygon.io
- `scripts/recomputeScores.js` — recomputes PE/PB/PS/ROE/FCF Yield/DivYield/DE and PEG(3y) into `scores`

## 0) Prereqs
- Node 18+
- `npm i better-sqlite3 axios`
- An existing SQLite DB at `data/quant.db` (set `DB_PATH` env var to override)

## 1) Copy these files into your repo
Drop the files in place, **overwriting** existing `server.js` and adding the new scripts/configs.
Commit them if you like.

## 2) Add PEG3 column (one-time)
```bash
sqlite3 data/quant.db < db/migrations/20250909_add_peg3.sql
```

## 3) Load fundamentals from Polygon
Export your key and load fundamentals for the universe of a given date:
```bash
export POLYGON_API_KEY=YOUR_KEY
node scripts/fetchFundamentalsFromPolygon.js --universe 2025-09-09
```
This fills `fundamentals_latest` and `fundamentals_history`.

## 4) Recompute ratios into `scores`
```bash
node scripts/recomputeScores.js 2025-09-09
```

## 5) (Optional) Update universe snapshot
If you need market cap & avg volume for that date:
```bash
node scripts/updateUniverseFromReference.js
```

## 6) Restart the API
```bash
pm2 stop stonks && pm2 delete stonks
PORT=4000 pm2 start server.js --name stonks
```

## 7) Sanity checks
```bash
curl -s "http://localhost:4000/api/top10?date=2025-09-09" | jq '.[0]'
curl -s "http://localhost:4000/api/scores_filtered/2025-09-09?min_mcap=0&min_vol=0&limit=5" | jq '.[0] | {ticker, pe, pb, ps, roe, fcf_yield, dividend_yield, de, peg3, market_cap}'
curl -s "http://localhost:4000/api/top10_track?start=2025-09-02&end=2025-09-09" | jq '.summary'
curl -s "http://localhost:4000/api/weights"
```

## Notes
- `PEG(3y)` uses EPS CAGR from `fundamentals_history` (latest period vs. ~36 months prior). If there isn't at least ~3 years of EPS, `peg3` will be NULL.
- The server now **selects fundamentals from `scores`** (not `fundamentals`), and joins `universe` only for `market_cap` and `avg_volume`.
- Scheduler is safe to `require('./scripts/schedule')` without calling `.start()`.
