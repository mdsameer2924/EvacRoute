"""EVACROUTE — database models.

Two tables back the app:

* :class:`Zone`        — danger polygons / safe points marked by an admin.
* :class:`ActivityLog` — a lightweight event/submission feed (name, message,
  timestamp), editable from the React dashboard and from Django admin.

``Zone`` stores its geometry in the *same* shape the existing frontend uses
(``vertices`` as ``[[lat, lng], ...]``), so a zone exported from the browser
imports straight into SQLite and vice versa.
"""

import secrets

from django.db import models
from django.utils import timezone


def default_zone_id():
    """Zone id in the same style the frontend generates (``z`` + hex)."""
    return 'z' + secrets.token_hex(6)


class Zone(models.Model):
    """A single danger zone (polygon) or safe zone (point)."""

    DANGER = 'danger'
    SAFE = 'safe'
    KIND_CHOICES = [
        (DANGER, 'Danger zone'),
        (SAFE, 'Safe zone'),
    ]

    # id used by the browser app; stable across export/import round-trips
    zone_id = models.CharField(max_length=64, unique=True, default=default_zone_id)
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default=DANGER)
    name = models.CharField(max_length=120)
    # [[lat, lng], ...] — 3+ corners for a danger polygon, 1 point for safe zones
    vertices = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['kind', 'name']
        verbose_name = 'zone'
        verbose_name_plural = 'zones'

    def __str__(self):
        return f'{self.name} ({self.get_kind_display()})'

    @property
    def is_danger(self):
        return self.kind == self.DANGER

    @property
    def vertex_count(self):
        return len(self.vertices or [])

    @property
    def center(self):
        """Rough centre point — used for list/admin display only."""
        verts = self.vertices or []
        if not verts:
            return None
        try:
            lat = sum(float(v[0]) for v in verts) / len(verts)
            lng = sum(float(v[1]) for v in verts) / len(verts)
        except (TypeError, ValueError, IndexError):
            return None
        return [round(lat, 6), round(lng, 6)]

    def to_feature(self):
        """Serialize to the GeoJSON Feature the frontend exports/imports (RFC 7946)."""
        props = {
            'zoneId': self.zone_id,
            'kind': self.kind,
            'name': self.name,
            'createdAt': self.created_at.isoformat() if self.created_at else None,
        }
        verts = []
        for raw in self.vertices or []:
            try:
                verts.append([float(raw[0]), float(raw[1])])
            except (TypeError, ValueError, IndexError):
                continue

        geometry = None
        if self.kind == self.SAFE and verts:
            geometry = {'type': 'Point', 'coordinates': [verts[0][1], verts[0][0]]}
        elif self.kind == self.DANGER and len(verts) >= 3:
            ring = [[lng, lat] for lat, lng in verts]
            ring.append(list(ring[0]))  # GeoJSON rings must be closed
            geometry = {'type': 'Polygon', 'coordinates': [ring]}

        return {'type': 'Feature', 'properties': props, 'geometry': geometry}


class ActivityLog(models.Model):
    """A user submission / activity event stored in the SQLite database."""

    INFO = 'info'
    SUBMISSION = 'submission'
    DANGER = 'danger'
    SAFE = 'safe'
    KIND_CHOICES = [
        (INFO, 'Info'),
        (SUBMISSION, 'Submission'),
        (DANGER, 'Danger'),
        (SAFE, 'Safe'),
    ]

    name = models.CharField(max_length=120)
    message = models.TextField(blank=True)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default=INFO)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ['-timestamp', '-id']
        verbose_name = 'activity log entry'
        verbose_name_plural = 'activity log'
        get_latest_by = 'timestamp'

    def __str__(self):
        return f'{self.name}: {(self.message or "")[:40]}'

    @property
    def short_message(self):
        text = (self.message or '').strip()
        return text if len(text) <= 60 else text[:57] + '…'

    def as_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'message': self.message,
            'kind': self.kind,
            'kindLabel': self.get_kind_display(),
            'latitude': self.latitude,
            'longitude': self.longitude,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
        }
