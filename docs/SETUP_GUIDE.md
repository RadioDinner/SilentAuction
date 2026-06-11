# Setup Guide (from scratch)

This walks you from zero to a live dashboard showing real bids. Follow it
top to bottom. Steps 1 is optional-first; steps 2–7 wire up your Google Sheet.

- **Time needed:** ~25–30 minutes, mostly one-time Google Cloud setup.
- **You'll need:** a Vercel account, a Google account, and this repo on GitHub
  (`RadioDinner/SilentAuction`).

---

## 1. Deploy in demo mode (optional, ~5 min)

Get it live first to confirm everything works, with no configuration.

1. **vercel.com → Add New… → Project**.
2. **Import** `RadioDinner/SilentAuction`. Authorize Vercel to access the repo
   if asked.
3. Framework **Next.js** (auto), Production Branch **main**. No env vars yet.
4. **Deploy**, then open the URL — you'll see demo data counting down, with a
   "Demo data" badge.

You'll switch it to real data at step 6.

---

## 2. Create your auction Google Sheet

1. Make a new Google Sheet (sheets.new).
2. Create three tabs named exactly **Items**, **Tickets**, **Config**
   (double-click a tab to rename; use the **+** to add tabs).
3. For each tab, import the matching template so the headers are correct:
   - Download the CSVs from `docs/sheet-template/` in this repo
     (`Items.csv`, `Tickets.csv`, `Config.csv`).
   - In the sheet: **File → Import → Upload**, pick the CSV, choose
     **Import location: Replace current sheet** (with that tab selected), and
     **Convert text to numbers/dates: No** (keeps times as typed). Repeat per tab.
   - *Or* just type the headers from `docs/SHEET_TEMPLATE.md` yourself.
4. Set the sheet's timezone to your event's: **File → Settings → Time zone**.
5. On the **Config** tab, edit the values to match your event — especially
   `event_date`, `timezone`, and `ticket_cascade_start`. Replace the sample
   items/tickets with your real ones (or keep them for now to test).

---

## 3. Get the Sheet ID

It's the long code in the sheet URL:

```
https://docs.google.com/spreadsheets/d/THIS_IS_THE_SHEET_ID/edit#gid=0
```

Copy it — you'll paste it into Vercel as `GOOGLE_SHEET_ID`.

---

## 4. Create a Google service account + key

This lets the dashboard read your sheet securely (read-only).

1. Open the **Google Cloud Console** → console.cloud.google.com.
2. Top bar: **Select a project → New Project** (name it e.g. `silent-auction`),
   create, then make sure it's selected.
3. **APIs & Services → Library**, search **Google Sheets API**, open it,
   **Enable**.
4. **APIs & Services → Credentials → Create credentials → Service account**.
   - Name it (e.g. `auction-bot`), **Create and continue**, skip the optional
     role/access steps, **Done**.
5. Click the new service account → **Keys** tab → **Add key → Create new key →
   JSON → Create**. A `.json` file downloads. **Keep it private.**

Open that JSON file in a text editor. You'll use two fields:
- `client_email` → e.g. `auction-bot@silent-auction.iam.gserviceaccount.com`
- `private_key` → the long block starting `-----BEGIN PRIVATE KEY-----\n…`

---

## 5. Share the sheet with the service account

In your Google Sheet, click **Share**, paste the service account's
`client_email`, set it to **Viewer**, and send/share. (No email confirmation is
needed; it just grants read access.)

---

## 6. Add the credentials to Vercel and redeploy

In your Vercel project: **Settings → Environment Variables**. Add three, for the
**Production** environment (and Preview/Development if you want):

| Name | Value |
|------|-------|
| `GOOGLE_SHEET_ID` | the ID from step 3 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON (the whole `-----BEGIN…END-----` block) |

> **About the private key:** copy the `private_key` value exactly as it appears
> in the JSON file — it contains `\n` sequences. Pasting that as-is works (the
> app converts `\n` to real line breaks). Don't add extra quotes in the Vercel
> field. If Vercel shows it as multiple lines, that's fine too.

Then **Deployments → ⋯ on the latest → Redeploy** (env vars only apply to new
deployments). When it finishes, open the URL: the **"Demo data" badge should be
gone** and your real bids show. If you see a yellow warning instead, it tells
you what's wrong (usually a typo in a variable or the sheet not shared).

---

## 7. Auto-stamp bid times (recommended)

So staff only type the bid amount and the timer reacts automatically:

1. In your sheet: **Extensions → Apps Script**.
2. Delete the placeholder, paste the contents of
   `google-apps-script/onEditTimestamp.gs` from this repo, **Save**.
3. Reload the sheet. Now editing a **Current Bid** cell auto-fills that row's
   **Last Bid Time**.

*(Without this, type the time into `Last Bid Time` yourself when entering a bid.)*

---

## Day-of checklist

- [ ] Sheet timezone and `Config.timezone` match the event.
- [ ] `event_date` is the picnic date; item `Close Time`s and
      `ticket_cascade_start` are set.
- [ ] Sheet shared with the service account (Viewer).
- [ ] Dashboard URL open full-screen on the TV; no "Demo data" badge.
- [ ] Staff have the sheet open and know to update **Current Bid** +
      **High Bidder**.

Stuck? See the Troubleshooting section in the main `README.md`.
