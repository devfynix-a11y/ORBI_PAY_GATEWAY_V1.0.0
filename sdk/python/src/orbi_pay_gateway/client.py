from __future__ import annotations

import hashlib
import hmac
import json
import base64
import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa


Json = dict[str, Any]
Fetch = Callable[[str, str, dict[str, str], str | None], tuple[int, Json]]


class OrbiPayGatewayError(Exception):
    def __init__(self, message: str, status: int | None = None, response: Any = None):
        super().__init__(message)
        self.status = status
        self.response = response


@dataclass(frozen=True)
class OrbiPayGatewayConfig:
    base_url: str
    service_key: str | None = None
    operator_key: str | None = None
    oauth_client_id: str | None = None
    environment: str | None = None
    auth_mode: str = "api_key"
    dpop: bool = False
    access_token_scopes: list[str] | None = None
    access_token_refresh_skew_seconds: int = 60
    request_signing: bool = True
    request_signing_secret: str | None = None
    fetch: Fetch | None = None


class OrbiPayGatewayClient:
    def __init__(
        self,
        base_url: str,
        service_key: str | None = None,
        operator_key: str | None = None,
        oauth_client_id: str | None = None,
        environment: str | None = None,
        auth_mode: str = "api_key",
        dpop: bool = False,
        access_token_scopes: list[str] | None = None,
        access_token_refresh_skew_seconds: int = 60,
        request_signing: bool = True,
        request_signing_secret: str | None = None,
        fetch: Fetch | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.service_key = service_key or ""
        self.operator_key = operator_key
        self.oauth_client_id = oauth_client_id
        self.environment = environment
        self.auth_mode = auth_mode
        self.dpop = bool(dpop)
        self.access_token_scopes = access_token_scopes or []
        self.access_token_refresh_skew_seconds = max(5, access_token_refresh_skew_seconds)
        self.request_signing = request_signing
        self.request_signing_secret = request_signing_secret
        self.fetch = fetch or _default_fetch
        self._access_token: str | None = None
        self._access_token_type = "Bearer"
        self._access_token_expires_at = 0.0
        self._access_token_scope = ""
        self._dpop_private_key: rsa.RSAPrivateKey | None = None
        self._dpop_public_jwk: Json | None = None
        if not self.base_url:
            raise ValueError("ORBI_PAY_GATEWAY_BASE_URL_REQUIRED")
        if not self.service_key and not self.operator_key:
            raise ValueError("ORBI_PAY_GATEWAY_CREDENTIAL_REQUIRED")

    def get_oauth_metadata(self) -> Json:
        status, response = self.fetch(
            f"{self.base_url}/.well-known/oauth-authorization-server",
            "GET",
            {"accept": "application/json"},
            None,
        )
        if status >= 400:
            raise OrbiPayGatewayError(str(response.get("error") or f"ORBI_PAY_GATEWAY_OAUTH_METADATA_HTTP_{status}"), status, response)
        return response

    def create_oauth_authorization_url(self, payload: Json) -> Json:
        state = str(payload.get("state") or _random_url_token(32))
        code_verifier = str(payload.get("code_verifier") or _random_url_token(64))
        code_challenge = _pkce_challenge(code_verifier)
        client_id = str(payload.get("client_id") or self._oauth_client_id())
        params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": payload["redirect_uri"],
            "scope": " ".join(payload.get("scopes") or []),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        return {
            "url": f"{self.base_url}/oauth/authorize?{urlencode(params)}",
            "state": state,
            "code_verifier": code_verifier,
            "code_challenge": code_challenge,
        }

    def create_pushed_oauth_authorization_url(self, payload: Json) -> Json:
        prepared = self.create_oauth_authorization_url(payload)
        client_id = str(payload.get("client_id") or self._oauth_client_id())
        body = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": payload["redirect_uri"],
            "scope": " ".join(payload.get("scopes") or []),
            "state": prepared["state"],
            "code_challenge": prepared["code_challenge"],
            "code_challenge_method": "S256",
            "client_secret": self.service_key,
        }
        status, response = self.fetch(
            f"{self.base_url}/oauth/par",
            "POST",
            {"accept": "application/json", "content-type": "application/json"},
            json.dumps(body, separators=(",", ":")),
        )
        if status >= 400 or not response.get("request_uri"):
            raise OrbiPayGatewayError(str(response.get("error") or f"ORBI_PAY_GATEWAY_OAUTH_PAR_HTTP_{status}"), status, response)
        params = {"client_id": client_id, "request_uri": response["request_uri"]}
        return {
            **prepared,
            "url": f"{self.base_url}/oauth/authorize?{urlencode(params)}",
            "request_uri": response["request_uri"],
            "expires_in": response.get("expires_in"),
        }

    def exchange_oauth_authorization_code(self, payload: Json) -> Json:
        return self._oauth_token({
            "grant_type": "authorization_code",
            "client_id": payload.get("client_id") or self._oauth_client_id(),
            "code": payload["code"],
            "redirect_uri": payload["redirect_uri"],
            "code_verifier": payload["code_verifier"],
            **({"scope": " ".join(payload["scopes"]) if isinstance(payload.get("scopes"), list) else payload.get("scope")} if payload.get("scope") or payload.get("scopes") else {}),
        })

    def refresh_oauth_access_token(self, payload: Json) -> Json:
        return self._oauth_token({
            "grant_type": "refresh_token",
            "client_id": payload.get("client_id") or self._oauth_client_id(),
            "refresh_token": payload["refresh_token"],
            **({"scope": " ".join(payload["scopes"]) if isinstance(payload.get("scopes"), list) else payload.get("scope")} if payload.get("scope") or payload.get("scopes") else {}),
        })

    def introspect_access_token(self, token: str) -> Json:
        status, response = self.fetch(
            f"{self.base_url}/oauth/introspect",
            "POST",
            {"accept": "application/json", "content-type": "application/json"},
            json.dumps({"token": token, "client_secret": self.service_key}, separators=(",", ":")),
        )
        if status >= 400:
            raise OrbiPayGatewayError(str(response.get("error") or f"ORBI_PAY_GATEWAY_OAUTH_INTROSPECT_HTTP_{status}"), status, response)
        return response

    def revoke_access_token(self, token: str) -> Json:
        status, response = self.fetch(
            f"{self.base_url}/oauth/revoke",
            "POST",
            {"accept": "application/json", "content-type": "application/json"},
            json.dumps({"token": token, "client_secret": self.service_key}, separators=(",", ":")),
        )
        if status >= 400:
            raise OrbiPayGatewayError(str(response.get("error") or f"ORBI_PAY_GATEWAY_OAUTH_REVOKE_HTTP_{status}"), status, response)
        if self._access_token == token:
            self._access_token = None
            self._access_token_scope = ""
            self._access_token_expires_at = 0.0
        return response

    def _oauth_token(self, payload: Json) -> Json:
        headers = {"accept": "application/json", "content-type": "application/json"}
        if self.dpop:
            headers["dpop"] = self._create_dpop_proof("POST", f"{self.base_url}/oauth/token")
        status, response = self.fetch(
            f"{self.base_url}/oauth/token",
            "POST",
            headers,
            json.dumps(payload, separators=(",", ":")),
        )
        if status >= 400 or not response.get("access_token"):
            raise OrbiPayGatewayError(str(response.get("error") or f"ORBI_PAY_GATEWAY_OAUTH_TOKEN_HTTP_{status}"), status, response)
        return response

    def create_payment_intent(self, payload: Json, **options: Any) -> Json:
        return self._request("POST", "/v1/payment-intents", payload, options)

    def create_checkout_payment_intent(self, payload: Json, **options: Any) -> Json:
        return self.create_payment_intent({**payload, "confirm": payload.get("confirm", True)}, **options)

    def get_payment_intent(self, intent_id: str, **options: Any) -> Json:
        return self._request("GET", f"/v1/payment-intents/{intent_id}", None, options)

    def confirm_payment_intent(self, intent_id: str, payload: Json | None = None, **options: Any) -> Json:
        return self._request("POST", f"/v1/payment-intents/{intent_id}/confirm", payload or {}, options)

    def payment_intent_next_action(self, intent: Json) -> Json:
        status = intent.get("status")
        if status == "completed":
            return {"type": "complete", "intent": intent}
        if status in ("failed", "cancelled"):
            return {"type": "failed", "intent": intent}
        if status == "requires_action" and intent.get("challengeMode") == "hosted" and intent.get("challengeUrl"):
            return {"type": "redirect_to_hosted_challenge", "url": intent["challengeUrl"], "intent": intent}
        if status == "requires_action" and intent.get("challengeMode") == "in_app_required":
            return {"type": "open_in_app_challenge", "intent": intent}
        return {"type": "wait_for_webhook", "intent": intent}

    def create_paysafe_escrow(self, payload: Json, **options: Any) -> Json:
        return self._request("POST", "/v1/paysafe/escrows", payload, options)

    def release_paysafe_escrow(self, escrow_id: str, payload: Json, **options: Any) -> Json:
        return self._request("POST", f"/v1/paysafe/escrows/{escrow_id}/release", payload, options)

    def refund_paysafe_escrow(self, escrow_id: str, payload: Json, **options: Any) -> Json:
        return self._request("POST", f"/v1/paysafe/escrows/{escrow_id}/refund", payload, options)

    def dispute_paysafe_escrow(self, escrow_id: str, payload: Json, **options: Any) -> Json:
        return self._request("POST", f"/v1/paysafe/escrows/{escrow_id}/dispute", payload, options)

    def resolve_identity(self, payload: Json, **options: Any) -> Json:
        return self._request("POST", "/v1/identity/resolve", payload, options)

    def create_business_registration(self, payload: Json, **options: Any) -> Json:
        return self._request("POST", "/v1/business/registrations", payload, options)

    def create_payment_profile(self, payload: Json, **options: Any) -> Json:
        return self._request("POST", "/v1/payment-profiles", payload, options)

    def link_payment_profile(self, payload: Json, **options: Any) -> Json:
        if not options.get("idempotency_key") and payload.get("externalCustomerId"):
            options["idempotency_key"] = f"payment-profile:{payload['externalCustomerId']}"
        return self.create_payment_profile(payload, **options)

    def _request(self, method: str, path: str, payload: Json | None = None, options: Json | None = None) -> Json:
        if not self.service_key:
            raise ValueError("ORBI_PAY_GATEWAY_SERVICE_KEY_REQUIRED")
        options = options or {}
        body = None if method == "GET" else json.dumps(payload or {}, separators=(",", ":"))
        auth_headers, signing_secret = self._service_authorization(method, path)
        headers = {
            "accept": "application/json",
            **auth_headers,
            **(options.get("headers") or {}),
        }
        environment = _normalize_environment(options.get("environment") or self.environment)
        if environment:
            headers["x-orbi-environment"] = environment
        if options.get("idempotency_key"):
            headers["idempotency-key"] = options["idempotency_key"]
        if options.get("request_id"):
            headers["x-request-id"] = options["request_id"]
        if options.get("correlation_id"):
            headers["x-correlation-id"] = options["correlation_id"]
        if options.get("trace_id"):
            headers["x-trace-id"] = options["trace_id"]
        if method != "GET":
            headers["content-type"] = "application/json"
        if self.request_signing and self.service_key:
            headers.update(_sign_request(method, path, body or "", self.request_signing_secret or signing_secret))
        status, response = self.fetch(f"{self.base_url}{path}", method, headers, body)
        if status >= 400 and not isinstance(response, dict):
            raise OrbiPayGatewayError(f"ORBI_PAY_GATEWAY_HTTP_{status}", status, response)
        return response

    def _service_authorization(self, method: str, path: str) -> tuple[dict[str, str], str]:
        if self.auth_mode == "api_key":
            return {"x-orbi-pay-service-key": self.service_key}, self.service_key
        if self.auth_mode != "access_token":
            raise ValueError("ORBI_PAY_GATEWAY_AUTH_MODE_INVALID")
        token = self._get_service_access_token()
        headers = {"authorization": f"{self._access_token_type} {token}"}
        if self._access_token_type == "DPoP":
            headers["dpop"] = self._create_dpop_proof(method, f"{self.base_url}{path}")
        return headers, token

    def _get_service_access_token(self) -> str:
        scope = " ".join(self.access_token_scopes)
        if (
            self._access_token
            and self._access_token_scope == scope
            and self._access_token_expires_at - self.access_token_refresh_skew_seconds > time.time()
        ):
            return self._access_token
        body = {
            "grant_type": "client_credentials",
            "client_secret": self.service_key,
            **({"scope": scope} if scope else {}),
        }
        response = self._oauth_token(body)
        self._access_token = str(response["access_token"])
        self._access_token_type = "DPoP" if str(response.get("token_type") or "Bearer").lower() == "dpop" else "Bearer"
        self._access_token_scope = scope
        self._access_token_expires_at = time.time() + int(response.get("expires_in") or 900)
        return self._access_token

    def _oauth_client_id(self) -> str:
        value = (self.oauth_client_id or "").strip()
        if not value:
            raise ValueError("ORBI_PAY_GATEWAY_OAUTH_CLIENT_ID_REQUIRED")
        return value

    def _create_dpop_proof(self, method: str, htu: str) -> str:
        if not self._dpop_private_key or not self._dpop_public_jwk:
            self._dpop_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            public_numbers = self._dpop_private_key.public_key().public_numbers()
            self._dpop_public_jwk = {
                "kty": "RSA",
                "n": _b64url_uint(public_numbers.n),
                "e": _b64url_uint(public_numbers.e),
            }
        header = _b64url_json({"alg": "RS256", "typ": "dpop+jwt", "jwk": self._dpop_public_jwk})
        payload = _b64url_json({
            "htm": method.upper(),
            "htu": htu,
            "iat": int(time.time()),
            "jti": str(uuid.uuid4()),
        })
        signed = f"{header}.{payload}".encode("utf-8")
        signature = self._dpop_private_key.sign(signed, padding.PKCS1v15(), hashes.SHA256())
        return f"{header}.{payload}.{_b64url(signature)}"


