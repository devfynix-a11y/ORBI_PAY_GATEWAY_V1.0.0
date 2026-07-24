# ORBI Pay Gateway Postman Collection

Bootstrap collection:

```text
docs/postman/orbi-pay-gateway.postman_collection.json
```

Bootstrap environment:

```text
docs/postman/orbi-pay-gateway.postman_environment.json
```

## Recommended Flow

1. Import the collection and environment.
2. Set `base_url`, `service_key`, and `operator_key`.
3. Run `Resolve Identity` if your flow needs an ORBI customer lookup.
4. Run `Link Payment Profile` for seller/member/customer profile linking.
5. Run `Create Checkout Payment Intent`.
6. If the response has `challengeUrl`, open the hosted challenge in a browser.
7. Use `Read Payment Intent` to inspect current state.
8. Use signed webhooks as payment truth.
9. Use `List Webhook Deliveries` and `Replay Webhook Delivery` for operations.

## Safety Rules

```text
Do not put service keys in browsers or mobile apps.
Reuse the same idempotency key after network failure.
Return URLs are customer UX only.
Signed webhooks and payment-intent reads are payment truth.
Replay does not create a new payment or ledger movement.
```

Insomnia can import the collection JSON directly. If your version cannot import
Postman v2.1 environments, copy the variables manually.
