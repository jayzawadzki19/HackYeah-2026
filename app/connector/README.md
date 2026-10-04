# Headroom Garmin connector

Moves your own Garmin Connect data into open-wearables.

Copy `.env.example` to `.env` and set `OW_BASE_URL`, `OW_API_KEY`, and `OW_USER_ID`. Garmin tokens go in `GARMIN_TOKEN_DIR` (default `~/.garminconnect`). The connector never prints them.

```bash
uv run connector login
uv run connector probe --date YYYY-MM-DD
uv run connector backfill --days 28
uv run connector serve
```

`login` asks for the Garmin email, password, and an MFA code when Garmin asks for one. None of those prompts are echoed.

`probe` fetches one calendar day, writes the raw responses under `state/probe/<date>/` (gitignored), and prints a count, the first and last timestamps, and the sampling gap for each stream.

`backfill` pushes the last N local days, including today. Run it once before the demo (`--days 28`).

`serve` polls today and yesterday every `POLL_INTERVAL_S` seconds (default 60) and listens on `PORT` (default 8787, bound to `127.0.0.1`). `POST /sync?user=jakub` runs one cycle and returns `{"pushedRecords", "latestSampleAt"}`. `GET /health` returns `{"status", "lastSuccessAt", "lastError"}`. A Garmin or open-wearables failure is logged, shown on `/health`, and the loop backs off instead of exiting.
