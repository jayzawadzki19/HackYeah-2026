# Headroom

Headroom looks forward. It learns how demanding your past meetings were from your own body, forecasts the load of the meetings still ahead, and compares that with today's capacity. When the day is too full, it gives a concrete next step: an earlier lights-out, a moved workout, a walk before a hard meeting, a walking 1:1, or a recovery block.

The demo persona is Marta. Jakub is the live Garmin account.

## What you need

Docker Desktop, and the [open-wearables](https://github.com/the-momentum/open-wearables) fork checked out next to this repo on `feat/sdk-garmin-wellness-metrics`:

```text
healhcare/
  HackYeah-2026/
  open-wearables/
```

`open-wearables/backend/config/.env` must exist before the first start. Copy it from that repo's example and set `OUTGOING_WEBHOOKS_ENABLED=true`. The file stays local.

## Build and run

From this directory:

```bash
docker compose up --build
```

The first start builds the Headroom image, boots open-wearables, creates the API users and webhook, and loads Marta's six weeks of synthetic health data. Open http://127.0.0.1:4200/marta/briefing. Jakub is at http://127.0.0.1:4200/jakub/briefing.

Postgres stays inside the Docker network and is not published on port 5432.

To build the image without starting it:

```bash
docker compose build
```

## Your Garmin data

Login is interactive. The password and any MFA code are prompted and are not stored in the repo.

```bash
docker compose run --rm -it headroom login
docker compose restart headroom
```

The session is kept in `~/.garminconnect` on the host and mounted into the container.

## Local development

bun 1.3 and uv are required. Open-wearables still comes from the compose file above.

```bash
cd app/api && bun install && bun test && bun run start:dev
cd app/web && bun install && bun run start:live
cd app/connector && uv sync && uv run connector serve
```

`bun run start` in `app/web` serves the mocked happy path and does not call the API. `bun run start:live` proxies `/api` to http://localhost:3001.
