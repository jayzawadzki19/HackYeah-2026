# Headroom - demo happy path

This is the exact flow shown to the jury. It doubles as the end-to-end acceptance spec: every step has a check that a Playwright test (or a human) can verify.

Working name: **Headroom** - a calendar-aware recovery forecast. Your watch tells you how recovered you are now; Headroom tells you whether you are ready for what is coming and what to do about it.

## Demo at a glance

| Item | Value |
|---|---|
| Target duration | 3:30 (hard cap 4:00) |
| Accounts | **Jakub** - live, real Garmin data. **Marta** - synthetic founder persona, labelled "Demo persona - synthetic data" everywhere |
| Screens used | Briefing, Week, Meeting detail, Energy map, Check-in |
| Hardware | Laptop with the web app at mobile width (390 x 844), Jakub's iPhone with Garmin Connect, Garmin watch on Jakub's wrist |
| "Now" | Real wall-clock time. Persona data is generated relative to the demo day, so "tomorrow" is always the heavy day |

## Pre-demo checklist (T-30 min)

1. open-wearables stack is up with `OUTGOING_WEBHOOKS_ENABLED=true`; `docker compose ps` shows all services healthy and `http://localhost:8000/docs` loads.
2. Connector is running and authenticated with Garmin Connect; last successful poll is under 2 minutes old (`GET http://localhost:8787/health`).
3. Persona regenerated today: `bun run persona:generate --seed 2026` (history = previous 42 days, heavy day = tomorrow).
4. `app/api/data/calendars/jakub.json` contains the real HackYeah events with their real times: mentor sessions, team syncs, pitch rehearsal, **Jury pitch** (the slot assigned by organisers).
5. Webhook endpoint registered in open-wearables and a test event delivered (portal: Webhooks -> Send test). If delivery fails, switch the api to `INGEST_MODE=poll`.
6. Garmin watch synced with the phone within the last 10 minutes.
7. Playwright happy-path test passed 3 times in a row against the running stack.
8. Fallback screen recording of the full happy path exists on the laptop desktop.
9. Browser: single tab, zoom 100%, OS notifications off, logged-in nowhere else.

## Persona fixture - Marta (synthetic)

Marta is the CEO and co-founder of a 12-person seed-stage startup. She runs three times a week and wears a Garmin.

### Injected ground truth

The generator injects these effects into the synthetic stress and heart-rate data. The engine never sees them; it must recover them from the data. This is also our validation argument for the jury: "we tested the method on data with a known answer".

Meeting type true loads (0-100), against the population defaults the engine starts from:

| Type | Population default (prior) | Marta's true load | Meetings in 42 days | Attendees |
|---|---|---|---|---|
| board | 70 | 80 | 3 | Anna, Kasia, Piotr |
| investor | 65 | 72 | 8 | Anna (3), five different fund partners (1 each) |
| customer | 50 | 45 | 10 | Tomasz (4), six different customers (1 each) |
| interview | 45 | 50 | 9 | nine different candidates (1 each) |
| one_on_one | 35 | 35 | 12 | Piotr (6), Ola (6) |
| product_review | 40 | 40 | 6 | Ola and Piotr |
| mentor | 35 | 35 | 4 | Kasia (2), Ewa Mazur (2) |
| standup | 15 | 15 | 30 | "team" (group event, never person-scored) |

Modifiers: back-to-back (gap of 5 min or less before it) +8, starting at or after 16:00 +5. A meeting's true load is `type load + mean(attendee effects) + modifiers + noise`, which is exactly the form the engine fits. Every scored person appears in at least two meeting types, so their effect is distinguishable from the meeting format.

People:

| Person | Role | Meetings | True body effect | Reflections injected | Expected energy-map group |
|---|---|---|---|---|---|
| Anna Kowalska | Lead investor | 6 | +18 | mostly "drained" | Known drain |
| Piotr Nowak | Co-founder, CTO | 15 | +15 | mostly "neutral" / "energized" | **Hidden drain** |
| Ola Wiśniewska | Head of Product | 12 | -8 | mostly "energized" | Energizer |
| Tomasz Lewandowski | Customer (bank) | 4 | +1 | mostly "drained" | Overestimated |
| Kasia Wójcik | Independent board member | 5 | 0 | "neutral" | Neutral - the load belongs to the board format, not to her |
| 21 others | Candidates, one-off fund partners and customers, Ewa | 1-2 each | random | none | Not shown (below 3 meetings) |

