"""EVACROUTE — tests for the pages, the static wiring and the JSON API.

Run with::

    python manage.py test core
"""

import json

from django.contrib.auth.models import User
from django.contrib.staticfiles import finders
from django.test import TestCase
from django.urls import reverse

from .geojson import (
    DEMO_ZONES,
    GeoJSONError,
    feature_to_zone_dict,
    parse_zone_payload,
    zones_to_feature_collection,
)
from .models import ActivityLog, Zone

# The exact payload core/static/core/js/storage.js produces on "Export zones".
FRONTEND_EXPORT = {
    'type': 'FeatureCollection',
    'properties': {'app': 'EVACROUTE', 'version': 1, 'coordinateOrder': 'RFC 7946 [lng, lat]'},
    'features': [
        {
            'type': 'Feature',
            'properties': {
                'zoneId': 'zabc123',
                'kind': 'danger',
                'name': 'Danger Zone 1',
                'createdAt': None,
            },
            'geometry': {
                'type': 'Polygon',
                'coordinates': [
                    [
                        [77.2102, 28.6352],
                        [77.2178, 28.6358],
                        [77.2186, 28.6312],
                        [77.2108, 28.6306],
                        [77.2102, 28.6352],
                    ]
                ],
            },
        },
        {
            'type': 'Feature',
            'properties': {'zoneId': 'zdef456', 'kind': 'safe', 'name': 'Safe Zone A', 'createdAt': None},
            'geometry': {'type': 'Point', 'coordinates': [77.2053, 28.6407]},
        },
    ],
}


class PageTests(TestCase):
    def test_index_renders_the_map_app(self):
        response = self.client.get(reverse('core:index'))
        self.assertEqual(response.status_code, 200)
        body = response.content.decode()
        self.assertIn('EVACROUTE', body)
        self.assertIn('id="map"', body)  # the original DOM ids survive
        self.assertIn('id="geoModal"', body)
        self.assertNotIn('{% static', body)  # template tags were rendered
        self.assertNotIn('src="js/', body)  # no leftover relative asset paths
        self.assertNotIn('href="css/', body)

    def test_dashboard_renders_and_sets_the_csrf_cookie(self):
        response = self.client.get(reverse('core:dashboard'))
        self.assertEqual(response.status_code, 200)
        self.assertIn('id="dash-root"', response.content.decode())
        self.assertIn('csrftoken', response.cookies)

    def test_static_assets_are_discoverable(self):
        for path in (
            'core/css/styles.css',
            'core/css/dashboard.css',
            'core/js/app.js',
            'core/js/storage.js',
            'core/js/selftest.js',
            'core/react/dashboard.jsx',
        ):
            with self.subTest(path=path):
                self.assertIsNotNone(finders.find(path), f'{path} not found by staticfiles')

    def test_every_module_the_template_loads_exists_on_disk(self):
        body = self.client.get(reverse('core:index')).content.decode()
        modules = (
            'util', 'icons', 'geometry', 'config', 'ui', 'storage',
            'zones', 'map', 'admin', 'user', 'selftest', 'app',
        )
        for module in modules:
            with self.subTest(module=module):
                self.assertIn(f'/static/core/js/{module}.js', body)
                self.assertIsNotNone(finders.find(f'core/js/{module}.js'))
class GeoJSONBridgeTests(TestCase):
    def test_frontend_export_parses_into_zones(self):
        parsed = parse_zone_payload(FRONTEND_EXPORT)
        self.assertEqual(len(parsed), 2)
        danger, safe = parsed
        self.assertEqual(danger['kind'], 'danger')
        self.assertEqual(
            danger['vertices'],
            [[28.6352, 77.2102], [28.6358, 77.2178], [28.6312, 77.2186], [28.6306, 77.2108]],
        )
        self.assertEqual(safe['vertices'], [[28.6407, 77.2053]])

    def test_round_trip_is_lossless(self):
        parsed = parse_zone_payload(FRONTEND_EXPORT)
        for item in parsed:
            Zone.objects.create(
                zone_id=item['zone_id'],
                kind=item['kind'],
                name=item['name'],
                vertices=item['vertices'],
            )
        exported = zones_to_feature_collection(Zone.objects.all())
        again = parse_zone_payload(exported)
        self.assertEqual(sorted(z['vertices'] for z in again), sorted(z['vertices'] for z in parsed))

    def test_closing_vertex_is_not_duplicated(self):
        feature = FRONTEND_EXPORT['features'][0]
        ring = feature['geometry']['coordinates'][0]
        self.assertEqual(ring[0], ring[-1])
        parsed = feature_to_zone_dict(feature)
        self.assertEqual(len(parsed['vertices']), 4)

    def test_internal_shape_is_accepted(self):
        parsed = parse_zone_payload(
            [{'id': 'z1', 'kind': 'danger', 'name': 'Old', 'vertices': [[28.6, 77.2], [28.7, 77.2], [28.7, 77.3]]}]
        )
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]['vertices'][0], [28.6, 77.2])

    def test_junk_payloads_raise(self):
        for payload in (None, {}, {'type': 'FeatureCollection', 'features': [{'type': 'Feature'}]}):
            with self.subTest(payload=payload):
                with self.assertRaises(GeoJSONError):
                    parse_zone_payload(payload)

    def test_demo_dataset_matches_the_frontend(self):
        self.assertEqual(len(DEMO_ZONES), 5)
        self.assertEqual(sum(1 for z in DEMO_ZONES if z['kind'] == 'safe'), 2)
        self.assertEqual(sum(1 for z in DEMO_ZONES if z['kind'] == 'danger'), 3)