class Orbi:
    def __init__(self, **config: Any):
        self.client = OrbiPayGatewayClient(**config)
        self.transfers = _Transfers(self.client)
        self.payments = _Payments(self.client)
        self.paysafe = _PaySafe(self.client)
        self.identity = _Identity(self.client)
        self.payment_profiles = _PaymentProfiles(self.client)
        self.oauth = _OAuth(self.client)


class _OAuth:
    def __init__(self, client: OrbiPayGatewayClient):
        self.client = client

    def metadata(self) -> Json:
        return self.client.get_oauth_metadata()

    def authorize_url(self, payload: Json) -> Json:
        return self.client.create_oauth_authorization_url(payload)

    def pushed_authorize_url(self, payload: Json) -> Json:
        return self.client.create_pushed_oauth_authorization_url(payload)

    def exchange_code(self, payload: Json) -> Json:
        return self.client.exchange_oauth_authorization_code(payload)

    def refresh(self, payload: Json) -> Json:
        return self.client.refresh_oauth_access_token(payload)

    def introspect(self, token: str) -> Json:
        return self.client.introspect_access_token(token)

    def revoke(self, token: str) -> Json:
        return self.client.revoke_access_token(token)


class _Transfers:
    def __init__(self, client: OrbiPayGatewayClient):
        self.client = client

    def send(self, payload: Json, **options: Any) -> Json:
        return self.client.create_payment_intent(
            {
                **payload,
                "operation": "collection",
                "paymentCategory": payload.get("paymentCategory", "orbi"),
                "paymentRail": payload.get("paymentRail", "orbi_wallet"),
            },
            **options,
        )


