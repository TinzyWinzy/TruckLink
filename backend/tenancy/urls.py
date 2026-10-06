from django.urls import path
from .views import configuration

urlpatterns = [path('configuration/', configuration)]
