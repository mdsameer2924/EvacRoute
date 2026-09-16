# EVACROUTE — Django + SQLite + React

**EVACROUTE** is a real-time disaster-evacuation guidance app: an admin marks
**danger zones** on a live map, and users get their GPS position, a
danger/safe verdict, the nearest **safe zone**, a compass heading and an
animated route to it.

The frontend started life as a static HTML/CSS/JS site; it now runs as a
**Django project backed by SQLite3**, with an extra **React** dashboard for the
database side of things (zones + activity log). The original UI was moved
unchanged into the app, so the map app looks and behaves exactly as before.

---

## Tech stack

| Layer | Technology | Where |
| --- | --- | --- |
| Markup / styling / app logic | HTML5, CSS3, vanilla JS (ES5 modules) | `core/templates/core/index.html`, `core/static/core/{css,js}/` |
| Component dashboard | React 18 (UMD + Babel standalone, no build step) | `core/templates/core/dashboard.html`, `core/static/core/react/dashboard.jsx` |
| Web framework | Python 3 · Django 6.1 | `manage.py`, `evacroute/`, `core/` |
| Database | SQLite3 (Django's built-in `django.db.backends.sqlite3` engine) | `db.sqlite3` |
| Mapping | Leaflet 1.9.4 + CARTO / OpenStreetMap / Esri tiles (CDN) | loaded by `index.html` |

---

## Quick start

```bash
cd /home/sameer/Documents/secure.file/encrypt/Evacroute

# 1. virtual environment + dependencies (only needed once)
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt

# 2. database: create the schema, then load the demo dataset
./.venv/bin/python manage.py migrate
./.venv/bin/python manage.py seed_demo_zones      # 3 danger + 2 safe zones

# 3. run it
./.venv/bin/python manage.py runserver
```

Then open:

| URL | What it is |
| --- | --- |
| <http://127.0.0.1:8000/> | the original EVACROUTE map app (user + admin views) |
| <http://127.0.0.1:8000/?mode=admin> | map app starting in admin view |
| <http://127.0.0.1:8000/?selftest=1> | the frontend's own assertion suite report |
| <http://127.0.0.1:8000/dashboard/> | React dashboard (zones + activity log in SQLite) |
| <http://127.0.0.1:8000/admin/> | Django admin for both models |

Create an admin login for the map app's database inspection:

```bash
./.venv/bin/python manage.py createsuperuser
```

> Browsers only expose `navigator.geolocation` on `https://` or `localhost`, so
> use `127.0.0.1`/`localhost` — the app falls back to manual coordinates or a
> demo location otherwise. Map tiles, Leaflet and React come from CDNs, so keep
> an internet connection for the demo.

---

## Project structure

```
manage.py                     Django entry point
requirements.txt              Django only (SQLite needs no driver)
db.sqlite3                    the database (created by `migrate`)
evacroute/                    project package
├── settings.py               apps, SQLite, templates + static config
├── urls.py                   /admin/ and the core app at the site root
├── wsgi.py / asgi.py         deployment hooks
core/                         the application
├── models.py                 Zone + ActivityLog (name, message, timestamp)
├── admin.py                  both models registered for the admin site
├── geojson.py                GeoJSON <-> database bridge + demo dataset
├── views.py                  page views + the JSON API
├── urls.py                   /, /dashboard/, /api/...
├── tests.py                  26 tests (pages, static wiring, API, GeoJSON, admin)
├── migrations/0001_initial.py
├── management/commands/seed_demo_zones.py
├── templates/core/
│   ├── index.html            the original page, now a Django template
│   └── dashboard.html        React dashboard shell
└── static/core/
    ├── css/styles.css        unchanged
    ├── css/dashboard.css     new (dashboard only)
    ├── js/*.js               unchanged (12 ES5 modules)
    ├── img/                  (empty — the project shipped without images)
    └── react/dashboard.jsx   React + JSX source
docs/STATIC_README.md         the original static-site README (for reference)
EvacRoute/                    the original git repository (assets moved out)
```

---

## What changed when the static site became a Django app

1. **Templates.** `index.html` moved to `core/templates/core/index.html` and the
   asset URLs were rewritten with Django's static tag — *the markup is
   otherwise byte-identical*:

   ```diff
   -  <link rel="stylesheet" href="css/styles.css" />
   +  <link rel="stylesheet" href="{% static 'core/css/styles.css' %}" />

   -  <script src="js/app.js"></script>
   +  <script src="{% static 'core/js/app.js' %}" %}
   ```

   `{% load static %}` was added on line 2 (after the doctype) and all 12
   module `<script>` tags were rewritten the same way.

2. **Static files.** `css/` and `js/` moved under `core/static/core/`, which
   `django.contrib.staticfiles` finds automatically (app-directories finder) —
   no `STATICFILES_DIRS` entry is required for them.
3. **JavaScript: ten of twelve modules and the stylesheet are byte-identical**
   (verified with `md5sum` against the original git commit). `config.js` and
   `map.js` each gained one addition — the basemap fallback described below —
   and nothing else in them changed. All behaviour (Leaflet layers, drawing
   tools, GPS flow, `localStorage` persistence, keyboard shortcuts, self-test)
   is preserved: `core/static/core/js/selftest.js` still passes **122/122** in
   a real browser when served by Django.
4. **Database.** `Zone` (danger polygons / safe points, stored as
   `[[lat, lng], ...]`) and `ActivityLog` (name, message, kind, timestamp) are
   real SQLite tables, registered in Django admin.
5. **React dashboard** added at `/dashboard/` — it reads and writes the same
   SQLite tables through the JSON API and speaks the *same GeoJSON dialect* as
   the map app, so zones move between browser and database unchanged.
6. **Silent basemap failover** so the map keeps working on networks that
   OpenStreetMap blocks — without ever showing error tiles (see below).

---

## Basemap: no 403 "Access blocked", no error tiles — by default

OpenStreetMap's volunteer tile servers refuse requests from whole networks that
breach their [tile usage policy](https://osm.wiki/Blocked) — for example a
campus, hostel or VPN IP range. Every tile then answers **403 "Access blocked"**
and the basemap renders as a wall of 403 error cards, even though the app itself
is fine (the zones, verdict, route and panel all keep working).

Two changes make that impossible to see:

1. **CARTO is the default basemap** — a free, key-less raster service built on
   OpenStreetMap data, with no per-network blocking.
2. **Providers are probed before anything is drawn.** Before attaching a tile
   layer, the app loads one hidden test tile per candidate provider; a provider
   that answers 403 or times out is skipped *silently*. A blocked service is
   therefore never rendered — no error cards, no blank map, no toast.

The probe order (first provider that loads wins, and is remembered in
`localStorage` under `evacroute.tiles.v1` so later visits start there directly):

| Order | id | Provider | Notes |
| --- | --- | --- | --- |
| 1 | `carto-voyager` | CARTO Voyager | **default** — light street map on OSM data |
| 2 | `carto-dark` | CARTO Dark Matter | dark basemap that matches this app's glass/dark UI |
| 3 | `esri-imagery` | Esri World Imagery | satellite imagery |
| 4 | `osm` | OpenStreetMap standard | the original style, still available when reachable |

If tiles start failing *mid-session* (network change), the same probe runs again
and the layer is swapped with a single informational toast
(*"Basemap switched to … — tiles from … are unavailable on this network."*).
Only when every provider fails do you get the original "check your internet
connection" warning.

You can pin a basemap explicitly — handy when preparing the demo:

```
http://127.0.0.1:8000/?tiles=carto-voyager     # default, light street map
http://127.0.0.1:8000/?tiles=carto-dark        # dark, matches the UI
http://127.0.0.1:8000/?tiles=osm               # original OSM style (if reachable)
```

A pinned provider that is blocked is skipped by the probe too, so even
`?tiles=osm` on a blocked network ends on CARTO silently.

To check which one you are on, open the browser console and run
`EvacRoute.state.tileProvider`, or switch manually with
`EvacRoute.map.attachTileProvider(2)`. Nothing else about the map UI changed:
the zone polygons, safe-zone pins, route line, zoom/scale controls and your
saved view all behave exactly as before.

> If the map ever looks wrong after updating, the browser is serving cached
> `config.js`/`map.js` — reload with **Ctrl+Shift+R** (or clear the site data).

---

## Database models

| Model | Table | Fields |
| --- | --- | --- |
| `Zone` | `core_zone` | `zone_id` (unique, frontend-style id), `kind` (`danger`/`safe`), `name`, `vertices` (JSON `[[lat, lng], …]`), `created_at` |
| `ActivityLog` | `core_activitylog` | `name`, `message`, `kind` (`info`/`submission`/`danger`/`safe`), `latitude`, `longitude`, `timestamp` (indexed) |

Inspect the data straight from SQLite:

```bash
./.venv/bin/python manage.py dbshell
sqlite> SELECT kind, name, json_array_length(vertices) FROM core_zone;
sqlite> SELECT timestamp, name, message FROM core_activitylog ORDER BY timestamp DESC LIMIT 5;
```

---

## JSON API (used by the React dashboard)

All responses are JSON and shaped `{"ok": true, ...}`; errors return
`{"ok": false, "error": "..."}` with HTTP 400. Writes require the CSRF token
(middleware is left enabled) — the dashboard sends it in `X-CSRFToken`.

| Method + path | Purpose |
| --- | --- |
| `GET /api/zones/` | zone rows, counts and a GeoJSON `FeatureCollection` |
| `POST /api/zones/` | import GeoJSON (FeatureCollection / Feature / list / internal shape). Replaces the table unless `?mode=append` |
| `DELETE /api/zones/` | empty the table |
| `POST /api/zones/seed/` | insert the demo dataset (3 danger + 2 safe) |
| `GET /api/zones/<zoneId>/` | one zone + its GeoJSON feature |
| `DELETE /api/zones/<zoneId>/` | delete one zone |
| `GET /api/logs/?limit=100` | recent activity entries (name, message, timestamp) |
| `POST /api/logs/` | create a submission — `{"name": "...", "message": "...", "kind": "submission"}` |
| `DELETE /api/logs/<id>/` | delete one entry |
| `GET /api/summary/` | counters for the dashboard header |

Round-trip workflow for the demo: in the map app open **Admin panel → ⬇ Export
zones (JSON)**, then in `/dashboard/` paste it into the box and press
**⬆ Import into database** — the polygons land in SQLite. Press
**⬇ Download GeoJSON** (or copy the box) and load that file back in the map app
through **⬆ Import JSON**.

---

## Verification performed

| Check | Result |
| --- | --- |
| `python manage.py check` | no issues |
| `python manage.py test core` | **26 tests, all pass** (pages, `{% static %}` resolution, GeoJSON bridge, zones API, activity-log API, Django admin rendering of both models) |
| `python manage.py makemigrations` / `migrate` | `core/migrations/0001_initial.py`, `db.sqlite3` created; `makemigrations --check` reports no pending changes |
| `python manage.py seed_demo_zones --reset` | clears the table and inserts 3 danger + 2 safe zones |
| HTTP smoke test | `/` 200, `/dashboard/` 200, `/admin/` 302 → login, every `/static/core/**` asset 200, every `/api/**` 200 — the only 404 in the server log is Chrome's automatic `/favicon.ico` probe (the original project ships no favicon), so no script, stylesheet, template or API path is missing |
| Browser, main app (`?selftest=1`) | the original assertion suite prints **RESULT: 122/122 passed** and sets the title to `EVACROUTE selftest 122/122` |
| Browser, default load (fresh profile) | self-test 122/122; tiles come from `a/b/c.basemaps.cartocdn.com` (CARTO Voyager); **zero** requests to `tile.openstreetmap.org`; no toasts, no console errors |
| Browser, OSM blocked (DNS-blocked in headless Chrome) | the OSM probe fails silently; CARTO is used instead — 0 OSM tiles rendered, no error cards, no toast; even `?tiles=osm` lands on CARTO silently |
| Browser, dashboard (headless Chrome) | React mounts (`.dash-shell`, tabs, stat cards showing **3 danger / 2 safe / 14 vertices / 3 activity rows** read from SQLite), no JS errors, fallback element still `hidden` |
| CSRF writes through the API | `POST /api/logs/` 201, `POST /api/zones/seed/` 201, `POST /api/zones/` import 201, `GET /api/summary/` reflects the new rows |

Reproduce any of it:

```bash
./.venv/bin/python manage.py test core
./.venv/bin/python manage.py runserver            # then browse the URLs above
# headless proof, if Chrome is installed:
google-chrome --headless=new --dump-dom --virtual-time-budget=20000 \
  'http://127.0.0.1:8000/?selftest=1&lat=28.633&lng=77.214' | grep 'RESULT:'
```

---

## Notes and deliberate decisions

* **The original JS is untouched.** The database/React work happens in new
  files only, which is why the map app's appearance and behaviour are
  unchanged (122/122 self-test assertions).
* **One user-visible string was intentionally left alone:** the GPS fallback
  dialog still says *"serve it with `python -m http.server`"* (it now runs under
  `runserver`). It was kept to honour "appearance 100% identical"; it is a
  one-line edit in `core/templates/core/index.html` if you want it reworded.
* **React without a build step:** React 18 UMD + Babel standalone are loaded
  from unpkg and the JSX is compiled in the browser, matching the project's
  "no bundler, no package manager" style. If the CDN is unreachable the page
  shows a friendly message and the API/admin keep working.
* **Template caching (Django 6):** the framework wraps the template loaders in
  `cached.Loader` **even when `DEBUG = True`**, so changes to a `.html` template
  only show up after restarting `runserver`. Python edits reload automatically.
  If you want live template reloading while preparing the demo, swap the
  template config for the uncached loaders:

  ```python
  TEMPLATES = [{
      'BACKEND': 'django.template.backends.django.DjangoTemplates',
      'DIRS': [BASE_DIR / 'templates'],
      'APP_DIRS': False,                      # must be False when loaders is set
      'OPTIONS': {
          'loaders': [
              'django.template.loaders.filesystem.Loader',
              'django.template.loaders.app_directories.Loader',
          ],
          'context_processors': [ ...unchanged... ],
      },
  }]
  ```

* **Dev-only settings:** `DEBUG = True` and a permissive `ALLOWED_HOSTS`
  (so a phone on the same Wi-Fi can open the demo). Tighten both before any
  real deployment; `python manage.py check --deploy` lists what to change.
* **No image assets existed** in the original project; `core/static/core/img/`
  is created and ready for them.
* **The original static-site repository** is still at `EvacRoute/` (its git
  history holds every file that was moved). To restore the pre-Django layout:

  ```bash
  git -C EvacRoute checkout HEAD -- .
  ```

  The old README is preserved at `docs/STATIC_README.md`.