Training pattern: in the history there are 3 occasions where Marta did hard intervals the evening before a heavy day; each time her next-night HRV dropped by about 15%.

### Marta's state on demo day

| Signal | Value |
|---|---|
| Last night's sleep | 6h05 (7-day average also about 6h05) |
| Overnight HRV | 10% below her 7-day average |
| Body Battery at wake-up | 41 |
| Resilience score (open-wearables) | 75 |
| Typical wake-up time (median of 14 days) | 06:30 |
| **Capacity** | **about 54** |

### Marta's tomorrow (the heavy day)

| Time | Event | Attendees | Predicted load |
|---|---|---|---|
| 09:00-09:15 | Standup | team | about 15 |
| 10:00-12:00 | Board meeting | Anna, Kasia, Piotr | about 83 |
| 12:00-12:30 | 1:1 | Piotr | about 56 (includes back-to-back +8) |
| 14:00-15:00 | Investor call | Anna, Michał Zieliński (new fund, first meeting) | about 76 |
| 16:30-17:00 | Customer call | Tomasz | about 52 |
| 18:30-19:30 | Run: intervals 6 x 800 m | - | training load +8 |

Expected: **tomorrow's day load about 83** - the highest in the last 42 days. **Gap = 83 - 54 = 29 (red)**. Predicted values are lower than the true loads because the engine pulls every estimate toward its prior until there is enough history; that is intended and explained in `architecture.md`.

All numbers in this document are generator targets; acceptance tolerance is +/- 5 points (+/- 10 minutes for times derived from data).

## The script

### Scene 1 - Live hook (0:00-0:30) - account: Jakub

| Step | Presenter does | Screen shows | Acceptance check |
|---|---|---|---|
| 1.1 | Opens Headroom, account "Jakub - live" is selected | Briefing header with a "Live - Garmin via open-wearables" badge and "Last sync: N min ago" | Badge visible; last sync under 15 minutes |
| 1.2 | Points at the capacity ring | Real capacity from last night (short hackathon sleep, low Body Battery), with breakdown: sleep, HRV vs 7-day, Body Battery, Resilience | All four components have values or an explicit "no data" label; none show NaN or empty |
| 1.3 | Points at "Coming up" | **Jury pitch** at its real time, predicted load with the label "Based on 1 of your meetings + population default" | Jury pitch listed; honesty label present |

Talking point: "My watch knows I am drained. It has no idea that in a few hours I am pitching to you. Headroom does."

### Scene 2 - Evening briefing for a heavy day (0:30-1:30) - account: Marta

| Step | Presenter does | Screen shows | Acceptance check |
|---|---|---|---|
| 2.1 | Switches account to "Marta - demo persona" | Persistent banner "Demo persona - synthetic data" | Banner visible on every Marta screen |
| 2.2 | Shows the briefing | "Tomorrow is your heaviest day in 6 weeks." Capacity about 54 vs tomorrow's load about 83, gap about 29 in red | Values within tolerance; gap colour red (gap >= 20) |
| 2.3 | Scrolls to "Your plan for tomorrow" | Top 3 actions, ranked by impact: **A1** "Lights out by 22:45" - **A2** "Move tomorrow's intervals to Saturday" - **A3** "10-minute walk at 09:45 before the Board meeting" | Exactly 3 actions shown, in this order |
| 2.4 | Taps "Why?" on A2 | "The last 3 times you did hard training before a heavy day, your HRV dropped about 15% the next night." Links to the 3 dates | Evidence text and 3 dates shown |
| 2.5 | Taps "Why?" on A3 | "Board meetings cost you a lot: your stress takes about 45 minutes to return to baseline afterwards." | Evidence references board meetings and the recovery tail |
| 2.6 | Taps "Show more" | **A4** "Make the 1:1 with Piotr a 30-minute walking meeting at 12:15" with "Back-to-back after the board, and 1:1s with Piotr cost more than they feel (see Energy map)" | A4 shown; links to Energy map |
| 2.7 | Taps "Add to plan" on A1 and A2 | Toasts "Added to calendar"; the gap animates from about 29 (red) to about **15 (amber)**: capacity about 54 -> about 60 (sleep target), load about 83 -> about 75 (intervals moved) | Gap about 15, amber (8 <= gap < 20); a note says "Estimates only change what the plan changes: sleep and training" |

