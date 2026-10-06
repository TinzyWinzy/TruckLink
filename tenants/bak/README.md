# BAK Logistics reference tenant

This tenant supplies the first Trucki reference implementation. Its manifest owns branding, role labels, operational workflow defaults, notification bindings and a reference yard. It does not own the platform evaluator, transport entities or reusable workflows.

The existing BAK Operations organisation and BAK Main Yard IDs are preserved. BAK Logistics is the tenant display brand; the legacy legal/organisation name and staff identifiers are kept for compatibility. Existing site records, memberships, configuration and audit history are not overwritten by applying the manifest.

The manifest contains environment-variable prefixes, never credentials. The inherited Twilio/VAPID names are explicitly assigned to BAK; new tenants receive no such binding. Platform-catalogue adoption is configured separately and no instrument or monetary penalty is asserted as verified law here.

See [platform architecture](../../docs/TENANT_PLATFORM_ARCHITECTURE.md).
