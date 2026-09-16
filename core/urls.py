"""EVACROUTE — app URLs.

The main app is served at the site root (``/``); the React dashboard and the
JSON API live under fixed prefixes.
"""

from django.urls import path

from . import views

app_name = 'core'

urlpatterns = [
    # pages
    path('', views.index, name='index'),
    path('dashboard/', views.dashboard, name='dashboard'),
    # zones API (GeoJSON in / out)
    path('api/zones/', views.api_zones, name='api-zones'),
    path('api/zones/seed/', views.api_seed_zones, name='api-zones-seed'),
    path('api/zones/<str:zone_id>/', views.api_zone_detail, name='api-zone-detail'),
    # activity log API
    path('api/logs/', views.api_logs, name='api-logs'),
    path('api/logs/<int:pk>/', views.api_log_detail, name='api-log-detail'),
    # counters for the dashboard header
    path('api/summary/', views.api_summary, name='api-summary'),
]
