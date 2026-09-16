/* ==========================================================================
   EVACROUTE — shared utilities
   Tiny, dependency-free helpers used across every other module.
   ========================================================================== */
(function (App) {
  'use strict';

  /** Shorthand for document.getElementById. */
  function $(id) {
    return document.getElementById(id);
  }

  /** Collision-resistant id for a zone. */
  function uid() {
    return 'z' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function toDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
  }

  /** True when lat/lng are finite and inside the valid geographic range. */
  function isFiniteLatLng(lat, lng) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    );
  }

  /* Ampersand is assembled at runtime so the source file never contains a
     literal HTML entity that a toolchain could normalise away. */
  var AMP = String.fromCharCode(38);

  /**
   * Escape a value for safe interpolation into HTML.
   * @param {*} value
   * @returns {string}
   */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, AMP + 'amp;')
      .replace(/</g, AMP + 'lt;')
      .replace(/>/g, AMP + 'gt;')
      .replace(/"/g, AMP + 'quot;')
      .replace(/'/g, AMP + '#39;');
  }

  App.util = {
    $: $,
    uid: uid,
    toRad: toRad,
    toDeg: toDeg,
    clamp: clamp,
    isFiniteLatLng: isFiniteLatLng,
    escapeHtml: escapeHtml
  };

  /* Convenience alias so modules can call App.$('id'). */
  App.$ = $;
})(window.EvacRoute = window.EvacRoute || {});
