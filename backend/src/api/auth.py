import base64
import hashlib
import os
import re
import traceback
import logging
from typing import Any

import httpx
from fastapi import APIRouter, Request
from fastapi import HTTPException
from fastapi.responses import JSONResponse, RedirectResponse, Response


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


def _oauth_state_secret() -> str:
    return os.getenv(
        "OAUTH_STATE_SECRET",
        os.getenv("JWT_SECRET", os.getenv("SSE_SECRET", "dev-secret")),
    )


def _is_production() -> bool:
    return (
        os.getenv("NODE_ENV") or os.getenv("ENV") or "development"
    ).lower() == "production"


def _is_allowed_frontend_origin(origin: str | None) -> bool:
    if not origin:
        return False
    if _is_production():
        return bool(re.match(r"^https://.*\\.labs\\.vercel\\.dev(:\\d+)?$", origin))
    # In development, allow any origin
    return True


def _b64url(input_bytes: bytes) -> str:
    import base64 as _b

    return _b.urlsafe_b64encode(input_bytes).decode("ascii").rstrip("=")


def _generate_code_verifier() -> str:
    import secrets

    return _b64url(secrets.token_bytes(32))


def _code_challenge_s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return _b64url(digest)


def _backend_origin(request: Request) -> str:
    scheme = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    return f"{scheme}://{host}"


def _is_relative_url(url: str | None) -> bool:
    if not url:
        return False
    from urllib.parse import urlparse

    p = urlparse(url)
    return not p.scheme and not p.netloc and url.startswith("/")


@router.post("/login")
def auth_login(req: Request) -> JSONResponse:
    try:
        client_id = os.getenv("VERCEL_OAUTH_CLIENT_ID")
        if not client_id:
            raise RuntimeError("VERCEL_OAUTH_CLIENT_ID is not configured")

        origin = _backend_origin(req)
        redirect_uri = f"{origin}/api/auth/callback/vercel"

        state_seed = f"{client_id}:{redirect_uri}:{_oauth_state_secret()}".encode("utf-8")
        state = hashlib.sha256(state_seed).hexdigest()

        verifier = _generate_code_verifier()
        challenge = _code_challenge_s256(verifier)

        scope = "openid profile email"
        from urllib.parse import quote

        authorize = (
            "https://vercel.com/oauth/authorize"
            f"?client_id={client_id}"
            f"&redirect_uri={quote(redirect_uri, safe='')}"
            f"&scope={quote(scope, safe='')}"
            f"&response_type=code"
            f"&state={state}"
            f"&code_challenge={challenge}"
            f"&code_challenge_method=S256"
        )

        next_param = req.query_params.get("next") or "/"
        redirect_to = next_param if _is_relative_url(next_param) else "/"

        resp = JSONResponse({"url": authorize})
        cookie_args = {
            "path": "/",
            "secure": _is_production(),
            "httponly": True,
            "samesite": "lax",
            "max_age": 60 * 10,
        }
        resp.set_cookie("vercel_oauth_state", state, **cookie_args)
        resp.set_cookie("vercel_oauth_code_verifier", verifier, **cookie_args)
        resp.set_cookie("vercel_oauth_redirect_to", redirect_to, **cookie_args)
        frontend_origin = req.headers.get("origin")
        if _is_allowed_frontend_origin(frontend_origin):
            resp.set_cookie("vercel_oauth_frontend_origin", frontend_origin, **cookie_args)
        return resp
    except Exception as e:
        logger.error(e)
        logger.error(traceback.format_exc())
        raise e


@router.get("/login/start")
def auth_login_start(req: Request) -> RedirectResponse:
    try:
        client_id = os.getenv("VERCEL_OAUTH_CLIENT_ID")
        if not client_id:
            raise RuntimeError("VERCEL_OAUTH_CLIENT_ID is not configured")

        origin = _backend_origin(req)
        redirect_uri = f"{origin}/api/auth/callback/vercel"

        state_seed = f"{client_id}:{redirect_uri}:{_oauth_state_secret()}".encode("utf-8")
        state = hashlib.sha256(state_seed).hexdigest()

        verifier = _generate_code_verifier()
        challenge = _code_challenge_s256(verifier)

        scope = "openid profile email"
        from urllib.parse import quote

        authorize = (
            "https://vercel.com/oauth/authorize"
            f"?client_id={client_id}"
            f"&redirect_uri={quote(redirect_uri, safe='')}"
            f"&scope={quote(scope, safe='')}"
            f"&response_type=code"
            f"&state={state}"
            f"&code_challenge={challenge}"
            f"&code_challenge_method=S256"
        )

        next_param = req.query_params.get("next") or "/"
        redirect_to = next_param if _is_relative_url(next_param) else "/"

        resp = RedirectResponse(authorize, status_code=302)
        cookie_args = {
            "path": "/",
            "secure": _is_production(),
            "httponly": True,
            "samesite": "lax",
            "max_age": 60 * 10,
        }
        resp.set_cookie("vercel_oauth_state", state, **cookie_args)
        resp.set_cookie("vercel_oauth_code_verifier", verifier, **cookie_args)
        resp.set_cookie("vercel_oauth_redirect_to", redirect_to, **cookie_args)
        frontend_origin = req.headers.get("origin")
        if _is_allowed_frontend_origin(frontend_origin):
            resp.set_cookie("vercel_oauth_frontend_origin", frontend_origin, **cookie_args)
            return resp
    except Exception as e:
        logger.error(e)
        logger.error(traceback.format_exc())
        raise e


