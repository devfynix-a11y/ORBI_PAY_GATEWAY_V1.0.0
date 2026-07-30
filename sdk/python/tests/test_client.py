import hashlib
import hmac
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from orbi_pay_gateway import Orbi, verify_and_parse_webhook


class PythonSdkTest(unittest.TestCase):
    def test_transfers_send_uses_orbi_contract_headers(self):
        captured = {}

        def fake_fetch(url, method, headers, body):
            captured.update({"url": url, "method": method, "headers": headers, "body": body})
            return 200, {"success": True, "data": {"id": "pi_1", "status": "requires_action"}}

        orbi = Orbi(
            base_url="https://sandbox-pay.orbifinancial.com",
            service_key="sk_test",
            environment="Demo",
            fetch=fake_fetch,
        )
        response = orbi.transfers.send(
            {"reference": "ORDER-1", "amount": 5000, "currency": "TZS"},
            idempotency_key="payment-intent:ORDER-1",
            request_id="req-order-1",
            correlation_id="corr-order-1",
            trace_id="trace-order-1",
        )

        self.assertTrue(response["success"])
        self.assertEqual(captured["url"], "https://sandbox-pay.orbifinancial.com/v1/payment-intents")
        self.assertEqual(captured["headers"]["x-orbi-pay-service-key"], "sk_test")
        self.assertEqual(captured["headers"]["x-orbi-environment"], "demo")
        self.assertEqual(captured["headers"]["idempotency-key"], "payment-intent:ORDER-1")
        self.assertEqual(captured["headers"]["x-request-id"], "req-order-1")
        self.assertEqual(captured["headers"]["x-correlation-id"], "corr-order-1")
        self.assertEqual(captured["headers"]["x-trace-id"], "trace-order-1")
        self.assertIn("x-orbi-signature", captured["headers"])
        self.assertEqual(json.loads(captured["body"])["operation"], "collection")

    def test_transfers_send_can_use_access_token_mode(self):
        calls = []

        def fake_fetch(url, method, headers, body):
            calls.append({"url": url, "method": method, "headers": headers, "body": body})
            if url.endswith("/oauth/token"):
                return 200, {
                    "access_token": "orbi_at_python_test",
                    "token_type": "Bearer",
                    "expires_in": 900,
                    "scope": "payments:create",
                }
            return 200, {"success": True, "data": {"id": "pi_1", "status": "requires_action"}}

        orbi = Orbi(
            base_url="https://sandbox-pay.orbifinancial.com",
            service_key="sk_test",
            environment="Demo",
            auth_mode="access_token",
            access_token_scopes=["payments:create"],
            fetch=fake_fetch,
        )
        response = orbi.transfers.send(
            {"reference": "ORDER-1", "amount": 5000, "currency": "TZS"},
            idempotency_key="payment-intent:ORDER-1",
        )

        self.assertTrue(response["success"])
        self.assertEqual(calls[0]["url"], "https://sandbox-pay.orbifinancial.com/oauth/token")
        self.assertIn('"client_secret":"sk_test"', calls[0]["body"])
        self.assertEqual(calls[1]["headers"]["authorization"], "Bearer orbi_at_python_test")
        self.assertNotIn("x-orbi-pay-service-key", calls[1]["headers"])
        self.assertIn("x-orbi-signature", calls[1]["headers"])

    def test_sensitive_runtime_read_is_signed(self):
        captured = {}

        def fake_fetch(url, method, headers, body):
            captured.update({"url": url, "method": method, "headers": headers, "body": body})
            return 200, {"success": True, "data": {"id": "pi_1", "status": "processing"}}

        orbi = Orbi(
            base_url="https://sandbox-pay.orbifinancial.com",
            service_key="sk_test",
            environment="Demo",
            fetch=fake_fetch,
        )
        response = orbi.payments.get_intent("pi_1", request_id="req-read-1")

        self.assertTrue(response["success"])
        self.assertEqual(captured["url"], "https://sandbox-pay.orbifinancial.com/v1/payment-intents/pi_1")
        self.assertEqual(captured["method"], "GET")
        self.assertIsNone(captured["body"])
        self.assertEqual(captured["headers"]["x-orbi-environment"], "demo")
        self.assertEqual(captured["headers"]["x-request-id"], "req-read-1")
        self.assertIn("x-orbi-signature", captured["headers"])
        self.assertIn("x-orbi-timestamp", captured["headers"])
        self.assertIn("x-orbi-nonce", captured["headers"])

    def test_payment_next_action_redirects_hosted_challenge(self):
        orbi = Orbi(base_url="https://sandbox-pay.orbifinancial.com", service_key="sk_test")
        action = orbi.payments.next_action({
            "status": "requires_action",
            "challengeMode": "hosted",
            "challengeUrl": "https://pay.orbifinancial.com/challenge/pi_1",
        })
        self.assertEqual(action["type"], "redirect_to_hosted_challenge")

    def test_webhook_verification(self):
        body = '{"eventId":"evt_1","eventType":"payment_intent.updated","serviceCode":"shop"}'
        timestamp = "1780000000"
        secret = "whsec"
        signature = hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
        parsed = verify_and_parse_webhook(
            raw_body=body,
            signature_header=f"sha256={signature}",
            timestamp_header=timestamp,
            secret=secret,
            now_seconds=1780000000,
        )
        self.assertTrue(parsed["ok"])
        self.assertEqual(parsed["event"]["eventId"], "evt_1")


if __name__ == "__main__":
    unittest.main()
