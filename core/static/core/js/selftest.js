/* ==========================================================================
   EVACROUTE — self test
   Scenario + integration assertions. Enabled with ?selftest=1; the report
   is appended to the page as a <pre> and mirrored on window.__EVACROUTE_SELFTEST__.
   ========================================================================== */
(function (App) {
  'use strict';

  var state = App.state;
  var cfg = App.config;
  var geometry = App.geometry;
  var util = App.util;
  var $ = App.$;

  /* ---------------- scenario + integration assertions ------------------- */
  function runScenarioTests() {
    var out = [];
    function check(name, cond, extra) {
      out.push({ name: name, ok: !!cond, extra: extra === undefined ? '' : String(extra) });
    }
    function withLocation(lat, lng, fn) {
      var prev = state.user;
      state.user = { lat: lat, lng: lng, accuracy: null, source: 'selftest' };
      App.map.updateUserMarker();
      App.user.evaluateUser(false);
      fn();
      state.user = prev;
      if (prev) {
        App.map.updateUserMarker();
        App.user.evaluateUser(false);
      }
    }
    function textOf(id) {
      var el = $(id);
      return el ? el.textContent : '';
    }

    var dangers = state.zones.filter(function (z) {
      return z.kind === 'danger';
    }).length;
    var safes = state.zones.filter(function (z) {
      return z.kind === 'safe';
    }).length;
    var demoDanger = state.zones.filter(function (z) {
      return z.name === 'Danger Zone 1';
    })[0];

    /* ---- zone rendering ---- */
    check(
      'zones render as polygons/markers',
      state.layers.danger.size === dangers && state.layers.safe.size === safes,
      state.layers.danger.size + ' polys / ' + state.layers.safe.size + ' markers'
    );
    check(
      'danger polygons carry .dz-poly class',
      document.querySelectorAll('path.dz-poly').length === dangers,
      document.querySelectorAll('path.dz-poly').length
    );
    check('safe markers render \u2713 pins', document.querySelectorAll('.safe-pin').length === safes);
    check(
      'admin counts line matches zones',
      textOf('zoneCounts').indexOf(dangers + ' danger zone') === 0,
      textOf('zoneCounts')
    );
    check(
      'admin list has one row per zone',
      document.querySelectorAll('#adminList .admin-row').length === state.zones.length,
      document.querySelectorAll('#adminList .admin-row').length
    );

    /* ---- danger scenario ---- */
    if (demoDanger) {
      withLocation(cfg.DEMO_LOCATION.lat, cfg.DEMO_LOCATION.lng, function () {
        check(
          'danger: exactly one polygon contains the demo point',
          state.inside.length === 1,
          state.inside
            .map(function (z) {
              return z.name;
            })
            .join(' | ')
        );
        check(
          'danger: containing zone is "Danger Zone 1"',
          !!state.inside[0] && state.inside[0].name === 'Danger Zone 1'
        );
        check(
          'danger: nearest safe zone is "Safe Zone A"',
          !!state.nearest && state.nearest.zone.name === 'Safe Zone A',
          state.nearest ? state.nearest.zone.name : 'none'
        );
        check(
          'danger: distance \u2248 1.2 km',
          !!state.nearest && state.nearest.distance > 1100 && state.nearest.distance < 1300,
          state.nearest ? Math.round(state.nearest.distance) + ' m' : ''
        );
        check(
          'danger: heading is NORTH-WEST',
          !!state.nearest && geometry.bearingToCompass8(state.nearest.bearing) === 'NORTH-WEST',
          state.nearest ? Math.round(state.nearest.bearing) + '\u00B0' : ''
        );
        check('danger: badge reads DANGER', textOf('statusBadge') === 'DANGER', textOf('statusBadge'));
        check('danger: badge uses the pulsing red class', $('statusBadge').classList.contains('badge-danger'));
        check(
          'danger: banner text',
          textOf('statusLine').indexOf('YOU ARE IN A DANGER ZONE') > -1,
          textOf('statusLine')
        );
        check(
          'danger: summary text matches the spec wording',
          textOf('routeSummary') === 'Nearest safe zone: Safe Zone A \u2014 1.2 km away',
          textOf('routeSummary')
        );
        check('danger: direction text', textOf('dirText') === 'Head NORTH-WEST', textOf('dirText'));
        check(
          'danger: arrow rotated to the bearing',
          /rotate\(-?\d+(\.\d+)?deg\)/.test($('dirArrow').style.transform),
          $('dirArrow').style.transform
        );
        check('danger: route polyline drawn', !!state.routeLine && state.routeLine.getLatLngs().length >= 2);
        check('danger: route uses the animated dash class', document.querySelectorAll('path.route-dash').length >= 1);
        check(
          'danger: containing polygon highlighted (.dz-alert)',
          document.querySelectorAll('path.dz-poly.dz-alert').length === 1,
          document.querySelectorAll('path.dz-poly.dz-alert').length
        );
        check('danger: nearest safe marker scaled up', document.querySelectorAll('.safe-pin.nearest').length === 1);
        check('danger: Google Maps button visible', $('btnMaps').hidden === false);
        check(
          'danger: Google Maps href is a walking-directions link',
          /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/.test($('btnMaps').getAttribute('href')) &&
            $('btnMaps').getAttribute('href').indexOf('travelmode=walking') > -1 &&
            $('btnMaps').getAttribute('href').indexOf('destination=28.640700,77.205300') > -1,
          $('btnMaps').getAttribute('href')
        );
      });
    } else {
      check('danger scenario skipped (no demo zones loaded)', true, 'empty dataset run');
    }
    return out;
  }

  /* ------------------------- geometry suite ----------------------------- */
  function runSelfTest() {
    var results = [];
    var failed = [];
    function check(name, cond, extra) {
      var ok = !!cond;
      results.push({ name: name, ok: ok, extra: extra === undefined ? '' : String(extra) });
      if (!ok) failed.push(name);
    }
    function near(a, b, tol) {
      return Math.abs(a - b) <= tol;
    }

    /* ---- ray casting ---- */
    var square = [[0, 0], [0, 10], [10, 10], [10, 0]];
    var lShape = [[0, 0], [0, 10], [4, 10], [4, 4], [10, 4], [10, 0]];
    var realZone = [[28.6352, 77.2102], [28.6358, 77.2178], [28.6312, 77.2186], [28.6306, 77.2108]];
    check('isPointInPolygon: centre of square is inside', geometry.isPointInPolygon([5, 5], square) === true);
    check('isPointInPolygon: east of square is outside', geometry.isPointInPolygon([5, 15], square) === false);
    check('isPointInPolygon: west of square is outside', geometry.isPointInPolygon([5, -1], square) === false);
    check('isPointInPolygon: north of square is outside', geometry.isPointInPolygon([11, 5], square) === false);
    check('isPointInPolygon: south of square is outside', geometry.isPointInPolygon([-1, 5], square) === false);
    check('isPointInPolygon: just inside an edge is inside', geometry.isPointInPolygon([5, 0.001], square) === true);
    check('isPointInPolygon: concave arm is inside', geometry.isPointInPolygon([2, 8], lShape) === true);
    check('isPointInPolygon: concave notch is outside', geometry.isPointInPolygon([8, 8], lShape) === false);
    check('isPointInPolygon: fewer than 3 vertices returns false', geometry.isPointInPolygon([0, 0], [[0, 0], [1, 1]]) === false);
    check('isPointInPolygon: null polygon is handled', geometry.isPointInPolygon([0, 0], null) === false);
    check('isPointInPolygon: reversed winding still matches', geometry.isPointInPolygon([5, 5], square.slice().reverse()) === true);
    check('isPointInPolygon: respects [lat,lng] order (real zone)', geometry.isPointInPolygon([28.633, 77.214], realZone) === true);
    check('isPointInPolygon: swapped [lng,lat] would be outside', geometry.isPointInPolygon([77.214, 28.633], realZone) === false);

    /* ---- distance ---- */
    var delhiMumbai = geometry.haversineMeters([28.6139, 77.209], [19.076, 72.8777]);
    check('haversine: identical points are 0 m', geometry.haversineMeters([28.6, 77.2], [28.6, 77.2]) === 0);
    check('haversine: Delhi\u2192Mumbai \u2248 1150 km', near(delhiMumbai / 1000, 1150, 25), Math.round(delhiMumbai / 1000) + ' km');
    check(
      'haversine: symmetric between endpoints',
      near(
        geometry.haversineMeters([28.6139, 77.209], [19.076, 72.8777]) -
          geometry.haversineMeters([19.076, 72.8777], [28.6139, 77.209]),
        0,
        0.01
      )
    );
    check('haversine: 0.009\u00B0 of latitude \u2248 1 km', near(geometry.haversineMeters([0, 0], [0.009, 0]), 1000.75, 5));

    /* ---- bearing + compass ---- */
    check('bearing: due north \u2248 0\u00B0', near(geometry.bearingDegrees([0, 0], [1, 0]), 0, 0.01));
    check('bearing: due east \u2248 90\u00B0', near(geometry.bearingDegrees([0, 0], [0, 1]), 90, 0.05));
    check('bearing: due south \u2248 180\u00B0', near(geometry.bearingDegrees([0, 0], [-1, 0]), 180, 0.05));
    check('bearing: due west \u2248 270\u00B0', near(geometry.bearingDegrees([0, 1], [0, 0]), 270, 0.05));
    check('compass: 0 \u2192 NORTH', geometry.bearingToCompass8(0) === 'NORTH');
    check('compass: 45 \u2192 NORTH-EAST', geometry.bearingToCompass8(45) === 'NORTH-EAST');
    check('compass: 90 \u2192 EAST', geometry.bearingToCompass8(90) === 'EAST');
    check('compass: 135 \u2192 SOUTH-EAST', geometry.bearingToCompass8(135) === 'SOUTH-EAST');
    check('compass: 180 \u2192 SOUTH', geometry.bearingToCompass8(180) === 'SOUTH');
    check('compass: 225 \u2192 SOUTH-WEST', geometry.bearingToCompass8(225) === 'SOUTH-WEST');
    check('compass: 270 \u2192 WEST', geometry.bearingToCompass8(270) === 'WEST');
    check('compass: 315 \u2192 NORTH-WEST', geometry.bearingToCompass8(315) === 'NORTH-WEST');
    check('compass: 337 \u2192 NORTH-WEST (bucket edge)', geometry.bearingToCompass8(337) === 'NORTH-WEST');
    check('compass: 350 \u2192 NORTH (wrap-around)', geometry.bearingToCompass8(350) === 'NORTH');
    check('compass: -45 \u2192 NORTH-WEST (negative input)', geometry.bearingToCompass8(-45) === 'NORTH-WEST');
    check('directionText: "Head NORTH-WEST"', geometry.directionText(315) === 'Head NORTH-WEST');
    /* ---- formatting + misc helpers ---- */
    check('formatDistance: 0 \u2192 "0 m"', geometry.formatDistance(0) === '0 m');
    check('formatDistance: 999 \u2192 "999 m"', geometry.formatDistance(999) === '999 m');
    check('formatDistance: 1000 \u2192 "1.0 km"', geometry.formatDistance(1000) === '1.0 km');
    check('formatDistance: 1206 \u2192 "1.2 km"', geometry.formatDistance(1206) === '1.2 km');
    check('formatDistance: NaN \u2192 "\u2014"', geometry.formatDistance(NaN) === '\u2014');
    check(
      'polygonAreaMeters2: 1 km square \u2248 1e6 m\u00B2',
      near(geometry.polygonAreaMeters2([[0, 0], [0, 0.009], [0.009, 0.009], [0.009, 0]]), 1001500, 4000)
    );
    check('polygonAreaMeters2: degenerate ring is 0', geometry.polygonAreaMeters2([[0, 0], [1, 1]]) === 0);
    check(
      'isFiniteLatLng: rejects out-of-range values',
      !util.isFiniteLatLng(91, 0) && !util.isFiniteLatLng(0, 181) && util.isFiniteLatLng(-90, 180)
    );
    check('escapeHtml: escapes markup', util.escapeHtml('<b>&"\'') === '&lt;b&gt;&amp;&quot;&#39;');
    check(
      'dedupeTrailingVertices: drops the double-click duplicate',
      geometry.dedupeTrailingVertices([[0, 0], [0, 1], [0, 1]]).length === 2
    );
    check(
      'coordPairToLatLng: converts [lng,lat] \u2192 [lat,lng]',
      JSON.stringify(geometry.coordPairToLatLng([77.214, 28.633])) === JSON.stringify([28.633, 77.214])
    );
    // Both entries are within +/-90, so the pair is genuinely ambiguous; the
    // documented contract (RFC 7946) is to read it as [lng, lat].
    check(
      'coordPairToLatLng: in-range pairs are read as RFC 7946 [lng, lat]',
      JSON.stringify(geometry.coordPairToLatLng([28.633, 77.214])) === JSON.stringify([77.214, 28.633])
    );

    /* ---- environment + DOM wiring ---- */
    var missingIds = cfg.REQUIRED_IDS.filter(function (id) {
      return !$(id);
    });
    check('DOM: every required id exists', missingIds.length === 0, missingIds.join(', '));
    check('Leaflet is loaded', typeof L !== 'undefined' && !!L.version, typeof L !== 'undefined' ? L.version : 'missing');
    check('map instance created', !!state.map);
    check('tile layer attached to the map', !!state.tileLayer && !!state.map && state.map.hasLayer(state.tileLayer));
    check('zoom control sits bottom-right', !!document.querySelector('.leaflet-bottom.leaflet-right .leaflet-control-zoom'));
    check('scale control sits bottom-left', !!document.querySelector('.leaflet-bottom.leaflet-left .leaflet-control-scale'));
    check(
      'zoom range is 10\u202618',
      state.map.getMinZoom() === cfg.MIN_ZOOM && state.map.getMaxZoom() === cfg.MAX_ZOOM,
      state.map.getMinZoom() + '\u2026' + state.map.getMaxZoom()
    );
    /* The stylesheet moved to css/styles.css, so keyframes live in an external
       sheet. Scan CSSOM when the rules are readable (same-origin http) and
       degrade gracefully when the UA hides them (some file:// setups). */
    var cssText = '';
    var cssReadable = false;
    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      try {
        Array.prototype.forEach.call(sheet.cssRules, function (rule) {
          cssText += rule.cssText + '\n';
        });
        cssReadable = true;
      } catch (e) {
        /* opaque stylesheet */
      }
    });
    check('CSS: external stylesheet attached', document.styleSheets.length > 0, document.styleSheets.length);
    check(
      'CSS: dashMove keyframes present',
      !cssReadable || cssText.indexOf('@keyframes dashMove') > -1,
      cssReadable ? 'stylesheet inspected' : 'rules not inspectable'
    );
    check(
      'CSS: dotPulse keyframes present',
      !cssReadable || cssText.indexOf('@keyframes dotPulse') > -1,
      cssReadable ? 'stylesheet inspected' : 'rules not inspectable'
    );
    check(
      'CSS: badgePulse keyframes present',
      !cssReadable || cssText.indexOf('@keyframes badgePulse') > -1,
      cssReadable ? 'stylesheet inspected' : 'rules not inspectable'
    );
    check('bottom action panel wired', !!$('btnLocate') && !!$('btnAdmin') && !!$('btnMaps'));
    check('Google Maps control is a link styled as a button',
      !!$('btnMaps') && $('btnMaps').tagName === 'A' && $('btnMaps').classList.contains('btn'));
    check('boot overlay exists and is hidden after boot', !!$('boot') && $('boot').classList.contains('hidden') === !!state.bootHidden);
    return { results: results, failed: failed };
  }

  /* --------------- scenario part 2: safe path, admin, GeoJSON ----------- */
  function runScenarioTests2() {
    var out = [];
    function check(name, cond, extra) {
      out.push({ name: name, ok: !!cond, extra: extra === undefined ? '' : String(extra) });
    }
    function withLocation(lat, lng, fn) {
      var prev = state.user;
      state.user = { lat: lat, lng: lng, accuracy: null, source: 'selftest' };
      App.map.updateUserMarker();
      App.user.evaluateUser(false);
      fn();
      state.user = prev;
      if (prev) {
        App.map.updateUserMarker();
        App.user.evaluateUser(false);
      }
    }
    function textOf(id) {
      var el = $(id);
      return el ? el.textContent : '';
    }

    var dangers = state.zones.filter(function (z) {
      return z.kind === 'danger';
    }).length;
    var safes = state.zones.filter(function (z) {
      return z.kind === 'safe';
    }).length;

    /* ---- safe scenario ---- */
    withLocation(cfg.SAFE_TEST_POINT.lat, cfg.SAFE_TEST_POINT.lng, function () {
      check(
        'safe: no polygon contains the user',
        state.inside.length === 0,
        state.inside
          .map(function (z) {
            return z.name;
          })
          .join(' | ')
      );
      check('safe: badge reads SAFE', textOf('statusBadge') === 'SAFE', textOf('statusBadge'));
      check('safe: green banner text', textOf('statusLine').indexOf('YOU ARE IN A SAFE AREA') > -1, textOf('statusLine'));
      check(
        'safe: nearest safe zone is still reported',
        !!state.nearest && state.nearest.distance > 0,
        state.nearest ? state.nearest.zone.name + ' @ ' + geometry.formatDistance(state.nearest.distance) : 'none'
      );
      check('safe: no route line drawn', !state.routeLine);
      check('safe: no highlighted polygon', document.querySelectorAll('path.dz-poly.dz-alert').length === 0);
      // applyZoneStyles keeps the nearest refuge highlighted even when safe
      // (same awareness cue the status panel gives), so expect exactly one.
      check(
        'safe: nearest safe zone stays highlighted for awareness',
        document.querySelectorAll('.safe-pin.nearest').length === 1,
        document.querySelectorAll('.safe-pin.nearest').length
      );
      check('safe: Google Maps link hidden', $('btnMaps').hidden === true);
      check('safe: danger zones still drawn for awareness', document.querySelectorAll('path.dz-poly').length === dangers);
    });

    /* ---- admin flow: drawing, persistence, export shape ---- */
    var modeBefore = state.mode;
    App.admin.setMode('admin');
    check('admin: panel becomes visible', $('adminPanel').hidden === false);
    check('admin: URL records ?mode=admin', window.location.search.indexOf('mode=admin') > -1, window.location.search);
    check('admin: toggle button relabelled to user view', textOf('btnAdmin').indexOf('User view') > -1, textOf('btnAdmin'));

    var before = state.zones.length;
    App.admin.beginDrawDanger();
    check('admin: drawing mode active', state.drawing.active === true);
    App.admin.addDrawVertex({ lat: 28.65, lng: 77.2 });
    App.admin.addDrawVertex({ lat: 28.652, lng: 77.204 });
    App.admin.addDrawVertex({ lat: 28.648, lng: 77.206 });
    check('admin: three vertices captured', state.drawing.points.length === 3, state.drawing.points.length);
    check('admin: finish button enabled at 3 points', $('btnFinishPoly').disabled === false);
    check('admin: live preview polygon + rubber band exist', !!state.drawing.guide && !!state.drawing.rubber);
    App.admin.finishPolygon();
    var drawn = state.zones[state.zones.length - 1];
    check('admin: finishing saved a new zone', state.zones.length === before + 1, state.zones.length);
    check('admin: the new zone is a danger zone', !!drawn && drawn.kind === 'danger');
    check('admin: auto-named as a danger zone', !!drawn && /^Danger Zone \d+$/.test(drawn.name), drawn ? drawn.name : '');
    check('admin: drawing mode ended cleanly', state.drawing.active === false && state.drawing.points.length === 0);
    check('admin: preview layers removed', !state.drawing.guide && !state.drawing.rubber);
    check('admin: new polygon rendered', document.querySelectorAll('path.dz-poly').length === dangers + 1,
      document.querySelectorAll('path.dz-poly').length);

    $('safeLabel').value = 'Safe Zone Z';
    App.admin.placeSafeZone({ lat: 28.646, lng: 77.198 });
    var placed = state.zones[state.zones.length - 1];
    check('admin: safe zone placed with the typed label', placed.kind === 'safe' && placed.name === 'Safe Zone Z', placed.name);
    check('admin: safe marker added to the map', document.querySelectorAll('.safe-pin').length === safes + 1,
      document.querySelectorAll('.safe-pin').length);
    check('admin: label field cleared after placing', $('safeLabel').value === '');
    check('persistence: localStorage holds a matching FeatureCollection', (function () {
      var raw = App.storage.readStorage(cfg.STORAGE_KEY);
      if (!raw) return false;
      try {
        var parsed = JSON.parse(raw);
        return parsed.type === 'FeatureCollection' && parsed.features.length === state.zones.length;
      } catch (e) {
        return false;
      }
    })());

    var fc = App.storage.zonesToFeatureCollection();
    var dangerFeature = fc.features.filter(function (f) {
      return f.properties.kind === 'danger';
    })[0];
    var safeFeature = fc.features.filter(function (f) {
      return f.properties.kind === 'safe';
    })[0];
    var ring = dangerFeature.geometry.coordinates[0];
    check('GeoJSON: FeatureCollection covering every zone',
      fc.type === 'FeatureCollection' && fc.features.length === state.zones.length);
    check('GeoJSON: danger geometry is a Polygon', dangerFeature.geometry.type === 'Polygon');
    check('GeoJSON: safe geometry is a Point', safeFeature.geometry.type === 'Point');
    check('GeoJSON: coordinates written as RFC 7946 [lng, lat]',
      Math.abs(ring[0][0]) > 50 && Math.abs(ring[0][1]) < 50, ring[0].join(','));
    check('GeoJSON: polygon ring is closed',
      ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]);
    var roundTrip = App.storage.featureToZone(dangerFeature);
    check('GeoJSON: round-trip keeps every vertex', roundTrip.vertices.length === ring.length - 1,
      roundTrip.vertices.length + ' vs ' + (ring.length - 1));
    var sourceZone = state.zones.filter(function (z) {
      return z.name === dangerFeature.properties.name;
    })[0];
    check('GeoJSON: round-trip keeps coordinates within 1 m',
      !!sourceZone && geometry.haversineMeters(roundTrip.vertices[0], sourceZone.vertices[0]) < 1,
      sourceZone
        ? Math.round(geometry.haversineMeters(roundTrip.vertices[0], sourceZone.vertices[0]) * 100) / 100 +
            ' m vs ' + sourceZone.name
        : 'no source zone');
    check('GeoJSON: round-trip keeps kind + name',
      roundTrip.kind === 'danger' && roundTrip.name === dangerFeature.properties.name);
    var safeTrip = App.storage.featureToZone(safeFeature);
    check('GeoJSON: safe point round-trips', safeTrip.kind === 'safe' && !!safeTrip.vertices[0]);
    check('import: parseZonePayload accepts a FeatureCollection', App.storage.parseZonePayload(fc).length === state.zones.length,
      App.storage.parseZonePayload(fc).length);

    App.zones.deleteZone(drawn.id);
    check('admin: deleting a zone updates state', state.zones.length === before + 1, state.zones.length);
    check(
      'admin: deleting a zone redraws the polygons',
      document.querySelectorAll('path.dz-poly').length === dangers,
      document.querySelectorAll('path.dz-poly').length +
        ' polys / ' +
        state.layers.danger.size +
        ' layers / ' +
        state.zones.filter(function (z) {
          return z.kind === 'danger';
        }).length +
        ' danger zones'
    );
    App.zones.deleteZone(placed.id);
    check('admin: storage returns to the starting set', state.zones.length === before, state.zones.length);

    App.admin.setMode(modeBefore);
    check('mode: restored to "' + modeBefore + '"', state.mode === modeBefore, state.mode);
    if (modeBefore !== 'admin') check('user mode: admin panel hidden again', $('adminPanel').hidden === true);
    return out;
  }

  /* ------------------- report + boot sequence ---------------------------- */
  function finishSelfTest() {
    if (state.selfTestDone) return;
    state.selfTestDone = true;

    var all = [];
    function suite(label, fn) {
      try {
        all = all.concat(fn());
      } catch (e) {
        all.push({ name: label + ' threw: ' + (e && e.message ? e.message : e), ok: false, extra: '' });
      }
    }
    suite('geometry suite', function () {
      return runSelfTest().results;
    });
    suite('scenario suite 1', runScenarioTests);
    suite('scenario suite 2', runScenarioTests2);

    var passed = all.filter(function (r) {
      return r.ok;
    }).length;
    var lines = ['EVACROUTE SELFTEST', '===================', ''];
    all.forEach(function (r) {
      lines.push((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''));
    });
    lines.push('');
    lines.push('RESULT: ' + passed + '/' + all.length + ' passed');
    if (passed !== all.length) {
      lines.push(
        'FAILURES: ' +
          all
            .filter(function (r) {
              return !r.ok;
            })
            .map(function (r) {
              return r.name;
            })
            .join(' ; ')
      );
    }

    var pre = document.createElement('pre');
    pre.id = 'selftest-report';
    pre.textContent = lines.join('\n');
    document.body.appendChild(pre);

    window.__EVACROUTE_SELFTEST__ = {
      total: all.length,
      passed: passed,
      failed: all.length - passed,
      failures: all
        .filter(function (r) {
          return !r.ok;
        })
        .map(function (r) {
          return r.name + (r.extra ? ' \u2014 ' + r.extra : '');
        }),
      results: all
    };
    document.title = 'EVACROUTE selftest ' + passed + '/' + all.length;
  }

  function scheduleSelfTest() {
    if (cfg.HAS_PARAM_LOC || cfg.START_MODE === 'admin') {
      setTimeout(finishSelfTest, 450);
      return;
    }
    var waited = 0;
    var timer = setInterval(function () {
      waited += 250;
      if (state.user || waited > 3200) {
        clearInterval(timer);
        if (!state.user) App.ui.hideBoot();
        finishSelfTest();
      }
    }, 250);
  }

  App.selftest = {
    runSelfTest: runSelfTest,
    runScenarioTests: runScenarioTests,
    runScenarioTests2: runScenarioTests2,
    finishSelfTest: finishSelfTest,
    scheduleSelfTest: scheduleSelfTest
  };
})(window.EvacRoute = window.EvacRoute || {});
