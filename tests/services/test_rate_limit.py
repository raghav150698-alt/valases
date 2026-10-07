import asyncio
import unittest

from app.core.rate_limit import LimitRule, ResilientRateLimiter


class ResilientRateLimiterTest(unittest.TestCase):
    def test_unconfigured_redis_uses_local_limiter(self) -> None:
        limiter = ResilientRateLimiter(enabled=False)
        rule = LimitRule(max_requests=2, window_seconds=60)

        first = asyncio.run(limiter.allow("candidate:api", rule))
        second = asyncio.run(limiter.allow("candidate:api", rule))
        third = asyncio.run(limiter.allow("candidate:api", rule))

        self.assertEqual(first, (True, 0))
        self.assertEqual(second, (True, 0))
        self.assertFalse(third[0])
        self.assertGreaterEqual(third[1], 1)
        self.assertEqual(limiter.status(), "not_configured")


if __name__ == "__main__":
    unittest.main()
