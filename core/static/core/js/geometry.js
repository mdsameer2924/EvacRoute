/* ==========================================================================
   EVACROUTE — geometry helpers
   Pure math: containment, distance, bearing, area and coordinate parsing.
   No DOM access, no Leaflet dependency.
   ========================================================================== */
(function (App) {
  'use strict';

  var toRad = App.util.toRad;
  var toDeg = App.util.toDeg;
  var clamp = App.util.clamp;

  /**
   * Point-in-polygon by ray casting (even-odd rule).
   * A horizontal ray is fired from the point along +x (longitude); every edge
   * crossing toggles the inside flag.
   * @param {number[]} point      [lat, lng]
   * @param {number[][]} polygon  [[lat, lng], ...] (ring is closed implicitly)
   * @returns {boolean} true when the point lies inside the ring
   */
  function isPointInPolygon(point, polygon) {
    if (!Array.isArray(point) || point.length < 2) return false;
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    var y = point[0]; // latitude  -> y
    var x = point[1]; // longitude -> x
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      var yi = polygon[i][0];
      var xi = polygon[i][1];
      var yj = polygon[j][0];
      var xj = polygon[j][1];
      if (yi > y !== yj > y) {
        var xAtY = ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
        if (x < xAtY) inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Great-circle distance in metres between two [lat, lng] points.
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number}
   */
  function haversineMeters(a, b) {
    var R = 6371000;
    var dLat = toRad(b[0] - a[0]);
    var dLng = toRad(b[1] - a[1]);
    var lat1 = toRad(a[0]);
    var lat2 = toRad(b[0]);
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * Initial great-circle bearing from a to b in degrees (0 = north, clockwise).
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number}
   */
  function bearingDegrees(a, b) {
    var lat1 = toRad(a[0]);
    var lat2 = toRad(b[0]);
    var dLng = toRad(b[1] - a[1]);
    var y = Math.sin(dLng) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /** 8-wind compass label, e.g. 315 -> "NORTH-WEST". */
  function bearingToCompass8(deg) {
    var names = [
      'NORTH',
      'NORTH-EAST',
      'EAST',
      'SOUTH-EAST',
      'SOUTH',
      'SOUTH-WEST',
      'WEST',
      'NORTH-WEST'
    ];
    var d = ((Number(deg) % 360) + 360) % 360;
    return names[Math.round(d / 45) % 8];
  }

  function directionText(deg) {
    return 'Head ' + bearingToCompass8(deg);
  }

  /** Format a metre distance as "420 m" or "1.2 km". */
  function formatDistance(m) {
    if (!Number.isFinite(m) || m < 0) return '—';
    if (m < 1000) return Math.round(m) + ' m';
    return (m / 1000).toFixed(1) + ' km';
  }

  /** Planar polygon area in square metres (local equirectangular projection). */
  function polygonAreaMeters2(vertices) {
    if (!Array.isArray(vertices) || vertices.length < 3) return 0;
    var latSum = vertices.reduce(function (sum, v) {
      return sum + v[0];
    }, 0);
    var originLat = vertices[0][0];
    var originLng = vertices[0][1];
    var mPerLat = 111194.93;
    var mPerLng = 111194.93 * Math.cos(toRad(latSum / vertices.length));
    var pts = vertices.map(function (v) {
      return { x: (v[1] - originLng) * mPerLng, y: (v[0] - originLat) * mPerLat };
    });
    var sum = 0;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      sum += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    }
    return Math.abs(sum / 2);
  }

  /** GeoJSON coordinate pair -> our [lat, lng]; tolerates either ordering. */
  function coordPairToLatLng(c) {
    if (!Array.isArray(c) || c.length < 2) return null;
    var a = Number(c[0]);
    var b = Number(c[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    // RFC 7946 puts longitude first, so |x| > 90 can only be a latitude.
    if (Math.abs(a) > 90) return [a, b]; // already [lat, lng]
    return [b, a]; // [lng, lat] -> [lat, lng]
  }

  /** Drop duplicated trailing vertices (double-click fires click twice). */
  function dedupeTrailingVertices(points) {
    var out = points.slice();
    while (out.length >= 2 && haversineMeters(out[out.length - 1], out[out.length - 2]) < 8) {
      out.pop();
    }
    return out;
  }

  App.geometry = {
    isPointInPolygon: isPointInPolygon,
    haversineMeters: haversineMeters,
    bearingDegrees: bearingDegrees,
    bearingToCompass8: bearingToCompass8,
    directionText: directionText,
    formatDistance: formatDistance,
    polygonAreaMeters2: polygonAreaMeters2,
    coordPairToLatLng: coordPairToLatLng,
    dedupeTrailingVertices: dedupeTrailingVertices,
    clamp: clamp
  };
})(window.EvacRoute = window.EvacRoute || {});
