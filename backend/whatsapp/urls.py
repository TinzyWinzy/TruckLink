from django.urls import path
from . import views

urlpatterns = [
    path('webhook/<slug:tenant_slug>/',views.webhook,name='tenant-whatsapp-webhook'),
    path("webhook/", views.webhook, name="whatsapp-webhook"),
]