class ZoneApiTests(TestCase):
    def test_get_returns_an_empty_collection(self):
        payload = self.client.get(reverse('core:api-zones')).json()
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['stats']['total'], 0)
        self.assertEqual(payload['geojson']['type'], 'FeatureCollection')

    def test_post_imports_the_frontend_export(self):
        response = self.client.post(
            reverse('core:api-zones'),
            data=json.dumps(FRONTEND_EXPORT),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['imported'], 2)
        self.assertEqual(Zone.objects.count(), 2)
        self.assertEqual(Zone.objects.get(zone_id='zabc123').vertex_count, 4)

    def test_reimport_is_idempotent(self):
        url = reverse('core:api-zones')
        self.client.post(url, data=json.dumps(FRONTEND_EXPORT), content_type='application/json')
        again = self.client.post(url, data=json.dumps(FRONTEND_EXPORT), content_type='application/json')
        self.assertEqual(again.json()['updated'], 2)
        self.assertEqual(Zone.objects.count(), 2)

    def test_import_replaces_rows_missing_from_the_payload(self):
        self.client.post(reverse('core:api-zones-seed'))
        self.assertEqual(Zone.objects.count(), 5)
        self.client.post(
            reverse('core:api-zones'),
            data=json.dumps(FRONTEND_EXPORT),
            content_type='application/json',
        )
        self.assertEqual(Zone.objects.count(), 2)  # demo rows not in the payload are gone

    def test_append_keeps_existing_rows(self):
        self.client.post(reverse('core:api-zones-seed'))
        self.client.post(
            reverse('core:api-zones') + '?mode=append',
            data=json.dumps(FRONTEND_EXPORT),
            content_type='application/json',
        )
        self.assertEqual(Zone.objects.count(), 7)

    def test_bad_json_is_rejected(self):
        response = self.client.post(reverse('core:api-zones'), data='{nope', content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()['ok'])

    def test_seed_and_delete_one(self):
        seeded = self.client.post(reverse('core:api-zones-seed'))
        self.assertEqual(seeded.status_code, 201)
        self.assertEqual(seeded.json()['stats']['total'], 5)

        zone = Zone.objects.filter(kind=Zone.DANGER).first()
        deleted = self.client.delete(reverse('core:api-zone-detail', args=[zone.zone_id]))
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(Zone.objects.count(), 4)

    def test_delete_all(self):
        self.client.post(reverse('core:api-zones-seed'))
        response = self.client.delete(reverse('core:api-zones'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Zone.objects.count(), 0)


class ActivityLogApiTests(TestCase):
    def test_create_and_list(self):
        response = self.client.post(
            reverse('core:api-logs'),
            data=json.dumps({'name': 'Sameer', 'message': 'Reached Safe Zone A', 'kind': 'submission'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        entry = response.json()['log']
        self.assertEqual(entry['name'], 'Sameer')
        self.assertTrue(entry['timestamp'])

        listed = self.client.get(reverse('core:api-logs')).json()
        self.assertEqual(listed['count'], 1)
        self.assertEqual(listed['logs'][0]['message'], 'Reached Safe Zone A')

    def test_name_is_required(self):
        response = self.client.post(
            reverse('core:api-logs'),
            data=json.dumps({'message': 'no name'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(ActivityLog.objects.count(), 0)

    def test_unknown_kind_is_rejected(self):
        response = self.client.post(
            reverse('core:api-logs'),
            data=json.dumps({'name': 'A', 'kind': 'nope'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_delete_entry(self):
        entry = ActivityLog.objects.create(name='A', message='bye')
        response = self.client.delete(reverse('core:api-log-detail', args=[entry.pk]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ActivityLog.objects.count(), 0)

    def test_summary_counts(self):
        ActivityLog.objects.create(name='A', message='one')
        self.client.post(reverse('core:api-zones-seed'))
        payload = self.client.get(reverse('core:api-summary')).json()
        self.assertEqual(payload['logs'], 1)
        self.assertEqual(payload['zones']['danger'], 3)
        self.assertEqual(payload['lastActivity']['name'], 'A')


class AdminTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_superuser('admin', 'admin@example.com', 'evac-route-demo')
        self.client.force_login(self.user)
        Zone.objects.create(
            kind=Zone.DANGER,
            name='Admin Zone',
            vertices=[[28.6, 77.2], [28.7, 77.2], [28.7, 77.3]],
        )
        ActivityLog.objects.create(name='Admin User', message='hello from admin')

    def test_both_models_are_registered_and_render(self):
        for url in (
            '/admin/',
            '/admin/core/zone/',
            '/admin/core/zone/add/',
            '/admin/core/activitylog/',
            '/admin/core/activitylog/add/',
        ):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_zone_changelist_shows_the_row_and_its_geometry(self):
        body = self.client.get('/admin/core/zone/').content.decode()
        self.assertIn('Admin Zone', body)
        self.assertIn('Danger zone', body)
        self.assertIn('28.666667, 77.233333', body)  # computed centre column
        self.assertIn('field-vertex_count', body)

    def test_activity_changelist_shows_name_message_and_timestamp(self):
        body = self.client.get('/admin/core/activitylog/').content.decode()
        self.assertIn('Admin User', body)
        self.assertIn('hello from admin', body)
