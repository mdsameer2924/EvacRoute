"""
URL configuration for the EVACROUTE project.

* ``/``            -> the original single-page map app (core.views.index)
* ``/dashboard/``  -> React dashboard backed by SQLite
* ``/api/...``     -> JSON endpoints used by the dashboard
* ``/admin/``      -> Django admin for the Zone / ActivityLog models
"""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('core.urls')),
]
