"""Shared HTTP helper for API providers: retries, rate-limit backoff, JSON.

Error taxonomy:
  - 402 / 403  -> RestrictedError (plan/subscription limit). NOT retried; callers
                  should skip the item. Common on the FMP free tier for certain
                  symbols/endpoints.
  - 401        -> AuthError (bad/absent key). NOT retried; fix the key.
  - 429 / 5xx  -> transient. Retried with exponential backoff.
"""
from __future__ import annotations

import time
from typing import Any

import requests

_session = requests.Session()


class ProviderError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class AuthError(ProviderError):
    """401 -- the API key is missing or invalid."""


class RestrictedError(ProviderError):
    """402/403 -- valid key, but this data isn't on your current plan."""


def get_json(url: str, params: dict | None = None, *, retries: int = 3,
             timeout: int = 30) -> Any:
    """GET a URL and return parsed JSON.

    Non-retryable plan/auth errors raise immediately so callers can skip the
    item instead of blocking on futile retries.
    """
    params = params or {}
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            resp = _session.get(url, params=params, timeout=timeout)
            if resp.status_code == 401:
                raise AuthError(f"401 Unauthorized (check API key): {url}", 401)
            if resp.status_code in (402, 403):
                raise RestrictedError(
                    f"{resp.status_code} not available on your plan: {url}",
                    resp.status_code)
            if resp.status_code == 429:
                time.sleep(2 ** attempt * 5)
                continue
            resp.raise_for_status()
            return resp.json()
        except (AuthError, RestrictedError):
            raise  # non-retryable
        except requests.RequestException as e:
            last_err = e
            time.sleep(2 ** attempt)
    raise ProviderError(f"GET failed after {retries} retries: {url}") from last_err
