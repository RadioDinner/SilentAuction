# Silent Auction Dashboard

A single-screen, live-updating dashboard for a silent auction — built to run on
a TV at the company picnic. Staff take bids in a **Google Sheet**; the dashboard
(Next.js, deployed on **Vercel**) reads the sheet and updates itself every few
seconds.

```
┌───────────────────────────────────────────────────────────┐
│  Company Picnic Silent Auction              [demo]  5:24 PM│
├──────────────────────────────────┬────────────────────────┤
│                                  │  Suite Tickets   12 open│
│        FEATURED ITEM             │  ┌─────────────────────┐│
│      Weber Genesis Grill         │  │ NOW CLOSING  #10/12 ││
│   [ photo ]                      │  │ Paddle 19      1:31 ││
│                                  │  └─────────────────────┘│
│   HIGH BID            CLOSES IN  │  #7  $45        Up next │
│   $1,500                  2:01   │  #12 $42        Up next │
│   Paddle 42            at 5:26 PM│  …                      │
├──────────────────────────────────┴────────────────────────┤
│  ALL CURRENT HIGH BIDS                                     │
│  Grill $1,500 · Spa $250 · Bike $800 · Tickets #10 $50 … │
└───────────────────────────────────────────────────────────┘
```

- **Two "Now Closing" spotlights** — the two soonest-closing lots, big photo and
  live countdown, with a **"Next Up"** card below.
- **Ticket cascade** — a group of identical tickets that close one at a time,
  highest bid first.
- **Winner reveal** — once a lot closes, its row shows 🏆 the winning bidder.
- **All current high bids** — a compact board of every item and ticket.

No app login to build, no database to run: the Google Sheet *is* the admin
interface, and the auction rules are computed fresh on every refresh.

---

## How the rules work

All timing is computed server-side from the raw sheet data, so there's no hidden
state — reload at any moment and you get the correct picture.

### Regular items — anti-snipe + stagger
Each item has a scheduled **Close Time**. Any bid pushes the close out to
`bid time + extension window` (default **1 minute**) — but only when that's
*later* than the scheduled close. So:

> Item #1 is scheduled to close at **5:30**, high bid **$1,500**. At **5:30**
> someone bids **$1,600**; staff type it into the sheet. The close jumps to
> **5:31**, high bid **$1,600**. A bid placed earlier (say 5:24) doesn't move
> anything.

When such a wire bid **extends** an item, every item that closes *later* than it
is nudged out by one window too, so a late flurry doesn't bunch everything onto
the same instant. With **`AUCTION_WRITEBACK=1`** the new close times are written
straight back into the sheet (so the stagger compounds with each bid and the
sheet stays the source of truth); without it the same stagger is still shown on
the dashboard, just not persisted.

### Tickets — sequential cascade
Within a group, tickets close **one at a time, highest bid first**. Only the top
still-open ticket counts down ("Now Closing"); the rest wait their turn. When the
active ticket closes, the next-highest starts a fresh countdown
(`ticket_countdown_seconds`).

Because each ticket's close is derived from the previous one's, a bid that
extends the active ticket automatically pushes **all remaining tickets** out by
the same minute — exactly the "bump everything by a minute" behavior the event
needs.

