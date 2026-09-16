"""EVACROUTE — page views and the JSON API.

* :func:`index`     renders the original single-page map app (unchanged UI).
* :func:`dashboard` renders the React dashboard that reads/writes SQLite.
* ``api_*`` views   small JSON endpoints (same GeoJSON dialect the frontend
  already uses) consumed by the React dashboard.
"""

import json

from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from .geojson import (
    GeoJSONError,
    parse_zone_payload,
    replace_zones,
    seed_demo_zones,
    zone_stats,
    zones_to_feature_collection,
)
from .models import ActivityLog, Zone


# --------------------------------------------------------------------------- #
# pages
# --------------------------------------------------------------------------- #
def index(request):
    """Render the main EVACROUTE app (map, admin tools, GPS flow)."""
    return render(request, 'core/index.html')


@ensure_csrf_cookie
def dashboard(request):
    """React dashboard: database-backed zones + the activity log."""
    return render(
        request,
        'core/dashboard.html',
        {
            'zone_count': Zone.objects.count(),
            'log_count': ActivityLog.objects.count(),
        },
    )


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _read_json(request):
    """Decode a JSON request body (tolerates an empty/missing body)."""
    if not request.body:
        return None
    try:
        return json.loads(request.body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError) as exc:
        raise GeoJSONError(f'Invalid JSON body: {exc}') from exc


def _error(message, status=400):
    return JsonResponse({'ok': False, 'error': message}, status=status)


def _zone_rows(zones):
    """Compact rows for the React table (GeoJSON stays available separately)."""
    return [
        {
            'zoneId': zone.zone_id,
            'kind': zone.kind,
            'name': zone.name,
            'vertexCount': zone.vertex_count,
            'center': zone.center,
            'createdAt': zone.created_at.isoformat() if zone.created_at else None,
        }
        for zone in zones
    ]


# --------------------------------------------------------------------------- #
# zones API  (GeoJSON in / GeoJSON out — the frontend's own dialect)
# --------------------------------------------------------------------------- #
@require_http_methods(['GET', 'POST', 'DELETE'])
def api_zones(request):
    """GET the stored zones, POST an import, DELETE everything."""
    if request.method == 'GET':
        zones = list(Zone.objects.all())
        return JsonResponse(
            {
                'ok': True,
                'stats': zone_stats(zones),
                'zones': _zone_rows(zones),
                'geojson': zones_to_feature_collection(zones),
            }
        )

    if request.method == 'DELETE':
        deleted, _ = Zone.objects.all().delete()
        return JsonResponse({'ok': True, 'deleted': deleted, 'stats': zone_stats([])})

    # POST -> import (append with ?mode=append)
    try:
        payload = _read_json(request)
        parsed = parse_zone_payload(payload)
    except GeoJSONError as exc:
        return _error(str(exc))

    append = request.GET.get('mode') == 'append'
    with transaction.atomic():
        created, updated, total = replace_zones(parsed, append=append)
    zones = list(Zone.objects.all())
    return JsonResponse(
        {
            'ok': True,
            'created': created,
            'updated': updated,
            'imported': total,
            'stats': zone_stats(zones),
            'zones': _zone_rows(zones),
        },
        status=201,
    )


@require_http_methods(['POST'])
def api_seed_zones(request):
    """Insert the built-in demo dataset (3 danger + 2 safe zones)."""
    with transaction.atomic():
        created = seed_demo_zones()
    zones = list(Zone.objects.all())
    return JsonResponse(
        {'ok': True, 'created': created, 'stats': zone_stats(zones), 'zones': _zone_rows(zones)},
        status=201,
    )


@require_http_methods(['GET', 'DELETE'])
def api_zone_detail(request, zone_id):
    """Fetch or delete one zone by its frontend ``zoneId``."""
    zone = get_object_or_404(Zone, zone_id=zone_id)
    if request.method == 'DELETE':
        zone.delete()
        zones = list(Zone.objects.all())
        return JsonResponse({'ok': True, 'deleted': 1, 'stats': zone_stats(zones)})
    return JsonResponse({'ok': True, 'zone': _zone_rows([zone])[0], 'feature': zone.to_feature()})


# --------------------------------------------------------------------------- #
# activity log API (the Submission/ActivityLog model)
# --------------------------------------------------------------------------- #
@require_http_methods(['GET', 'POST'])
def api_logs(request):
    """GET recent activity entries, POST a new submission."""
    if request.method == 'GET':
        try:
            limit = int(request.GET.get('limit', 100))
        except (TypeError, ValueError):
            limit = 100
        limit = max(1, min(limit, 500))
        logs = list(ActivityLog.objects.all()[:limit])
        return JsonResponse(
            {
                'ok': True,
                'count': ActivityLog.objects.count(),
                'logs': [entry.as_dict() for entry in logs],
            }
        )

    try:
        payload = _read_json(request) or {}
    except GeoJSONError as exc:
        return _error(str(exc))
    if not isinstance(payload, dict):
        return _error('Expected a JSON object with "name" and "message".')

    name = str(payload.get('name') or '').strip()
    message = str(payload.get('message') or '').strip()
    kind = str(payload.get('kind') or ActivityLog.INFO).strip().lower()
    if not name:
        return _error('"name" is required.')
    if len(name) > 120:
        return _error('"name" must be 120 characters or fewer.')
    if kind not in dict(ActivityLog.KIND_CHOICES):
        return _error('"kind" must be one of: ' + ', '.join(dict(ActivityLog.KIND_CHOICES)) + '.')

    lat = payload.get('latitude')
    lng = payload.get('longitude')
    try:
        lat = float(lat) if lat not in (None, '') else None
        lng = float(lng) if lng not in (None, '') else None
    except (TypeError, ValueError):
        return _error('"latitude"/"longitude" must be numbers when provided.')

    entry = ActivityLog.objects.create(
        name=name, message=message, kind=kind, latitude=lat, longitude=lng
    )
    return JsonResponse({'ok': True, 'log': entry.as_dict(), 'count': ActivityLog.objects.count()}, status=201)


@require_http_methods(['DELETE'])
def api_log_detail(request, pk):
    """Delete one activity entry."""
    entry = get_object_or_404(ActivityLog, pk=pk)
    entry.delete()
    return JsonResponse({'ok': True, 'deleted': 1, 'count': ActivityLog.objects.count()})


# --------------------------------------------------------------------------- #
# summary endpoint used by the dashboard header
# --------------------------------------------------------------------------- #
@require_http_methods(['GET'])
def api_summary(request):
    """Counts for the dashboard strip."""
    zones = list(Zone.objects.all())
    latest = ActivityLog.objects.first()
    return JsonResponse(
        {
            'ok': True,
            'zones': zone_stats(zones),
            'logs': ActivityLog.objects.count(),
            'lastActivity': latest.as_dict() if latest else None,
        }
    )
