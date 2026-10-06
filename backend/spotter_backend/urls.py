"""URL configuration for spotter_backend project."""
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('api/tenant/', include('tenancy.urls')),
    path("api/regulatory/", include("regulatory.urls")),
    path("admin/", admin.site.urls),
    path("api/", include("trip.urls")),
    path("api/whatsapp/", include("whatsapp.urls")),
]
