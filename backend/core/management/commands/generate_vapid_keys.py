"""Generate a VAPID key pair for the web-push leg (SAD §10)."""
from __future__ import annotations

from cryptography.hazmat.primitives import serialization
from django.core.management.base import BaseCommand
from py_vapid import Vapid02, b64urlencode


class Command(BaseCommand):
    help = (
        "Generate a VAPID key pair. Set the output as VAPID_PUBLIC_KEY "
        "(also VITE_VAPID_PUBLIC_KEY on the frontend) and VAPID_PRIVATE_KEY "
        "(backend only — never ship it to the browser)."
    )

    def handle(self, *args, **options):
        vapid = Vapid02()
        vapid.generate_keys()
        der = vapid.public_key.public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        public_key = b64urlencode(der)
        if isinstance(public_key, bytes):
            public_key = public_key.decode()
        private_key = vapid.private_pem().decode()
        self.stdout.write(f"VAPID_PUBLIC_KEY={public_key}")
        self.stdout.write(f"VAPID_PRIVATE_KEY={private_key}")
