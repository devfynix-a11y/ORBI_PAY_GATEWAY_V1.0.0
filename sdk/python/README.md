# ORBI Pay Gateway Python SDK

Official server-side Python SDK for ORBI Pay Gateway.

Use this SDK from a trusted backend only. Do not put ORBI service keys in browser, mobile, or public client code.

## Install

Status: live on PyPI.

```bash
pip install orbi-pay-gateway
```

## Create a payment

```python
import os
from orbi_pay_gateway import Orbi

orbi = Orbi(
    base_url=os.environ["ORBI_PAY_GATEWAY_BASE_URL"],
    service_key=os.environ["ORBI_PAY_SERVICE_KEY"],
    environment=os.environ.get("ORBI_PAY_ENVIRONMENT", "Demo"),
)

intent = orbi.transfers.send(
    {
        "reference": "ORDER-10001",
        "amount": 125000,
        "currency": "TZS",
        "description": "Protected checkout",
        "customer": {"phone": "+255700000000"},
        "returnUrl": os.environ["ORBI_PAY_RETURN_URL"],
        "cancelUrl": os.environ["ORBI_PAY_CANCEL_URL"],
        "callbackUrl": os.environ["ORBI_PAY_WEBHOOK_URL"],
    },
    idempotency_key="payment-intent:merchant:ORDER-10001",
)

action = orbi.payments.next_action(intent["data"])
if action["type"] == "redirect_to_hosted_challenge":
    print(action["url"])
```

## Verify payment updates

```python
from orbi_pay_gateway import verify_and_parse_webhook

event = verify_and_parse_webhook(
    raw_body=request.data,
    signature_header=request.headers.get("x-orbi-pay-signature", ""),
    timestamp_header=request.headers.get("x-orbi-pay-timestamp", ""),
    secret=os.environ["ORBI_PAY_WEBHOOK_SECRET"],
)
```
