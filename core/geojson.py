"""EVACROUTE — GeoJSON <-> database bridge.

The browser app (``core/static/core/js/storage.js``) speaks GeoJSON:

* export -> ``{"type": "FeatureCollection", "features": [...]}``
* import -> accepts a ``FeatureCollection``, a single ``Feature``, a list of
  features, or the older internal array shape.

This module mirrors that logic on the server so a file exported from the
frontend imports into SQLite unchanged, and a payload exported from SQLite
imports back into the frontend untouched.
"""

import math

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import Zone, default_zone_id

# Kept in sync with DEMO_ZONES in core/static/core/js/config.js so the
# management command / API seeding produce the same demo dataset.
DEMO_ZONES = [
    {
        'kind': 'danger',
        'name': 'Danger Zone 1',
        'vertices': [[28.6352, 77.2102], [28.6358, 77.2178], [28.6312, 77.2186], [28.6306, 77.2108]],
    },
    {
        'kind': 'danger',
        'name': 'Danger Zone 2',
        'vertices': [[28.627, 77.224], [28.6274, 77.232], [28.623, 77.2326], [28.6224, 77.2246]],
    },
    {
        'kind': 'danger',
        'name': 'Danger Zone 3',
        'vertices': [[28.642, 77.231], [28.6424, 77.2392], [28.638, 77.2398], [28.6374, 77.2318]],
    },
    {'kind': 'safe', 'name': 'Safe Zone A', 'vertices': [[28.6407, 77.2053]]},
    {'kind': 'safe', 'name': 'Safe Zone B', 'vertices': [[28.62, 77.235]]},
]


class GeoJSONError(ValueError):
    """Raised when an inbound payload cannot be understood."""


def coord_pair_to_lat_lng(raw):
    """GeoJSON pair -> ``[lat, lng]``; mirrors geometry.js ``coordPairToLatLng``.

    RFC 7946 puts longitude first, so ``|x| > 90`` can only be a latitude.
    """
    if not isinstance(raw, (list, tuple)) or len(raw) < 2:
        return None
    try:
        a = float(raw[0])
        b = float(raw[1])
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(a) and math.isfinite(b)):
        return None
    if abs(a) > 90:
        return [a, b]  # already [lat, lng]
    return [b, a]  # [lng, lat] -> [lat, lng]


def haversine_meters(a, b):
    """Great-circle distance in metres between two ``[lat, lng]`` points."""
    radius = 6371000.0
    d_lat = math.radians(b[0] - a[0])
    d_lng = math.radians(b[1] - a[1])
    lat1 = math.radians(a[0])
    lat2 = math.radians(b[0])
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(d_lng / 2) ** 2
    )
    return 2 * radius * math.asin(min(1.0, math.sqrt(h)))


def lat_lng_pair(raw):
    """Internal vertices are already ``[lat, lng]``; reversed pairs are tolerated."""
    if not isinstance(raw, (list, tuple)) or len(raw) < 2:
        return None
    try:
        lat = float(raw[0])
        lng = float(raw[1])
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(lat) and math.isfinite(lng)):
        return None
    if -90 <= lat <= 90 and -180 <= lng <= 180:
        return [lat, lng]
    if -90 <= lng <= 90 and -180 <= lat <= 180:
        return [lng, lat]
    return None


def feature_to_zone_dict(feature):
    """A GeoJSON Feature -> ``{zone_id, kind, name, vertices, created_at}`` (or ``None``)."""
    if not isinstance(feature, dict) or feature.get('type') != 'Feature':
        return None
    geometry = feature.get('geometry')
    if not isinstance(geometry, dict):
        return None
    props = feature.get('properties')
    if not isinstance(props, dict):
        props = {}

    kind = 'safe' if props.get('kind') == 'safe' or props.get('type') == 'safe' else 'danger'
    raw_id = props.get('zoneId') or props.get('id')
    zone_id = str(raw_id) if isinstance(raw_id, (str, int)) and raw_id else None
    raw_name = props.get('name')
    name = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else None
    g_type = geometry.get('type')

    if kind == 'safe':
        pair = None
        if g_type == 'Point':
            pair = coord_pair_to_lat_lng(geometry.get('coordinates'))
        elif g_type == 'Polygon':
            rings = geometry.get('coordinates') or []
            if rings and isinstance(rings[0], list) and rings[0]:
                pair = coord_pair_to_lat_lng(rings[0][0])
        if not pair:
            return None
        return {
            'zone_id': zone_id,
            'kind': 'safe',
            'name': name or 'Safe Zone',
            'vertices': [pair],
            'created_at': _parse_created_at(props.get('createdAt')),
        }

    if g_type != 'Polygon':
        return None
    rings = geometry.get('coordinates') or []
    if not rings or not isinstance(rings[0], list):
        return None

    ring = []
    for raw in rings[0]:
        pair = coord_pair_to_lat_lng(raw)
        if pair:
            ring.append(pair)
    # GeoJSON rings repeat the first vertex at the end — drop it (frontend does the same)
    if len(ring) > 2 and haversine_meters(ring[0], ring[-1]) < 1:
        ring.pop()
    if len(ring) < 3:
        return None
    return {
        'zone_id': zone_id,
        'kind': 'danger',
        'name': name or 'Danger Zone',
        'vertices': ring,
        'created_at': _parse_created_at(props.get('createdAt')),
    }


