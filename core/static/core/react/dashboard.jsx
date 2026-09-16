/* ==========================================================================
   EVACROUTE — React dashboard (React 18 + JSX, no build step)
   Loaded from core/templates/core/dashboard.html as a text/babel script.

   Talks to the Django + SQLite backend:
     GET    /api/summary/            counters
     GET    /api/zones/              zones + GeoJSON export (database)
     POST   /api/zones/              import GeoJSON / zone list
     POST   /api/zones/seed/         insert the demo dataset
     DELETE /api/zones/              clear the table
     DELETE /api/zones/<zoneId>/     delete one zone
     GET    /api/logs/               activity log (name, message, timestamp)
     POST   /api/logs/               create a submission
     DELETE /api/logs/<id>/          delete one entry
   ========================================================================== */
(function () {
  'use strict';

  const { useState, useEffect, useCallback } = React;
  const API = '/api/';

  /* ------------------------------ helpers ------------------------------- */
  function getCookie(name) {
    const parts = (document.cookie || '').split(';');
    for (let i = 0; i < parts.length; i++) {
      const piece = parts[i].trim();
      if (piece.indexOf(name + '=') === 0) return decodeURIComponent(piece.slice(name.length + 1));
    }
    return '';
  }

  /** fetch() wrapper: JSON in/out, CSRF header, throws on {ok:false}. */
  async function api(path, options) {
    const opts = Object.assign({ method: 'GET', headers: {} }, options || {});
    if (typeof opts.body === 'string') opts.headers['Content-Type'] = 'application/json';
    opts.headers['Accept'] = 'application/json';
    opts.headers['X-CSRFToken'] = getCookie('csrftoken');

    const res = await fetch(API + path, opts);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok || !data || data.ok === false) {
      const message = (data && data.error) || res.status + ' ' + res.statusText;
      throw new Error(message);
    }
    return data;
  }

  function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  function useToasts() {
    const [items, setItems] = useState([]);
    const push = useCallback(function (text, kind) {
      const id = Date.now() + Math.random();
      setItems(function (current) {
        return current.concat([{ id: id, text: text, kind: kind || 'info' }]);
      });
      window.setTimeout(function () {
        setItems(function (current) {
          return current.filter(function (t) {
            return t.id !== id;
          });
        });
      }, 4200);
    }, []);
    return { items: items, push: push };
  }

  /* ------------------------------- chrome ------------------------------- */
  function Toasts({ items }) {
    if (!items.length) return null;
    return (
      <div className="dash-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={'dash-toast ' + t.kind}>
            {t.text}
          </div>
        ))}
      </div>
    );
  }

  function StatCard({ label, value, tone }) {
    return (
      <div className={'stat-card ' + (tone || '')}>
        <div className="k">{label}</div>
        <div className="v">{value}</div>
      </div>
    );
  }
  /* ------------------------- activity log panel ------------------------- */
  function ActivityForm({ onSubmit, busy }) {
    const [name, setName] = useState('');
    const [message, setMessage] = useState('');
    const [kind, setKind] = useState('submission');

    async function submit(event) {
      event.preventDefault();
      const ok = await onSubmit({ name: name.trim(), message: message.trim(), kind: kind });
      if (ok) {
        setMessage('');
      }
    }

    return (
      <form className="form-grid" onSubmit={submit}>
        <label className="field-label">
          Name
          <input
            className="text-input"
            type="text"
            maxLength={120}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field-label">
          Kind
          <select className="text-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="submission">Submission</option>
            <option value="info">Info</option>
            <option value="danger">Danger</option>
            <option value="safe">Safe</option>
          </select>
        </label>
        <label className="field-label wide">
          Message
          <textarea
            className="text-input"
            placeholder="e.g. Reached Safe Zone A safely"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy || !name}>
            {busy ? 'Saving\u2026' : '\u25B2 Save to database'}
          </button>
          <span className="panel-note">Stored in the SQLite table <code>core_activitylog</code>.</span>
        </div>
      </form>
    );
  }

  function ActivityTable({ logs, onDelete, busy }) {
    if (!logs.length) {
      return <div className="empty">No activity yet — save a submission above.</div>;
    }
    return (
      <div className="table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Name</th>
              <th>Kind</th>
              <th>Message</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {logs.map((entry) => (
              <tr key={entry.id}>
                <td>{formatTime(entry.timestamp)}</td>
                <td>{entry.name}</td>
                <td>
                  <span className={'pill ' + entry.kind}>{entry.kindLabel}</span>
                </td>
                <td className="msg">{entry.message || '—'}</td>
                <td>
                  <button
                    className="icon-btn"
                    type="button"
                    title="Delete this entry"
                    disabled={busy}
                    onClick={() => onDelete(entry.id)}
                  >
                    {'\uD83D\uDDD1'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  /* --------------------------- zones panel ------------------------------ */
  function ZoneTable({ zones, onDelete, busy }) {
    if (!zones.length) {
      return (
        <div className="empty">
          No zones in the database yet — seed the demo dataset, or import the JSON exported from the
          map app (its Admin panel has an {'\u201C'}Export zones (JSON){'\u201D'} button).
        </div>
      );
    }
    return (
      <div className="table-wrap">
        <table className="dash-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Vertices</th>
              <th>Centre [lat, lng]</th>
              <th>Created</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <tr key={zone.zoneId}>
                <td>{zone.name}</td>
                <td>
                  <span className={'pill ' + zone.kind}>{zone.kind}</span>
                </td>
                <td>{zone.vertexCount}</td>
                <td>
                  {zone.center ? zone.center[0].toFixed(4) + ', ' + zone.center[1].toFixed(4) : '—'}
                </td>
                <td>{formatTime(zone.createdAt)}</td>
                <td>
                  <button
                    className="icon-btn"
                    type="button"
                    title="Delete this zone"
                    disabled={busy}
                    onClick={() => onDelete(zone.zoneId)}
                  >
                    {'\uD83D\uDDD1'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function ZonePanel({ zones, geojson, busy, onDelete, onSeed, onClearAll, onImport, onUseExported }) {
    const [draft, setDraft] = useState('');
    const [append, setAppend] = useState(false);

    function download() {
      const blob = new Blob([geojson], { type: 'application/geo+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'evacroute-zones-from-db.geojson';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function loadFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        onImport(String(reader.result), append);
      };
      reader.readAsText(file);
      event.target.value = '';
    }

    return (
      <div className="panel">
        <div className="panel-head">
          <h2>Zones in SQLite</h2>
          <span className="dash-spacer" />
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={onSeed}>
            {'\u2728'} Seed demo zones
          </button>
          <button className="btn" type="button" disabled={busy} onClick={download}>
            {'\u2B07'} Download GeoJSON
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => onClearAll()}>
            {'\uD83D\uDDD1'} Clear table
          </button>
        </div>

        <p className="panel-note">
          Stored in <code>core_zone</code>. The JSON below uses the exact GeoJSON dialect the map app
          exports/imports, so zones move between SQLite and the browser unchanged.
        </p>

        <ZoneTable zones={zones} onDelete={onDelete} busy={busy} />

        <textarea
          className="code-box"
          spellCheck={false}
          value={draft}
          placeholder='{"type": "FeatureCollection", "features": [...]}'
          onChange={(e) => setDraft(e.target.value)}
        />

        <div className="form-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => onImport(draft, append)}
          >
            {'\u2B06'} Import into database
          </button>
          <button className="btn" type="button" disabled={!draft} onClick={() => onUseExported(draft)}>
            {'\u21BA'} Copy current DB data into the box
          </button>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            {'\uD83D\uDCC1'} Load .json file
            <input
              className="sr-only"
              type="file"
              accept=".json,.geojson,application/json,application/geo+json"
              onChange={loadFile}
              aria-label="Import a GeoJSON file into the database"
            />
          </label>
          <label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
            <input type="checkbox" checked={append} onChange={(e) => setAppend(e.target.checked)} />
            Append (keep existing zones)
          </label>
        </div>
      </div>
    );
  }
  /* ------------------------------ the app ------------------------------- */
  function App({ boot }) {
    const { items: toasts, push: toast } = useToasts();
    const [busy, setBusy] = useState(false);
    const [tab, setTab] = useState('activity');
    const [logs, setLogs] = useState([]);
    const [logTotal, setLogTotal] = useState(boot.logs || 0);
    const [zones, setZones] = useState([]);
    const [stats, setStats] = useState({ danger: 0, safe: 0, total: 0, vertices: 0 });
    const [geojson, setGeojson] = useState('');

    const loadZones = useCallback(
      async function (quiet) {
        try {
          const data = await api('zones/');
          setZones(data.zones);
          setStats(data.stats);
          setGeojson(JSON.stringify(data.geojson, null, 2));
        } catch (err) {
          if (!quiet) toast('Could not load zones: ' + err.message, 'err');
        }
      },
      [toast]
    );

    const loadLogs = useCallback(
      async function (quiet) {
        try {
          const data = await api('logs/?limit=200');
          setLogs(data.logs);
          setLogTotal(data.count);
        } catch (err) {
          if (!quiet) toast('Could not load the activity log: ' + err.message, 'err');
        }
      },
      [toast]
    );

    useEffect(
      function () {
        loadZones(true);
        loadLogs(true);
      },
      [loadZones, loadLogs]
    );

    /** Runs ``fn`` with the busy flag set and reports any failure as a toast. */
    async function guard(fn) {
      setBusy(true);
      try {
        await fn();
        return true;
      } catch (err) {
        toast(err.message, 'err');
        return false;
      } finally {
        setBusy(false);
      }
    }

    function submitLog(values) {
      return guard(async function () {
        const data = await api('logs/', { method: 'POST', body: JSON.stringify(values) });
        setLogs(function (current) {
          return [data.log].concat(current);
        });
        setLogTotal(data.count);
        toast('Saved to SQLite (' + data.log.kindLabel + ').', 'ok');
      });
    }

    function removeLog(id) {
      return guard(async function () {
        const data = await api('logs/' + id + '/', { method: 'DELETE' });
        setLogs(function (current) {
          return current.filter(function (entry) {
            return entry.id !== id;
          });
        });
        setLogTotal(data.count);
        toast('Entry deleted.', 'ok');
      });
    }

    function seedZones() {
      return guard(async function () {
        const data = await api('zones/seed/', { method: 'POST' });
        setZones(data.zones);
        setStats(data.stats);
        toast(
          data.created
            ? 'Inserted ' + data.created + ' demo zone(s).'
            : 'Demo zones were already in the database.',
          'ok'
        );
        await loadZones(true);
      });
    }

    function clearZones() {
      if (!window.confirm('Delete every zone from the database?')) return Promise.resolve(false);
      return guard(async function () {
        const data = await api('zones/', { method: 'DELETE' });
        setZones([]);
        setStats(data.stats);
        setGeojson(JSON.stringify({ type: 'FeatureCollection', features: [] }, null, 2));
        toast('Cleared ' + data.deleted + ' row(s).', 'ok');
      });
    }

    function deleteZone(zoneId) {
      return guard(async function () {
        const data = await api('zones/' + encodeURIComponent(zoneId) + '/', { method: 'DELETE' });
        setStats(data.stats);
        await loadZones(true);
        toast('Zone deleted.', 'ok');
      });
    }

    function importZones(text, append) {
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        toast('That is not valid JSON: ' + err.message, 'err');
        return Promise.resolve(false);
      }
      return guard(async function () {
        const data = await api('zones/' + (append ? '?mode=append' : ''), {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setZones(data.zones);
        setStats(data.stats);
        await loadZones(true);
        toast('Imported ' + data.imported + ' zone(s) into SQLite.', 'ok');
        setTab('zones');
      });
    }

    function refreshAll() {
      return guard(async function () {
        await loadZones(true);
        await loadLogs(true);
        toast('Reloaded from the database.', 'ok');
      });
    }

    return (
      <div className="dash-shell">
        <header className="dash-head">
          <div className="dash-brand">
            <span className="shield">{'\uD83D\uDEE1\uFE0F'}</span>
            <span className="dash-title">
              EVACROUTE
              <small>Django + React dashboard {'\u00B7'} SQLite3</small>
            </span>
          </div>
          <span className="dash-spacer" />
          <div className="dash-links">
            <a className="btn" href="/">
              {'\uD83D\uDDFA\uFE0F'} Open map app
            </a>
            <a className="btn btn-ghost" href="/admin/">
              Django admin
            </a>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={refreshAll}>
              {'\u21BB'} Refresh
            </button>
          </div>
        </header>

        <div className="stat-grid">
          <StatCard label="Danger zones" value={stats.danger} tone="danger" />
          <StatCard label="Safe zones" value={stats.safe} tone="safe" />
          <StatCard label="Polygon vertices" value={stats.vertices} />
          <StatCard label="Activity entries" value={logTotal} tone="accent" />
        </div>

        <div className="tab-row" role="tablist" aria-label="Dashboard sections">
          <button
            className="tab"
            type="button"
            role="tab"
            aria-selected={tab === 'activity'}
            onClick={() => setTab('activity')}
          >
            Activity log ({logTotal})
          </button>
          <button
            className="tab"
            type="button"
            role="tab"
            aria-selected={tab === 'zones'}
            onClick={() => setTab('zones')}
          >
            Zones and GeoJSON ({stats.total})
          </button>
        </div>

        {tab === 'activity' ? (
          <div className="panel">
            <div className="panel-head">
              <h2>Save an activity</h2>
              <span className="dash-spacer" />
              <span className="panel-note">POST /api/logs/</span>
            </div>
            <ActivityForm onSubmit={submitLog} busy={busy} />
            <div className="panel-head">
              <h2>Recent activity</h2>
              <span className="dash-spacer" />
              <span className="panel-note">{logTotal} row(s) in the table</span>
            </div>
            <ActivityTable logs={logs} onDelete={removeLog} busy={busy} />
          </div>
        ) : (
          <ZonePanel
            zones={zones}
            geojson={geojson}
            busy={busy}
            onDelete={deleteZone}
            onSeed={seedZones}
            onClearAll={clearZones}
            onImport={importZones}
          />
        )}

        <p className="footnote">
          Data lives in <code>db.sqlite3</code> — inspect it with{' '}
          <code>python manage.py dbshell</code> or the Django admin.
        </p>

        <Toasts items={toasts} />
      </div>
    );
  }

  /* ------------------------------- mount -------------------------------- */
  const root = document.getElementById('dash-root');
  if (root) {
    const boot = {
      logs: parseInt(root.getAttribute('data-log-count') || '0', 10) || 0,
    };
    ReactDOM.createRoot(root).render(<App boot={boot} />);
  }
})();