> 12 suite tickets, bids $20–$50. The $50 ticket (#10 of 12) closes first at
> 6:00. A $60 bid at the wire extends it to 6:01 — and every ticket behind it
> shifts a minute too. Once it closes, the next-highest ($45) begins its
> countdown, and so on down the line.

---

## Quick start (demo mode)

No Google credentials needed — the app ships with live demo data.

```bash
npm install
npm run dev
# open http://localhost:3000
```

You'll see the demo auction counting down. Run the logic tests with:

```bash
npm test
```

---

## Admin / Test console

Click the **⚙ gear** in the top-right of the dashboard (or go to **`/admin`**) to
open a built-in test console. It loads the current auction and lets you:

- **Edit** any value — item bids, bidders, close times, the featured item,
  ticket bids, per-group cascade start, and the timing settings.
- **Simulate bids** with the `+$` buttons (stamps the bid time, so you can watch
  the 1-minute anti-snipe extension and the ticket cascade react live).
- **Fast-forward the clock** (`+30s` … `+15m`) to watch items close and the
  cascade roll without waiting.
- **Reset** back to the source data at any time.

A live preview of the real dashboard sits on the right, driven by the same
auction engine. **Edits and the test clock stay in your browser** — they don't
touch the live dashboard on other screens or your Google Sheet, *until you press
Save to Sheet* (below).

### Save to Sheet (live, shared control)

To let one person drive the TVs from the console, set an **`ADMIN_TOKEN`**
environment variable (any long random string) and grant the service account
**Editor** access to the sheet. Then the green **Save to Sheet** panel in the
console becomes active: enter the token once and click **Save**. It writes the
current bids, bidders, bid/close times, cascade starts and timing settings back
to the sheet, and every dashboard picks the change up on its next poll
(~3 seconds).

- It writes only the cells that actually changed, matching rows by item **ID**
  (or **Group + Ticket label**), so it never clobbers your descriptive columns.
- Day-of flow: click **Reload from source** to start from the live sheet, type
  the new bid, then **Save**.
- Leave `ADMIN_TOKEN` unset to keep the app fully read-only — the Save button is
  disabled and the write API returns `503`.

## Connect your Google Sheet

> **New to this?** Follow the click-by-click
> [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md) — it covers everything below from
> scratch, including an importable sheet template in `docs/sheet-template/`.

### 1. Build the sheet
Create a Google Sheet with three tabs — `Items`, `Tickets`, `Config` — following
[`docs/SHEET_TEMPLATE.md`](docs/SHEET_TEMPLATE.md).

### 2. Create a service account (read-only access)
1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create
   (or pick) a project.
2. **APIs & Services → Library →** enable the **Google Sheets API**.
3. **APIs & Services → Credentials → Create credentials → Service account.**
4. Open the new service account → **Keys → Add key → Create new key → JSON**.
   A JSON file downloads — keep it safe.
5. **Share your Google Sheet** with the service account's email
   (`…@…iam.gserviceaccount.com`), **Viewer** is enough.

### 3. Set environment variables
Copy `.env.example` to `.env.local` and fill in, from the JSON key file:

```
GOOGLE_SHEET_ID=<the id in your sheet's URL>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<client_email from the JSON>
GOOGLE_PRIVATE_KEY="<private_key from the JSON, with \n kept literal>"
```

> The private key in the JSON contains real newlines. When you put it in an env
> var, keep them as the two-character sequence `\n` (the app converts them
> back). Wrap the whole value in double quotes.

Restart `npm run dev`; the header's **Demo data** badge disappears once it's
reading your sheet.

### 4. (Recommended) Auto-stamp bid times
So staff only type the bid amount, add the Apps Script in
[`google-apps-script/onEditTimestamp.gs`](google-apps-script/onEditTimestamp.gs):
in the sheet, **Extensions → Apps Script**, paste the file, save, reload. It
writes the `Last Bid Time` automatically whenever `Current Bid` changes.

*(If you skip this, just type the time into `Last Bid Time` when you enter a bid —
any reasonable time format works.)*

---

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project**, import the repo (Next.js is auto-detected).
3. **Settings → Environment Variables:** add the same three `GOOGLE_*` variables.
4. Deploy. Open the URL on the picnic TV in full-screen.

The dashboard re-polls every few seconds (set `NEXT_PUBLIC_POLL_SECONDS`,
default `3`). Countdowns are synced to the server clock, so the display is
correct even if the TV's clock is off.

---

## Running the auction, day-of

- Staff keep the Google Sheet open on their phone/laptop and update **Current
  Bid** (and **High Bidder**) as bids come in.
- For a late bid, that's all they do — the dashboard handles the 1-minute
  extension and shows the new close time.
- For tickets, enter the bid on whichever ticket the person is bidding; the
  highest open ticket is always the one shown as "Now Closing".
- Anyone can watch the live board at the dashboard URL.

---

## Configuration reference

| What | Where | Default |
|------|-------|---------|
| Event name, timezone, dates, windows, ticket timing, featured item | `Config` tab | see template |
| Poll interval (seconds) | `NEXT_PUBLIC_POLL_SECONDS` env | `3` |
| Force demo data | `AUCTION_DEMO=1` env, or `?demo=1` on the URL | off |
| Live "Save to Sheet" | `ADMIN_TOKEN` env + service-account Editor access | off (read-only) |
| Auto write-back of extended close times | `AUCTION_WRITEBACK=1` env + service-account Editor access | off (compute-only) |
| Tab names | `SHEET_ITEMS_TAB` / `SHEET_TICKETS_TAB` / `SHEET_CONFIG_TAB` env | `Items` / `Tickets` / `Config` |

---

## Project layout

```
app/
  page.tsx               Dashboard (client): polls /api/state, renders, ticks countdowns
  admin/page.tsx         Admin / test console (browser edits, live preview, Save to Sheet)
  api/state/route.ts     Reads the sheet (or demo) and returns computed AuctionState
  api/diag/route.ts      Sheet-connection self-diagnosis
  api/admin/save/route.ts  Token-protected write-back of admin edits to the sheet
components/              DashboardView, FeaturedItem, TicketPanel, TicketGroupSummary, BidList, Countdown
lib/
  auction.ts            Pure auction engine (anti-snipe + ticket cascade)
  auction.test.ts       Unit tests for the rules above
  sheets.ts             Google Sheets reader + write-back IO
  sheet-write.ts        Pure planning of which cells to write back
  sheet-write.test.ts   Unit tests for the write planner
  config.ts             Config-tab parsing
  time.ts               Timezone-aware time parsing / formatting
  demo.ts               Built-in demo dataset
  format.ts             Money / countdown / clock formatting
google-apps-script/     onEdit timestamp script for the sheet
docs/SHEET_TEMPLATE.md
```

---

## Troubleshooting

- **Header shows "Demo data" with a warning** — env vars are missing or the
  sheet read failed; the warning text says which. The dashboard falls back to
  demo data so the screen never goes blank.
- **An item shows a ~24h countdown** — its `Close Time` couldn't be parsed.
  Check the format (see the template) and the `Config` timezone/`event_date`.
- **Featured image is blank** — the `Image URL` must be a public, direct link to
  an image file (not a Google Drive "share" page or an HTML page).
- **Times look an hour off** — make the sheet's timezone and the `Config`
  `timezone` match your event.