def _parse_created_at(value):
    if not isinstance(value, str) or not value:
        return None
    parsed = parse_datetime(value)
    if parsed and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def parse_zone_payload(data):
    """Any accepted payload -> list of zone dicts (frontend-parity parser).

    Accepts a GeoJSON ``FeatureCollection``, a single ``Feature``, a list of
    features, the internal ``{vertices, kind, name}`` shape, a bare list of
    zones, or ``{"zones": [...]}``.
    """
    if data is None:
        raise GeoJSONError('Empty payload.')

    items = None
    if isinstance(data, dict):
        if data.get('type') == 'FeatureCollection':
            features = data.get('features')
            if not isinstance(features, list):
                raise GeoJSONError('FeatureCollection without a "features" array.')
            items = features
        elif data.get('type') == 'Feature':
            items = [data]
        elif isinstance(data.get('zones'), list):
            items = data['zones']
        elif 'vertices' in data:
            items = [data]
    elif isinstance(data, list):
        items = data

    if items is None:
        raise GeoJSONError(
            'Unsupported payload: send GeoJSON (FeatureCollection/Feature), a list of zones, '
            'or a single zone object.'
        )

    zones = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get('type') == 'Feature':
            parsed = feature_to_zone_dict(item)
        else:
            parsed = _internal_dict_to_zone(item)
        if parsed:
            zones.append(parsed)

    if not zones:
        raise GeoJSONError('No usable zones found in the payload.')
    return zones


def _internal_dict_to_zone(item):
    """The internal ``{id, kind, name, vertices:[[lat,lng]], createdAt}`` shape."""
    kind = 'safe' if item.get('kind') == 'safe' else 'danger'
    vertices = []
    for raw in item.get('vertices') or []:
        pair = lat_lng_pair(raw)
        if pair:
            vertices.append(pair)
    if len(vertices) < (1 if kind == 'safe' else 3):
        return None
    raw_name = item.get('name')
    name = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else None
    raw_id = item.get('id') or item.get('zoneId')
    return {
        'zone_id': str(raw_id) if raw_id else None,
        'kind': kind,
        'name': name or ('Safe Zone' if kind == 'safe' else 'Danger Zone'),
        'vertices': vertices,
        'created_at': _parse_created_at(item.get('createdAt')),
    }


def zones_to_feature_collection(zones):
    """Queryset/list of :class:`~core.models.Zone` -> the frontend's export shape."""
    return {
        'type': 'FeatureCollection',
        'properties': {
            'app': 'EVACROUTE',
            'version': 1,
            'source': 'django+sqlite3',
            'exportedAt': timezone.now().isoformat(),
            'coordinateOrder': 'RFC 7946 [lng, lat]',
        },
        'features': [zone.to_feature() for zone in zones],
    }


def replace_zones(parsed, append=False):
    """Persist parsed zones. Returns ``(created, updated, total)``.

    Incoming ``zone_id``s are upserted, so re-importing the same export keeps
    the original rows (and their ``created_at``) instead of duplicating them.
    Unless ``append`` is true, rows that are missing from the payload are
    deleted — an import is then a full, idempotent sync of the table.
    """
    for item in parsed:
        if not item.get('zone_id'):
            item['zone_id'] = default_zone_id()

    incoming_ids = {item['zone_id'] for item in parsed}
    existing = {zone.zone_id: zone for zone in Zone.objects.filter(zone_id__in=incoming_ids)}

    created = 0
    updated = 0
    for item in parsed:
        zone = existing.get(item['zone_id'])
        if zone:
            zone.kind = item['kind']
            zone.name = item['name']
            zone.vertices = item['vertices']
            if item.get('created_at'):
                zone.created_at = item['created_at']
            zone.save()
            updated += 1
        else:
            fields = {
                'zone_id': item['zone_id'],
                'kind': item['kind'],
                'name': item['name'],
                'vertices': item['vertices'],
            }
            if item.get('created_at'):
                fields['created_at'] = item['created_at']
            new_zone = Zone.objects.create(**fields)
            existing[new_zone.zone_id] = new_zone
            created += 1

    if not append:
        Zone.objects.exclude(zone_id__in=incoming_ids).delete()

    return created, updated, created + updated


def seed_demo_zones():
    """Insert the demo dataset; idempotent (existing kind+name pairs are skipped)."""
    created = 0
    for item in DEMO_ZONES:
        if Zone.objects.filter(kind=item['kind'], name=item['name']).exists():
            continue
        Zone.objects.create(
            kind=item['kind'],
            name=item['name'],
            vertices=[list(v) for v in item['vertices']],
        )
        created += 1
    return created


def zone_stats(zones):
    """Small summary used by the React dashboard."""
    danger = sum(1 for z in zones if z.kind == Zone.DANGER)
    safe = len(zones) - danger
    vertices = sum(z.vertex_count for z in zones)
    return {'danger': danger, 'safe': safe, 'total': len(zones), 'vertices': vertices}