@router.get("/callback/vercel")
async def auth_callback_vercel(request: Request) -> Response:
    try:
        code = request.query_params.get("code")
        state = request.query_params.get("state")
        oauth_error = request.query_params.get("error")
        oauth_error_description = request.query_params.get("error_description")
        cookie_state = request.cookies.get("vercel_oauth_state")
        verifier = request.cookies.get("vercel_oauth_code_verifier")
        redirect_to = request.cookies.get("vercel_oauth_redirect_to") or "/"

        client_id = os.getenv("VERCEL_OAUTH_CLIENT_ID")
        client_secret = os.getenv("VERCEL_OAUTH_CLIENT_SECRET")
        if not client_id or not client_secret:
            raise RuntimeError("Vercel OAuth not configured")

        frontend_origin = request.cookies.get("vercel_oauth_frontend_origin")

        if oauth_error:
            msg = oauth_error_description or oauth_error
            redirect_abs = (
                f"{frontend_origin}{redirect_to}" if frontend_origin else redirect_to
            )
            resp = RedirectResponse(f"{redirect_abs}#auth_error={msg}", status_code=302)
            for key in (
                "vercel_oauth_state",
                "vercel_oauth_code_verifier",
                "vercel_oauth_redirect_to",
            ):
                resp.delete_cookie(key, path="/")
            resp.delete_cookie("vercel_oauth_frontend_origin", path="/")
            return resp

        if (
            not code
            or not state
            or not verifier
            or not cookie_state
            or state != cookie_state
        ):
            return Response(status_code=400)

        origin = _backend_origin(request)
        redirect_uri = f"{origin}/api/auth/callback/vercel"

        token_url = "https://vercel.com/api/login/oauth/token"
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_resp = await client.post(
                token_url,
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "code_verifier": verifier,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if token_resp.status_code >= 400:
                try:
                    err = token_resp.json()
                except Exception:
                    err = {"raw": token_resp.text}
                raise HTTPException(
                    status_code=token_resp.status_code,
                    detail={"provider": "vercel", "error": err},
                )
            token_data = token_resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                return Response(status_code=400)

            user_resp = await client.get(
                "https://api.vercel.com/v2/user",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            user_resp.raise_for_status()

        redirect_abs = f"{frontend_origin}{redirect_to}" if frontend_origin else redirect_to
        resp = RedirectResponse(redirect_abs, status_code=302)
        cookie_args = {
            "path": "/",
            "secure": _is_production(),
            "httponly": True,
            "samesite": "lax",
        }
        max_age = int(token_data.get("expires_in") or 3600)
        resp.set_cookie("session_token", access_token, max_age=max_age, **cookie_args)

        for key in (
            "vercel_oauth_state",
            "vercel_oauth_code_verifier",
            "vercel_oauth_redirect_to",
            "vercel_oauth_frontend_origin",
        ):
            resp.delete_cookie(key, path="/")
        return resp
    except Exception as e:
        logger.error(e)
        logger.error(traceback.format_exc())
        raise e


@router.get("/me")
async def auth_me(request: Request) -> dict[str, Any]:
    token = request.cookies.get("session_token")
    if not token:
        return {"authenticated": False}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            user_resp = await client.get(
                "https://api.vercel.com/v2/user",
                headers={"Authorization": f"Bearer {token}"},
            )
            user_resp.raise_for_status()
            raw = user_resp.json()
            user_data = raw.get("user") or raw

            avatar_hash = user_data.get("avatar")
            avatar_url = user_data.get("avatarUrl")
            if not avatar_url and avatar_hash and isinstance(avatar_hash, str):
                avatar_url = f"https://vercel.com/api/www/avatar/{avatar_hash}"

            billing = user_data.get("billing") or {}
            plan = billing.get("plan")
            account_type = plan.capitalize() if isinstance(plan, str) and plan else None

            normalized = {
                "id": str(user_data.get("id") or user_data.get("uid") or ""),
                "name": user_data.get("name"),
                "username": user_data.get("username"),
                "email": user_data.get("email"),
                "avatar": avatar_url,
                "accountType": account_type,
            }
            return {"authenticated": True, "user": normalized}
        except httpx.HTTPError:
            return {"authenticated": False}


@router.post("/logout")
async def auth_logout(request: Request) -> Response:
    token = request.cookies.get("session_token")
    client_id = os.getenv("VERCEL_OAUTH_CLIENT_ID")
    client_secret = os.getenv("VERCEL_OAUTH_CLIENT_SECRET")
    resp = JSONResponse({"ok": True})
    if token and client_id and client_secret:
        basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode(
            "ascii"
        )
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(
                    "https://vercel.com/api/login/oauth/token/revoke",
                    data={"token": token},
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": f"Basic {basic}",
                    },
                )
        except httpx.HTTPError:
            pass
    resp.delete_cookie("session_token", path="/")
    for key in (
        "vercel_oauth_state",
        "vercel_oauth_code_verifier",
        "vercel_oauth_redirect_to",
    ):
        resp.delete_cookie(key, path="/")
    return resp