class _Payments:
    def __init__(self, client: OrbiPayGatewayClient):
        self.client = client

    def create_intent(self, payload: Json, **options: Any) -> Json:
        return self.client.create_payment_intent(payload, **options)

    def checkout(self, payload: Json, **options: Any) -> Json:
        return self.client.create_checkout_payment_intent(payload, **options)

    def get_intent(self, intent_id: str, **options: Any) -> Json:
        return self.client.get_payment_intent(intent_id, **options)

    def confirm_intent(self, intent_id: str, payload: Json | None = None, **options: Any) -> Json:
        return self.client.confirm_payment_intent(intent_id, payload, **options)

    def next_action(self, intent: Json) -> Json:
        return self.client.payment_intent_next_action(intent)


class _PaySafe:
    def __init__(self, client: OrbiPayGatewayClient):
        self.client = client

    def create_escrow(self, payload: Json, **options: Any) -> Json:
        return self.client.create_paysafe_escrow(payload, **options)

    def release(self, escrow_id: str, payload: Json, **options: Any) -> Json:
        return self.client.release_paysafe_escrow(escrow_id, payload, **options)

    def refund(self, escrow_id: str, payload: Json, **options: Any) -> Json:
        return self.client.refund_paysafe_escrow(escrow_id, payload, **options)

    def dispute(self, escrow_id: str, payload: Json, **options: Any) -> Json:
        return self.client.dispute_paysafe_escrow(escrow_id, payload, **options)


