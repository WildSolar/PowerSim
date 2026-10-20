"""requests.get, patient with busy servers: the federal and cantonal map services answer 429 or
503 now and then (more so with several builds running at once), and usually fine a few seconds
later. Retries those, and dropped connections, with growing pauses; anything else — and the last
attempt — is returned or raised as requests.get would."""

from __future__ import annotations

import time

import requests

RETRY_STATUS = (429, 502, 503, 504)
ATTEMPTS = 5


def get(url: str, **kwargs) -> requests.Response:
    for attempt in range(ATTEMPTS):
        last = attempt == ATTEMPTS - 1
        try:
            response = requests.get(url, **kwargs)
        except (requests.ConnectionError, requests.Timeout):
            if last:
                raise
        else:
            if response.status_code not in RETRY_STATUS or last:
                return response
        time.sleep(5 * (attempt + 1))
    raise AssertionError("unreachable")
