# Frame — design brief

An ambient photo display for the WanderCalm brand: a web app that wakes and sleeps on a
schedule, shows a random photograph from a starred archive, and captions it with the place
it was taken — or, failing that, the month and year. A seven-segment clock sits top-left
with the date subscripted beneath it.

Distribution is a web endpoint over wifi. No App Store, no APK. Other people can be given
a link and bring their own photos.

---

## 1. The constraint that shapes everything

The obvious build — OAuth into Google Photos, query favorites, stream them — is no longer
possible. This must be settled before any architecture.

- **`photoslibrary.readonly` was removed on 31 March 2025.** Library enumeration, including
  the `favorite` filter, returns `403 PERMISSION_DENIED`. The Library API now only sees
  media your own app uploaded.
- **The Picker API cannot power a screensaver.** Picked selections expire after **7 days**;
  `baseUrl`s expire after **~60 minutes** and require an OAuth bearer token; Google documents
  that they must not be stored. An unattended frame would blank weekly.
- **Picker responses strip GPS by design.** Location removal is a deliberate privacy measure,
  so the "show the location" requirement cannot be satisfied through the Picker at all.
- **The Ambient API is the purpose-built answer and is gated.** Google Photos has an Ambient
  API for slideshows on TVs and photo frames, with OAuth for limited-input devices. Access
  requires acceptance into the partner program. Apply early; do not put it on the critical path.

### Where the required data still lives

Google Takeout's per-photo JSON sidecars carry `favorited: true`, `geoData.latitude` /
`geoData.longitude`, and `photoTakenTime` — the exact three fields every live API withholds.

| Ingest path | Starred flag | GPS | Unattended | User effort |
|---|---|---|---|---|
| Takeout import | Yes | Yes | Yes | High — one large export |
| Picker API | No | No | No (7-day expiry) | Low but recurring |
| Direct upload | n/a | Yes (EXIF intact) | Yes | Low |
| Ambient API | Yes | Unconfirmed | Yes | Low — partner-gated |

**Resolution: tier the paths by user.** The owner runs a Takeout import once and gets the
full starred archive with locations. Guests get drag-and-drop upload and the Picker, which
need no export. Everything lands in one store.

---

## 2. Architecture — own the pixels

The decisive rule, following directly from the expiry problem: **never stream from Google at
display time.** Copy bytes in at ingest, extract metadata once, serve entirely from your own
infrastructure. The frame then survives the next policy change.

```
Takeout .zip  ─┐
Direct upload ─┼─> Queue ─> parse EXIF + sidecar JSON
Picker API    ─┘         ├─> favorited? taken_at? lat/lng?
                         ├─> reverse geocode -> "Kyoto, Japan"  (cached)
                         ├─> derivatives 1080/1440/2160 AVIF -> R2
                         └─> row -> D1

Display -> GET /api/deck -> signed R2 URLs + captions   (no Google in path)
```

Cloudflare fits, and matches existing BugDrop muscle memory: Workers + Hono for the API,
**R2** for images (zero egress fees matter when a frame pulls a photo every 30s all day),
**D1** for metadata, **Queues** so a 40 GB Takeout upload never blocks a request, **Cron
Triggers** for the nightly reshuffle.

### Randomness

`ORDER BY RANDOM()` degrades at scale and repeats. Use a deck: an integer `shuffle_key` per
photo, reshuffled nightly by cron, paged through by cursor. Persist the cursor so a reload
does not restart the sequence.

Add **anti-clumping**. A raw shuffle returns five frames from one afternoon, because that is
how photos cluster. Enforce a cooldown so consecutive photos never share a day-bucket, and
bias toward spreading across years. This is the difference between curated and dumped.

---

## 3. The display

- **Clock** — seven-segment digits as inline SVG polygons. No webfont to fail, crisp at any
  size, themeable. Unlit segments held at ~8% opacity; that ghost is what makes a digital
  clock read as a physical object. Blinking colon carries the seconds.
- **Date** — beneath the time in letterspaced monospace at roughly a fifth the size.
- **Caption fallback chain** — trip, else place name, else month and year. Exactly one line,
  never empty, never an error string.
- **Legibility** — a photograph can be white sky exactly where the clock sits. Soft corner
  gradient scrims plus text-shadow, no visible box.

Build in from the start:

- **Screen Wake Lock API** to stop the device sleeping. Needs HTTPS and a user gesture, and
  must be re-acquired on `visibilitychange` — it drops silently when the tab backgrounds.
- **Burn-in drift** — migrate the clock a few pixels over minutes. A fixed clock on an OLED
  tablet left running for months will ghost permanently.
- **Night mode instead of off** — at "off" hours, fade the photo and hold a dimmed clock.
  This turns an idle tablet into a bedside clock, which is the reason it stays plugged in.
- **Poll wall-clock time every 30s**, never `setTimeout` to a distant hour. A 9-hour timer
  does not survive DST, device sleep, or browser throttling.
