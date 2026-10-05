# BAK workspace design direction

Adapt NetOne's enterprise hierarchy and VehicleImport's persistent workspace navigation into an evidence-first BAK operations workbench.

References inspected locally:
- NetOne/Econet/econet-compliance-poc/src/App.tsx and src/index.css: dark masthead, amber selection, quiet evidence surfaces and compact information hierarchy.
- VehicleImportMulti-TenantCustomerPortalSpecification/web/src/pages/AppLayout.tsx and src/index.css: desktop navigation rail, warm paper, account context and responsive controls.

Implemented in the shared BAK layout and UI kit: BAK INTEL masthead, role-filtered desktop rail, horizontally scrolling mobile navigation, warm workspace, smaller panel radii, restrained shadows and solid action colors. Record statuses retain text and symbols. Session, offline review badges and permission gates retain their existing behavior. Removed hardcoded demo/location labels from the shell and queue heading.

Screenshots are synthetic practice data, not production evidence:
- [Desktop](design/bak-desktop.png)
- [Mobile](design/bak-mobile.png)

Responsive verification covers 1440px desktop and 390px mobile, page overflow, sign-out visibility and navigation. This design pass is local and has not been deployed.
