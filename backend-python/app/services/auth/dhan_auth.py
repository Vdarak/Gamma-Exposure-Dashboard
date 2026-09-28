"""
Dhan Access Token Manager with 12-Hour Rolling Renewal.

Dhan access tokens expire after 24 hours. This service renews the token
every 12 hours to maintain continuous API access for live options chain data.

Token lifecycle:
  1. Initial token is obtained manually from Dhan web portal and set as DHAN_ACCESS_TOKEN env var
  2. This service calls GET /v2/RenewToken with the current token to get a fresh one
  3. The new token is stored in the database and updated in-memory on the settings object
  4. If renewal fails (e.g., token already expired), the cold-start TOTP fallback can be used
"""
import httpx
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, text
from sqlalchemy.dialects.postgresql import insert

from app.config import settings

logger = logging.getLogger("gamma-exposure-backend.dhan-auth")


class DhanAuthManager:
    """
    Manages Dhan API access token lifecycle with rolling 12-hour renewal.
    """
    RENEW_URL = "https://api.dhan.co/v2/RenewToken"

    def __init__(self):
        self.client_id = settings.dhan_client_id
        self.access_token = settings.dhan_access_token

    async def validate_token(self) -> bool:
        """
        Quick health check — attempts a lightweight Dhan API call to verify
        the current access token is still valid.
        Returns True if valid, False if expired/invalid.
        """
        if not self.access_token or not self.client_id:
            logger.warning("Dhan credentials not configured (DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN empty)")
            return False

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Use the fund limits endpoint as a lightweight validation check
                response = await client.get(
                    "https://api.dhan.co/v2/fundlimit",
                    headers={
                        "access-token": self.access_token,
                        "Content-Type": "application/json",
                    },
                )
                if response.status_code == 200:
                    logger.info("✅ Dhan token is valid")
                    return True
                elif response.status_code == 401:
                    logger.warning("❌ Dhan token expired or invalid (HTTP 401)")
                    return False
                else:
                    logger.warning("⚠️ Dhan validation returned HTTP %d", response.status_code)
                    return False
        except Exception as e:
            logger.error("Error validating Dhan token: %s", str(e))
            return False

    async def renew_access_token(self) -> str | None:
        """
        Execute rolling token renewal via GET /v2/RenewToken.
        Must be invoked while the current token is still active (< 24 hours old).

        Returns:
            New access token string on success, None on failure.
        """
        if not self.access_token or not self.client_id:
            logger.error("Cannot renew: Dhan credentials not configured")
            return None

        headers = {
            "access-token": self.access_token,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(self.RENEW_URL, headers=headers)

            if response.status_code == 200:
                payload = response.json()
                new_token = payload.get("accessToken")
                expiry = payload.get("expiryTime")

                if not new_token:
                    logger.error("Token renewal response missing 'accessToken' field: %s", payload)
                    return None

                # Update in-memory settings
                self.access_token = new_token
                settings.dhan_access_token = new_token

                logger.info(
                    "✅ Dhan token successfully renewed. Expires: %s", expiry
                )
                return new_token
            else:
                logger.error(
                    "❌ Token renewal failed: HTTP %d — %s",
                    response.status_code,
                    response.text[:500],
                )
                return None

        except Exception as e:
            logger.error("Fatal error renewing Dhan token: %s", str(e))
            return None

    def get_current_token(self) -> str:
        """Return the current active access token."""
        return self.access_token

    def get_client_id(self) -> str:
        """Return the Dhan client ID."""
        return self.client_id
