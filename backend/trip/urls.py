from core.modelling_views import model_workspace
"""URL routes."""
from django.urls import path
from compliance import views as compliance_views
from core import views as core_views
from core import audit_views as core_audit_views
from yard import views as yard_views
from . import views, auth_views, admin_views, route_views

urlpatterns = [
    path('routes/workspace/', route_views.route_workspace),
    path('routes/preview/', route_views.route_command),
    path('routes/drafts/', route_views.route_command, {'save': True}),
    path("health/", views.health),
    # Admin trip planning
    path("trip/", views.trip_plan),
    path("trip/estimate/", views.trip_estimate),
    path("trips/", views.trips_list),
    path("trips/<int:pk>/", views.trip_detail),
    path("trips/<int:pk>/status/", views.trip_update_status),
    path("trips/<int:pk>/positions/", views.trip_positions),
    path("trips/<int:pk>/sos/", views.trip_sos),
    path("trips/<int:pk>/sos/acknowledge/", views.trip_sos_acknowledge),
    # Admin CRUD
    path("drivers/", views.drivers_list),
    path("drivers/<int:pk>/", views.driver_detail),
    path("vehicles/", views.vehicles_list),
    path("vehicles/<int:pk>/", views.vehicle_detail),
    path("fuel/", views.fuel_list),
    path("commodities/", views.commodity_list),
    path("commodity-categories/", views.commodity_categories),
    # Admin booking operations
    path("bookings/", views.bookings_list),
    path("bookings/<int:pk>/assign/", views.booking_assign),
    path("bookings/<int:pk>/images/", views.booking_images),
    # Public booking endpoints
    path("public/quote/", views.public_quote),
    path("public/book/", views.public_book),
    path("public/book/<str:ref>/", views.public_booking_lookup),
    path("public/book/<str:ref>/confirm/", views.public_booking_confirm),
    path("public/track/<str:ref>/", views.public_track),
    # Services
    path("services/", views.service_types_list),
    # Auth
    path("auth/register/", auth_views.register),
    path("auth/login/", auth_views.login_view),
    path("auth/pin/", auth_views.pin_login),
    path("auth/refresh/", auth_views.refresh_session),
    path("auth/logout/", auth_views.logout_view),
    path("modelling/run/", model_workspace),
    path("auth/me/", auth_views.me),
    path("auth/switch-role/", auth_views.switch_role),
    # Tenancy (core app)
    path("tenancy/signup/", core_views.tenancy_signup),
    path("admin/pins/", core_views.provision_pin),
    # Web push (core app; SAD §10)
    path("push/public-key/", core_views.push_public_key),
    path("push/subscribe/", core_views.push_subscribe),
    path("push/unsubscribe/", core_views.push_unsubscribe),
    # Audit chain (core app)
    path("audit/", core_audit_views.AuditListView.as_view()),
    path("audit/verify/", core_audit_views.AuditVerifyView.as_view()),
    path("audit/export.csv", core_audit_views.AuditExportView.as_view()),
    # Compliance engine (compliance app)
    path("compliance/", compliance_views.ComplianceListView.as_view()),
    path(
        "compliance/config/",
        compliance_views.ComplianceConfigListView.as_view(),
    ),
    path(
        "compliance/<int:pk>/override-request/",
        compliance_views.ComplianceOverrideRequestView.as_view(),
    ),
    path(
        "compliance/<int:pk>/override-approve/",
        compliance_views.ComplianceOverrideApproveView.as_view(),
    ),
    # Yard: board, queue, docks, alerts (yard app)
    path("yard/board/", yard_views.YardBoardView.as_view()),
    path("queue/", yard_views.QueueListView.as_view()),
    path("queue/<int:pk>/", yard_views.QueueDetailView.as_view()),
    path("queue/<int:pk>/release/", yard_views.QueueReleaseView.as_view()),
    path("docks/", yard_views.DockListView.as_view()),
    path("docks/<int:pk>/assign/", yard_views.DockAssignView.as_view()),
    path("alerts/", yard_views.AlertListView.as_view()),
    path("alerts/<int:pk>/ack/", yard_views.AlertAckView.as_view()),
    # Reports + admin demo yard (yard app)
    path("reports/turnaround/", yard_views.TurnaroundReportView.as_view()),
    path("reports/export.csv", yard_views.ReportExportView.as_view()),
    path("admin/seed/", yard_views.AdminSeedView.as_view()),
    path("admin/reset/", yard_views.AdminResetView.as_view()),
    # Admin
    path("admin/metrics/", admin_views.metrics),
    path("admin/trips/", admin_views.trips_list),
    path("admin/summary/", admin_views.fleet_summary_text),
    path("admin/active-trips/", admin_views.active_trips),
]
