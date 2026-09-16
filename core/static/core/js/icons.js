/* ==========================================================================
   EVACROUTE — icon set
   Every pictograph is stored as a \uXXXX escape so the JavaScript source
   stays plain ASCII. That keeps the files safe from editors, minifiers and
   transport layers that silently drop non-ASCII characters.
   ========================================================================== */
(function (App) {
  'use strict';

  App.icons = {
    /* U+1F6E1 U+FE0F — shield (brand mark, boot splash) */
    shield: '\uD83D\uDEE1\uFE0F',
    /* U+1F4CD — round pushpin ("locate me") */
    locate: '\uD83D\uDCCD',
    /* U+1F6E0 — hammer and wrench (admin tools) */
    tools: '\uD83D\uDEE0',
    /* U+1F9ED — compass (turn-by-turn directions) */
    compass: '\uD83E\uDDED',
    /* U+1F4E1 — satellite antenna (acquiring GPS) */
    satellite: '\uD83D\uDCE1',
    /* U+1F464 — bust in silhouette (user view) */
    person: '\uD83D\uDC64',
    /* U+1F3AF — direct hit (zoom to zone) */
    target: '\uD83C\uDFAF',
    /* U+270E — lower right pencil (rename) */
    pencil: '\u270E',
    /* U+1F5D1 — wastebasket (delete) */
    trash: '\uD83D\uDDD1',
    /* U+2713 — check mark (safe-zone pin, finish polygon) */
    check: '\u2713',
    /* U+21B6 — anticlockwise top semicircle arrow (undo) */
    undo: '\u21B6',
    /* U+2715 — multiplication x (cancel) */
    cross: '\u2715',
    /* U+FF0B — fullwidth plus (add a zone) */
    plus: '\uFF0B',
    /* U+2B07 U+FE0F — down arrow (export) */
    download: '\u2B07\uFE0F',
    /* U+2B06 U+FE0F — up arrow (import) */
    upload: '\u2B06\uFE0F',
    /* U+26A0 U+FE0F — warning sign (danger verdict) */
    warning: '\u26A0\uFE0F',
    /* U+2705 — white heavy check mark (safe verdict) */
    ok: '\u2705'
  };
})(window.EvacRoute = window.EvacRoute || {});