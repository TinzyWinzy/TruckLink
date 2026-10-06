"""WhatsApp webhook — Twilio inbound message handler with signature validation."""
import logging
from urllib.parse import parse_qs

from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse

from .handlers import handle_incoming

logger = logging.getLogger(__name__)


def _validate_twilio_request(request, token):
    """Validate that the request genuinely came from Twilio."""
    twilio_signature = request.META.get("HTTP_X_TWILIO_SIGNATURE", "")
    if not twilio_signature:
        return False

    validator = RequestValidator(token)
    url = request.build_absolute_uri()
    post_data = request.POST.dict() if request.POST else parse_qs(request.body.decode("utf-8"))
    flat_post = {k: v[0] if isinstance(v, list) else v for k, v in post_data.items()}

    return validator.validate(url, flat_post, twilio_signature)


@csrf_exempt
def webhook(request, tenant_slug=None):
    """Twilio WhatsApp webhook: receive messages and reply."""
    if request.method != "POST":
        return HttpResponse(status=405)

    from trip.models import Organisation
    from tenancy.integrations import credential
    if tenant_slug:
        organisation = Organisation.objects.filter(slug=tenant_slug,is_deleted=False).first()
    else:
        configured = [org for org in Organisation.objects.filter(is_deleted=False) if credential(org,'twilio','AUTH_TOKEN')]
        organisation = configured[0] if len(configured) == 1 else None
    if not organisation:
        return HttpResponse(status=404)
    token = credential(organisation,'twilio','AUTH_TOKEN')
    if not token or not _validate_twilio_request(request,token):
        return HttpResponse(status=403)

    try:
        body_text = request.body.decode("utf-8")
        params = parse_qs(body_text)

        from_number = params.get("From", [""])[0].replace("whatsapp:", "")
        message_body = params.get("Body", [""])[0].strip()
        num_media = int(params.get("NumMedia", ["0"])[0])

        lat = None
        lon = None

        if num_media > 0:
            media_type = params.get("MediaContentType0", [""])[0]
            if media_type == "image/jpeg" or "location" in message_body.lower() or num_media > 0:
                lat_str = params.get("Latitude", [None])[0]
                lon_str = params.get("Longitude", [None])[0]
                if lat_str and lon_str:
                    lat = float(lat_str)
                    lon = float(lon_str)

        logger.info(
            "WhatsApp from %s: body=%s lat=%s lon=%s",
            from_number, message_body[:50], lat, lon,
        )

        reply = handle_incoming(
            phone=from_number,
            body=message_body,
            lat=lat,
            lon=lon,
            organisation=organisation,
        )

        resp = MessagingResponse()
        resp.message(reply)
        return HttpResponse(str(resp), content_type="application/xml")

    except Exception as e:
        logger.exception("WhatsApp webhook error")
        resp = MessagingResponse()
        resp.message("Sorry, an error occurred. Please try again.")
        return HttpResponse(str(resp), content_type="application/xml")
