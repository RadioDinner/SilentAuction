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

- **Featured item** — big photo, live countdown, current high bid + bidder.
- **Ticket cascade** — a group of identical tickets that close one at a time,
  highest bid first.
- **All current high bids** — a compact board of every item and ticket.

No app login to build, no database to run: the Google Sheet *is* the admin
interface, and the auction rules are computed fresh on every refresh.

---

## How the rules work

All timing is computed server-side from the raw sheet data, so there's no hidden
state — reload at any moment and you get the correct picture.

### Regular items — anti-snipe
Each item has a scheduled **Close Time**. Any bid pushes the close out to
`bid time + extension window` (default **1 minute**) — but only when that's
*later* than the scheduled close. So:

> Item #1 is scheduled to close at **5:30**, high bid **$1,500**. At **5:30**
> someone bids **$1,600**; staff type it into the sheet. The close jumps to
> **5:31**, high bid **$1,600**. A bid placed earlier (say 5:24) doesn't move
> anything.

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
| Tab names | `SHEET_ITEMS_TAB` / `SHEET_TICKETS_TAB` / `SHEET_CONFIG_TAB` env | `Items` / `Tickets` / `Config` |

---

## Project layout

```
app/
  page.tsx            Dashboard (client): polls /api/state, renders, ticks countdowns
  api/state/route.ts  Reads the sheet (or demo) and returns computed AuctionState
components/           FeaturedItem, TicketPanel, BidList, Countdown
lib/
  auction.ts          Pure auction engine (anti-snipe + ticket cascade)
  auction.test.ts     Unit tests for the rules above
  sheets.ts           Google Sheets reader
  config.ts           Config-tab parsing
  time.ts             Timezone-aware time parsing
  demo.ts             Built-in demo dataset
  format.ts           Money / countdown / clock formatting
google-apps-script/   onEdit timestamp script for the sheet
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