- **Sunrise/sunset schedules** from the display's latitude as an alternative to fixed hours.
- **Ken Burns** — 1.04→1.13 scale drift over the dwell, 2.5s crossfade, honoring
  `prefers-reduced-motion`.

---

## 4. Sharing — displays, not accounts

The devices best suited to being a photo frame — an old iPad, a Fire tablet, a TV browser —
are the worst for typing credentials. Solve with **pairing codes**: the display shows a
six-character code, you bind it from your phone. The frame never needs a keyboard.

Model a **display** as its own object (slug, schedule, photo set, orientation), separate from
the account. One person runs several: kitchen, bedside, parents' house.

**Shared walls** are the growth loop: a photo set accepting contributions from several people.
Everyone on a trip drops favorites into one wall and each household runs the same frame. That
is a real reason for a guest to sign up, and a souvenir that keeps updating.

**Privacy:** a shared link exposing coordinates of photos taken at someone's home is a genuine
harm. Store precise coordinates, never return them from the API — resolve to a place name at
ingest and serve only that. Offer per-set granularity: city, country, or nothing.

---

## 5. WanderCalm integration

Trip records carry `title`, `start_date`, `end_date`, `route`, `home_iana_tz`. A photo's
`taken_at` falling inside a trip's date range is a clean join needing no extra input, and it
upgrades a caption from a place to a memory:

```
"Amalfi Coast, Italy · Day 4 of Italy 2026"   <- trip matched by date range
"Amalfi Coast, Italy"                          <- GPS resolved, no trip
"July 2026"                                    <- neither; graceful floor
```

Three features then come nearly free: an **auto-generated trip wall** published when a trip
ends and shared with everyone who travelled; a **"two years ago today"** mode; and
trip-filtered sets.

The tonal fit is the stronger argument. A screensaver is ambient by definition — slow, quiet,
nothing to tap. It is the most on-brand surface WanderCalm could ship, and it keeps the brand
in someone's kitchen every day between trips.

---

## 6. Build order

The visible 80% of this product has nothing to do with Google. Build the display against a
local folder first; confront ingest only once the thing is worth feeding.

1. **Walking skeleton** — static folder + hand-written JSON manifest. Full display: clock,
   schedule, night mode, crossfade, captions, wake lock. No auth, no DB, no Google.
   *Ships: a working frame on a real tablet, day one.*
2. **Ingest and store** — upload endpoint, Queue consumer, EXIF extraction, reverse geocoding
   with cache, AVIF derivatives to R2, metadata in D1. *Ships: your photos, real locations.*
3. **Takeout importer** — parse the export, read sidecars, filter `favorited: true`, backfill
   GPS. *Ships: the product as originally described.*
4. **Accounts, displays, pairing** — magic-link auth, display objects, pairing codes,
   per-display schedules and sets, shareable slugs. *Ships: shareable with other people.*
5. **Trips and walls** — trip join, multi-person contribution, auto-published trip walls.
   *Ships: the growth loop.*

### Decisions to make before starting

- **Geocoding provider** — Nominatim is free but rate-limited and needs attribution; Mapbox is
  cheap and fast. Either way geocode once at ingest, cached by coordinates rounded to ~3
  decimals. Never at display time.
- **Keep originals?** Derivatives only is far cheaper; keeping originals makes you a backup
  people trust. An order-of-magnitude difference in storage cost.
- **Takeout upload ceiling** — exports run to tens of GB across multi-part zips. Either
  resumable multipart upload to R2, or a small local CLI that walks the extracted folder and
  uploads only favorites. The CLI is dramatically less infrastructure and it is the owner's
  own archive, so a terminal command is an acceptable ask.
- **Video** — excluding it in v1 removes transcoding entirely. Recommended.

---

## 7. Risks

- **Google narrows access further.** The 2025 removal was abrupt and broke many apps. Owning
  your copies is the whole mitigation, and why Google sits strictly at the edge here.
- **Ambient API acceptance may not come.** Treat as upside, never a dependency.
- **Takeout is a heavy first run.** The honest cost of the starred-photos feature, and the
  biggest threat to guest adoption — which is why guests get upload and Picker instead.
- **Long-running browser tabs are unreliable.** They get throttled, memory-killed, reloaded.
  Build a heartbeat and self-reload, keep display state server-side so reloads are invisible,
  and test on the exact hardware intended to run for a month.
- **Terms of service.** Caching a user's own photos with consent is ordinary, but Google's
  Photos API policy has specific retention language. Read it before launching publicly.

---

## References

- [Updates to the Google Photos APIs](https://developers.googleblog.com/en/google-photos-picker-api-launch-and-library-api-updates/)
- [Picker API — list and retrieve media items](https://developers.google.com/photos/picker/guides/media-items)
- [About the Google Photos Ambient API](https://developers.google.com/photos/ambient/guides/about)
- [Google Photos APIs partner program](https://developers.google.com/photos/partner-program/overview)
- [Photos API User Data and Developer Policy](https://developers.google.com/photos/support/api-policy)
- [Google Takeout JSON files explained](https://metadatafixer.com/learn/google-takeout-json-files-explained)
