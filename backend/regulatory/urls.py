from django.urls import path
from . import knowledge_api
from . import views as v
from .catalogue import CatalogueView, SelectionView

urlpatterns = [
    path('evidence-workspace/', v.EvidenceWorkspaceView.as_view()),
    path('knowledge/',knowledge_api.knowledge),
    path('knowledge/<int:pk>/review/',knowledge_api.review),
    path('knowledge/import-legacy/',knowledge_api.import_legacy),
    path('governance-audit/',knowledge_api.audit),
    path('platform-catalogue/', CatalogueView.as_view()),
    path('tenant-selections/', SelectionView.as_view()),
    *[path(f'{kind}/', v.RegistryView.as_view(), {'kind': kind}) for kind in ('sources', 'evidence', 'vehicle-configurations', 'loads', 'rule-units', 'rulesets')],
    path('reviews/', v.ReviewView.as_view()),
    path('rulesets/<int:pk>/publish/', v.PublishView.as_view()),
    path('queue/<int:pk>/context/', v.ContextView.as_view()),
    path('queue/<int:pk>/setup/', v.SetupView.as_view()),
    path('evaluate/', v.InspectView.as_view()),
    path('attempts/<int:pk>/', v.AttemptView.as_view()),
    path('attempts/<int:pk>/override-request/', v.OverrideRequestView.as_view()),
    path('override-requests/<int:pk>/approve/', v.OverrideApprovalView.as_view()),
]
