"""``python manage.py seed_demo_zones`` — load the demo dataset into SQLite."""

from django.core.management.base import BaseCommand

from core.geojson import seed_demo_zones
from core.models import Zone


class Command(BaseCommand):
    help = 'Insert the EVACROUTE demo zones (3 danger + 2 safe) into the database.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--reset',
            action='store_true',
            help='Delete every existing zone before seeding.',
        )

    def handle(self, *args, **options):
        if options['reset']:
            removed, _ = Zone.objects.all().delete()
            self.stdout.write(self.style.WARNING(f'Cleared {removed} zone(s).'))

        created = seed_demo_zones()
        danger = Zone.objects.filter(kind=Zone.DANGER).count()
        safe = Zone.objects.filter(kind=Zone.SAFE).count()
        self.stdout.write(
            self.style.SUCCESS(
                f'Inserted {created} demo zone(s). '
                f'Database now holds {danger} danger + {safe} safe zone(s).'
            )
        )
