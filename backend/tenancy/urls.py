from django.urls import path
from .views import configuration
from . import api

urlpatterns = [path('configuration/', configuration),path('registry/',api.registry),
    path('revisions/',api.revisions),path('revisions/<int:pk>/review/',api.review),
    path('releases/',api.releases),path('releases/<int:pk>/activate/',api.activation),
    path('executions/',api.executions)]
