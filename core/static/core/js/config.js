/* ==========================================================================
   EVACROUTE — configuration, URL parameters, demo data and shared state
   Everything here is read once at load time and then treated as read-only
   (except `state`, which the rest of the app mutates).
   ========================================================================== */
(function (App) {
  'use strict';

  var isFiniteLatLng = App.util.isFiniteLatLng;

  /* ------------------------------ URL parameters ------------------------ */
  var params = new URLSearchParams(window.location.search);

  /** @type {'admin'|'user'} */
  var START_MODE = (params.get('mode') || '').toLowerCase() === 'admin' ? 'admin' : 'user';
  var START_EMPTY = params.get('empty') === '1'; // skip demo seeding
  var RESET_STORAGE = params.get('reset') === '1'; // wipe storage, then seed
  var RUN_SELFTEST = params.get('selftest') === '1'; // render assertion report
  var PARAM_LAT = Number.parseFloat(params.get('lat'));
  var PARAM_LNG = Number.parseFloat(params.get('lng'));
  var HAS_PARAM_LOC = isFiniteLatLng(PARAM_LAT, PARAM_LNG);

  /* ------------------------------ storage keys -------------------------- */
  var STORAGE_KEY = 'evacroute.zones.v1';
  var SEED_FLAG_KEY = 'evacroute.seeded.v1';
  var VIEW_KEY = 'evacroute.view.v2';

  /* ------------------------------ map defaults -------------------------- */
  var MIN_ZOOM = 10;
  var MAX_ZOOM = 18;
  var FALLBACK_CENTER = [28.6315, 77.2197]; // Connaught Place, New Delhi
  var FALLBACK_ZOOM = 13;
  var DEMO_LOCATION = { lat: 28.633, lng: 77.214 }; // inside "Danger Zone 1"
  var SAFE_TEST_POINT = { lat: 28.61, lng: 77.25 }; // outside every demo zone

  /* Demo dataset: 3 danger zones + 2 safe zones around Connaught Place,
     positioned so the demo location reproduces the reference UX copy exactly
     (nearest "Safe Zone A", 1.2 km away, heading NORTH-WEST). */
  var DEMO_ZONES = [
    {
      kind: 'danger',
      name: 'Danger Zone 1',
      vertices: [
        [28.6352, 77.2102],
        [28.6358, 77.2178],
        [28.6312, 77.2186],
        [28.6306, 77.2108]
      ]
    },
    {
      kind: 'danger',
      name: 'Danger Zone 2',
      vertices: [
        [28.627, 77.224],
        [28.6274, 77.232],
        [28.623, 77.2326],
        [28.6224, 77.2246]
      ]
    },
    {
      kind: 'danger',
      name: 'Danger Zone 3',
      vertices: [
        [28.642, 77.231],
        [28.6424, 77.2392],
        [28.638, 77.2398],
        [28.6374, 77.2318]
      ]
    },
    { kind: 'safe', name: 'Safe Zone A', vertices: [[28.6407, 77.2053]] },
    { kind: 'safe', name: 'Safe Zone B', vertices: [[28.62, 77.235]] }
  ];

  /* ------------------------------ layer styles -------------------------- */
  var DANGER_STYLE = {
    color: '#ff3b30',
    weight: 2,
    opacity: 1,
    fillColor: '#ff3b30',
    fillOpacity: 0.4,
    className: 'dz-poly'
  };
  var DANGER_ALERT_STYLE = {
    color: '#ff0d0d',
    weight: 4,
    opacity: 1,
    fillColor: '#ff2d2d',
    fillOpacity: 0.5
  };
  var ROUTE_STYLE = {
    color: '#3b9dff',
    weight: 5,
    opacity: 0.95,
    dashArray: '12 10',
    className: 'route-dash',
    lineCap: 'round'
  };
  /* live drawing preview (admin): dashed guide polygon, rubber band, vertex dots */
  var DRAW_GUIDE_STYLE = {
    color: '#ff3b30',
    weight: 2,
    opacity: 0.9,
    dashArray: '6 6',
    fillColor: '#ff3b30',
    fillOpacity: 0.18
  };
  var DRAW_RUBBER_STYLE = { color: '#ffd166', weight: 2, opacity: 0.95, dashArray: '4 6' };
  var VERTEX_STYLE = { radius: 6, color: '#ffffff', weight: 2, fillColor: '#ff3b30', fillOpacity: 1 };

  /* --------------------------- tile providers ---------------------------
     OpenStreetMap's volunteer tile servers refuse requests from some shared
     networks (HTTP 403 "Access blocked", osm.wiki/Blocked), so the default
     basemap is CARTO — a free, key-less raster service built on OSM data
     with no per-network blocking. Providers are probed with a hidden test
     tile BEFORE a layer is drawn, so a blocked service never renders 403
     tiles or error cards. The provider that works is remembered in
     localStorage, and `?tiles=<id>` pins one explicitly (e.g. ?tiles=osm). */
  var TILE_PROVIDERS = [
    {
      id: 'carto-voyager',
      label: 'CARTO Voyager',
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      subdomains: 'abc',
      attr:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20
    },
    {
      id: 'carto-dark',
      label: 'CARTO Dark Matter',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      subdomains: 'abc',
      attr:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20
    },
    {
      id: 'esri-imagery',
      label: 'Esri World Imagery',
      url:
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attr:
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      maxZoom: 19
    },
    {
      id: 'osm',
      label: 'OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }
  ];

  /* Kept for compatibility: the first provider is the default basemap. */
  var TILE_URL = TILE_PROVIDERS[0].url;
  var TILE_ATTR = TILE_PROVIDERS[0].attr;
  /* --------------------------- tile providers ---------------------------
     The OpenStreetMap volunteer tile servers refuse requests from networks
     that breach their tile usage policy — every tile then answers HTTP 403
     "Access blocked" (osm.wiki/Blocked) and the basemap stays blank. The
     providers below are tried in order; the first one that actually loads a
     tile is remembered in localStorage, so a blocked network costs one failed
     attempt per browser instead of failing on every reload. `?tiles=<id>`
     forces a specific provider (e.g. ?tiles=carto-dark for the demo). */
  var TILE_PROVIDERS = [
    {
      id: 'osm',
      label: 'OpenStreetMap',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    },
    {
      id: 'carto-voyager',
      label: 'CARTO Voyager',
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      subdomains: 'abc',
      attr:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20
    },
    {
      id: 'carto-dark',
      label: 'CARTO Dark Matter',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      subdomains: 'abc',
      attr:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20
    },
    {
      id: 'esri-imagery',
      label: 'Esri World Imagery',
      url:
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attr:
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      maxZoom: 19
    }
  ];

  /* Kept for compatibility: the first provider is the original OSM basemap. */
  var TILE_URL = TILE_PROVIDERS[0].url;
  var TILE_ATTR = TILE_PROVIDERS[0].attr;

  /* Which provider worked last, and how many bad tiles trigger a switch. */
  var TILE_KEY = 'evacroute.tiles.v1';
  var TILE_FAILURE_LIMIT = 3;

  /* Every DOM id the app expects to exist; the self-test asserts this list. */
  var REQUIRED_IDS = [
    'map',
    'uiLayer',
    'topWrap',
    'bottomPanel',
    'topPanel',
    'statusBadge',
    'statusLine',
    'routeSummary',
    'dirArrow',
    'dirText',
    'dirDeg',
    'coordsLine',
    'adminPanel',
    'zoneCounts',
    'btnDrawDanger',
    'btnPlaceSafe',
    'safeLabel',
    'drawState',
    'drawActions',
    'btnFinishPoly',
    'btnUndoVertex',
    'btnCancelDraw',
    'btnExport',
    'btnImport',
    'btnFitZones',
    'btnClearAll',
    'adminList',
    'importFile',
    'toastHost',
    'btnLocate',
    'btnAdmin',
    'btnMaps',
    'geoModal',
    'geoModalMsg',
    'manualLat',
    'manualLng',
    'btnUseManual',
    'btnUseDemo',
    'btnRetryGeo',
    'boot',
    'bootMsg',
    'bootSub2',
    'btnHideAdmin'
  ];

  App.config = {
    params: params,
    START_MODE: START_MODE,
    START_EMPTY: START_EMPTY,
    RESET_STORAGE: RESET_STORAGE,
    RUN_SELFTEST: RUN_SELFTEST,
    PARAM_LAT: PARAM_LAT,
    PARAM_LNG: PARAM_LNG,
    HAS_PARAM_LOC: HAS_PARAM_LOC,

    STORAGE_KEY: STORAGE_KEY,
    SEED_FLAG_KEY: SEED_FLAG_KEY,
    VIEW_KEY: VIEW_KEY,

    MIN_ZOOM: MIN_ZOOM,
    MAX_ZOOM: MAX_ZOOM,
    FALLBACK_CENTER: FALLBACK_CENTER,
    FALLBACK_ZOOM: FALLBACK_ZOOM,
    DEMO_LOCATION: DEMO_LOCATION,
    SAFE_TEST_POINT: SAFE_TEST_POINT,
    DEMO_ZONES: DEMO_ZONES,

    DANGER_STYLE: DANGER_STYLE,
    DANGER_ALERT_STYLE: DANGER_ALERT_STYLE,
    ROUTE_STYLE: ROUTE_STYLE,
    DRAW_GUIDE_STYLE: DRAW_GUIDE_STYLE,
    DRAW_RUBBER_STYLE: DRAW_RUBBER_STYLE,
    VERTEX_STYLE: VERTEX_STYLE,

    TILE_URL: TILE_URL,
    TILE_ATTR: TILE_ATTR,
    TILE_PROVIDERS: TILE_PROVIDERS,
    TILE_KEY: TILE_KEY,
    TILE_FAILURE_LIMIT: TILE_FAILURE_LIMIT,
    REQUIRED_IDS: REQUIRED_IDS
  };

  /* ------------------------------- state -------------------------------- */
  var state = {
    mode: START_MODE,
    zones: [], // [{id, kind:'danger'|'safe', name, vertices:[[lat,lng]...], createdAt}]
    user: null, // {lat, lng, accuracy, source}
    inside: [], // danger zones containing the user
    nearest: null, // {zone, distance, bearing}
    watchId: null,
    locating: false,
    storageOk: true,
    bootHidden: false,
    seededDemo: false,
    map: null,
    tileLayer: null,
    tileProviderIndex: 0,
    tileProvider: null,
    tileFailures: 0,
    tileSavedIndex: -1,
    tileErrorShown: false,
    userMarker: null,
    routeLine: null,
    routeEnd: null,
    lastEval: 0,
    lastFitKey: '',
    viewTimer: null,
    layers: { danger: new Map(), safe: new Map() },
    drawing: { active: false, points: [], vertexLayers: [], guide: null, rubber: null },
    placingSafe: false,
    selfTestDone: false
  };

  App.state = state;

  /* Handy for debugging and for the browser-driven self-test. */
  window.__EVACROUTE_STATE__ = state;
})(window.EvacRoute = window.EvacRoute || {});