class _Identity:
    def __init__(self, client: OrbiPayGatewayClient):
        self.client = client

    def resolve(self, payload: Json, **options: Any) -> Json:
        return self.client.resolve_identity(payload, **options)

    def register_business(self, payload: Json, **options: Any) -> Json:
        return self.client.create_business_registration(payload, **options)


class _PaymentProfiles:
    def __init__(self, client: OrbiPayGatewayClient):
        self.client = client

    def link(self, payload: Json, **options: Any) -> Json:
        return self.client.link_payment_profile(payload, **options)


def _default_fetch(url: str, method: str, headers: dict[str, str], body: str | None) -> tuple[int, Json]:
    request = Request(url, data=body.encode("utf-8") if body is not None else None, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            text = response.read().decode("utf-8")
            return response.status, json.loads(text) if text else {}
    except HTTPError as error:
        text = error.read().decode("utf-8")
        return error.code, json.loads(text) if text else {}


def _normalize_environment(environment: str | None) -> str | None:
    if not environment:
        return None
    normalized = environment.strip().lower()
    if normalized == "demo":
        return "demo"
    if normalized == "production":
        return "production"
    raise ValueError("ORBI_PAY_GATEWAY_ENVIRONMENT_INVALID")


def _sign_request(method: str, path: str, body: str, secret: str) -> dict[str, str]:
    timestamp = str(int(time.time()))
    nonce = str(uuid.uuid4())
    body_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
    canonical = ".".join([timestamp, nonce, method.upper(), path, body_hash])
    signature = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "x-orbi-timestamp": timestamp,
        "x-orbi-nonce": nonce,
        "x-orbi-signature": f"sha256={signature}",
    }


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_json(value: Json) -> str:
    return _b64url(json.dumps(value, separators=(",", ":")).encode("utf-8"))


def _b64url_uint(value: int) -> str:
    size = max(1, (value.bit_length() + 7) // 8)
    return _b64url(value.to_bytes(size, "big"))


def _random_url_token(size: int) -> str:
    return secrets.token_urlsafe(size)[:size]


def _pkce_challenge(verifier: str) -> str:
    return _b64url(hashlib.sha256(verifier.encode("utf-8")).digest())


def _query_string(query: Json) -> str:
    clean = {key: value for key, value in query.items() if value is not None and str(value).strip()}
    return f"?{urlencode(clean)}" if clean else ""
