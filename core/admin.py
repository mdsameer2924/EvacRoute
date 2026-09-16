"""EVACROUTE — Django admin configuration.

Both models are registered so the SQLite data can be inspected and edited
during the demo: zones (danger polygons / safe points) and the activity log.
"""

from django.contrib import admin

from .geojson import seed_demo_zones
from .models import ActivityLog, Zone

admin.site.site_header = 'EVACROUTE administration'
admin.site.site_title = 'EVACROUTE'
admin.site.index_title = 'Zones, submissions and activity'


@admin.register(Zone)
class ZoneAdmin(admin.ModelAdmin):
    list_display = ('name', 'kind', 'vertex_count', 'center', 'zone_id', 'created_at')
    list_filter = ('kind', 'created_at')
    search_fields = ('name', 'zone_id')
    readonly_fields = ('zone_id', 'created_at', 'vertex_count', 'center')
    ordering = ('kind', 'name')
    date_hierarchy = 'created_at'
    actions = ('seed_demo_dataset',)

    @admin.display(description='Vertices')
    def vertex_count(self, obj):
        return obj.vertex_count

    @admin.display(description='Centre [lat, lng]')
    def center(self, obj):
        return obj.center

    @admin.action(description='Insert the EVACROUTE demo dataset')
    def seed_demo_dataset(self, request, queryset):
        created = seed_demo_zones()
        if created:
            self.message_user(request, f'{created} demo zone(s) inserted.')
        else:
            self.message_user(request, 'Demo zones were already present.')


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ('timestamp', 'name', 'kind', 'short_message', 'latitude', 'longitude')
    list_filter = ('kind', 'timestamp')
    search_fields = ('name', 'message')
    readonly_fields = ('timestamp',)
    ordering = ('-timestamp',)
    date_hierarchy = 'timestamp'

    @admin.display(description='Message')
    def short_message(self, obj):
        return obj.short_message