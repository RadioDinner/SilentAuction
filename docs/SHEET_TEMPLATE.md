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

Each row is one ticket within a group. Tickets in a group close **one at a time,
highest bid first**.

| Column          | Required | Example         | Notes |
|-----------------|----------|-----------------|-------|
| `Group`         | no       | `Suite Tickets` | Defaults to `Tickets` if omitted. Tickets cascade within a group. |
| `Label`         | yes      | `10 of 12`      | Shown as `#10 of 12`. |
| `Image URL`     | no       | `https://…`     | One image represents the group. |
| `Current Bid`   | yes      | `50`            | Staff update this. |
| `High Bidder`   | no       | `Paddle 19`     | |
| `Last Bid Time` | auto     | (ISO)           | Stamped by the Apps Script. |

---

## Tab 3: `Config` (one setting per row)

Two columns: `Key` and `Value`.

| Key                         | Example        | Meaning |
|-----------------------------|----------------|---------|
| `event_name`                | `Company Picnic Silent Auction` | Title shown in the header. |
| `timezone`                  | `America/Chicago` | IANA timezone for all clock times. |
| `event_date`                | `2026-06-11`   | Date that clock-only times (like `5:30 PM`) belong to. |
| `extension_window_seconds`  | `60`           | Anti-snipe window. A bid pushes the close to *bid time + this*. |
| `ticket_cascade_start`      | `6:00 PM`      | When the **highest** ticket in a group closes. |
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
