# Google Sheet template

The dashboard reads **three tabs**: `Items`, `Tickets`, and `Config`. Put the
column titles in **row 1** of each tab; data starts on row 2. Header matching is
forgiving (case/spacing/punctuation are ignored, and several synonyms are
accepted), but the names below are the recommended ones.

> Tip: set the sheet's timezone under **File → Settings → Time zone** to your
> event's timezone, and set the same value in the `Config` tab's `timezone`.

---

## Tab 1: `Items` (regular, single auction items)

| Column          | Required | Example                | Notes |
|-----------------|----------|------------------------|-------|
| `ID`            | yes      | `1`                    | Any unique id/lot number. |
| `Name`          | yes      | `Weber Genesis Grill`  | Shown big when featured. |
| `Description`   | no       | `4-burner propane…`    | Short line under the name. |
| `Image URL`     | no       | `https://…/grill.jpg`  | Must be a **public, direct** image link. |
| `Starting Bid`  | no       | `200`                  | Informational. |
| `Current Bid`   | no       | `1500`                 | Staff update this. `$`/commas OK. |
| `High Bidder`   | no       | `Paddle 42`            | Name or paddle number. |
| `Close Time`    | yes      | `5:30 PM`              | Scheduled close (see time formats below). |
| `Last Bid Time` | auto     | `2026-06-11T17:30:00-05:00` | Stamped by the Apps Script. Leave blank otherwise. |
| `Featured`      | no       | `TRUE`                 | Force this item into the hero slot. |

**Accepted header synonyms** include: ID/Item/Lot/Number; Name/Title; Image/Photo;
Current Bid/High Bid/Bid/Amount; High Bidder/Bidder/Winner/Paddle; Close
Time/Close/End/End Time; Last Bid Time/Last Bid/Bid Time/Timestamp.

---

## Tab 2: `Tickets` (groups of identical tickets)

Each row is **one bid** within a group. The group has a fixed number of **seats**
(`Seats`). Bids are ranked **highest first**, and the top `Seats` bids hold a
seat; any lower bids show as **Outbid**. Seats close one at a time, highest first.

How ranking and closing behave:

- **Highest bid closes first.** Ties are broken by **ticket number** (lowest
  number first) — so *raising* a bid never changes a ticket's tie-break order.
- **More bids than seats → lowest loses.** If a group has 12 seats and a 13th
  bid comes in, add it as a new row; the lowest-ranked bid drops to **Outbid**.
- **A new high bid takes the top, the old bid cascades down.** When someone
  outbids the currently-closing seat, the new bid becomes the one closing and
  the bid it beat slides down to fight for the next seat (and so on down the
  chain). Re-derived live every refresh — there's no stored state.
- **A bid extends the remaining seats.** A bid at the wire pushes the active
  seat's close out by the anti-snipe window, which shifts every later seat out
  by the same amount.

| Column          | Required | Example         | Notes |
|-----------------|----------|-----------------|-------|
| `Group`         | no       | `Suite Tickets` | Defaults to `Tickets` if omitted. Tickets cascade within a group. |
| `Label`         | yes      | `10 of 12`      | Shown as `#10 of 12`. Doubles as the tie-break order, so number them in order. |
| `Seats`         | no       | `12`            | Seats available in this group. Set it on **one row** of the group. If blank, every bid wins a seat (no one is outbid). |
| `Image URL`     | no       | `https://…`     | One image represents the group. |
| `Starting Bid`  | no       | `20`            | Informational. |
| `Current Bid`   | yes      | `50`            | Staff update this. |
| `High Bidder`   | no       | `Paddle 19`     | |
| `Cascade Start` | no       | `7:00 PM`       | When the **highest** ticket in this group closes. Set it on **one row** of the group (usually the first). Falls back to `Config.ticket_cascade_start`. Note: giving *each* row a different time switches the group to per-ticket close times instead of the bid-ranked cascade. |
| `Last Bid Time` | auto     | (ISO)           | Stamped by the Apps Script. |
| `Notes`         | no       | `Lunch on Jul 23` | Free text for your records (not shown on the dashboard). |

> **Multiple groups:** each group cascades independently. Give each its own
> `Cascade Start` so they don't all close at once. The dashboard spotlights
> whichever group is closing soonest and shows the rest as compact cards.
>
> Any extra columns you add (e.g. `Winner Phone`, `Paid?`, `Picked Up?`) are
> ignored by the dashboard, so the same sheet doubles as your checkout tracker.

---

## Tab 3: `Config` (one setting per row)

Two columns: `Key` and `Value`.

| Key                         | Example        | Meaning |
|-----------------------------|----------------|---------|
| `event_name`                | `Company Picnic Silent Auction` | Title shown in the header. |
| `timezone`                  | `America/Chicago` | IANA timezone for all clock times. |
| `event_date`                | `2026-06-11`   | Date that clock-only times (like `5:30 PM`) belong to. |
| `extension_window_seconds`  | `60`           | Anti-snipe window. A bid pushes the close to *bid time + this*. |
| `ticket_cascade_start`      | `6:00 PM`      | Default start for groups without their own `Cascade Start` column value. |
| `ticket_countdown_seconds`  | `180`          | How long each later ticket counts down once it becomes active. |
| `urgent_threshold_seconds`  | `120`          | Under this many seconds left, timers turn red and pulse. |
| `featured_item_id`          | `3`            | (Optional) Always feature this item. Blank = auto (soonest-closing). |

Durations also accept a `_minutes` variant (e.g. `extension_window_minutes`).

---

## Time formats

`Close Time` and `ticket_cascade_start` accept either a **clock time** (anchored
to `event_date`) or a full date-time:

- `5:30 PM`, `5:30PM`, `17:30`, `5:30:00 PM`
- `2026-06-11 17:30`, `6/11/2026 5:30 PM`
- Full ISO `2026-06-11T17:30:00-05:00`

`Last Bid Time` is normally written by the Apps Script as ISO and you don't
touch it. If you ever enter a bid time by hand, any of the formats above work.