Talking point: "Not 'you are tired'. Four concrete steps, each explained, each one tap into my calendar."

### Scene 3 - Week forecast (1:30-1:50) - account: Marta

| Step | Presenter does | Screen shows | Acceptance check |
|---|---|---|---|
| 3.1 | Opens "Week" | 7 bars of predicted daily load with the capacity line; tomorrow's bar is the tallest; the intervals marker is now on Saturday (no meetings, load about 8 from the run itself) | Tomorrow's bar is the highest; workout marker is on Saturday |
| 3.2 | Taps tomorrow's bar | Day timeline with meeting blocks coloured by predicted load, plus the accepted "Lights out 22:45" block the evening before | Accepted blocks visible with "Added by Headroom" style |

### Scene 4 - Why the model believes it (1:50-2:20) - account: Marta

| Step | Presenter does | Screen shows | Acceptance check |
|---|---|---|---|
| 4.1 | Taps the Board meeting, then "Past board meetings", picks the most recent one | Stress line over the meeting with the personal baseline band, meeting window shaded, recovery tail shaded until stress is back at baseline. Numbers: measured load about 90, excess stress about +36, recovery tail about 45 min | Chart shows baseline band, meeting window, recovery tail; numbers present |
| 4.2 | Points at "How we measure" | One line: "Only time you sat still counts; compared with your own baseline for the same hour; walking and workouts excluded." | Text present |

Talking point: "Heart rate alone lies. Walking to the meeting room raises it. We only count still time, against your own baseline at that hour."

### Scene 5 - Energy map and reflection (2:20-3:00) - account: Marta

| Step | Presenter does | Screen shows | Acceptance check |
|---|---|---|---|
| 5.1 | Opens "Energy map" | Four-quadrant chart: x = what your body measured, y = how you said you felt. Anna in "Known drain", Piotr in "**Hidden drain**", Ola in "Energizer", Tomasz in "Overestimated", Kasia near the centre. Footer: "21 people have fewer than 3 meetings - not scored" | 5 dots in the expected groups; footer count = 21 |
| 5.2 | Taps Kasia | "Board meetings are demanding for you; Kasia herself is not." | Explanation present |
| 5.3 | Opens the pending check-in card "Friday 1:1 with Piotr - how did it feel?" | Three large buttons: drained / neutral / energized | Card visible; one tap completes it |
| 5.4 | Taps "energized" | Piotr's dot animates upward; card: "You felt energized. Your body disagreed: stress was about 20 points above your baseline." | Dot moves; reflection persisted (survives reload) |

Talking point: "Wearables measure, journals record feelings. Headroom shows the gap between them. And it is private: only you see this map, and nobody is scored after fewer than 3 meetings."

### Scene 6 - Live sync close (3:00-3:30) - account: Jakub

| Step | Presenter does | Screen shows | Acceptance check |
|---|---|---|---|
| 6.1 | Switches back to Jakub | Live briefing | - |
| 6.2 | On the iPhone: opens Garmin Connect, pulls to refresh | (phone) Garmin sync completes | - |
| 6.3 | Taps "Sync now" in Headroom | "Syncing..." then "N new samples" toast; the stress and heart-rate line extends to the current minute; capacity and the Jury pitch recommendation refresh | New samples appear within 60 s of tapping; "Last sync" resets to "just now" |
| 6.4 | Points at the latest sample | "Right now: stress X / heart rate Y" | Latest sample timestamp is within the last 15 min |

Talking point: "That is me, on this stage, a minute ago. Garmin watch, Garmin Connect, open-wearables, Headroom. Same data model for Oura, Whoop or Apple Watch."

## Fallbacks during the demo

| Failure | What the presenter does | What the app does |
|---|---|---|
| Live sync times out | Says "Garmin is slow today" and moves on | Shows "Last sync N min ago" with the last good data; never an error page |
| Garmin stress missing for the stage moment (Garmin marks motion periods as unmeasurable) | Points at heart rate instead | The live tile falls back to heart rate automatically |
| open-wearables down | Continues the Marta scenes | api serves the last computed snapshot with a "stale" badge |
| Laptop or network failure | Plays the fallback screen recording | - |

## Out of the demo (deliberately)

Login, onboarding, real calendar OAuth, settings screens, the "ask your data" chat (P2). If a judge asks, these are covered in `architecture.md` under "Path to production".
