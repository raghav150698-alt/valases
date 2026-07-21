import unittest

from app.core.config import Settings


class CandidateCorsConfigTest(unittest.TestCase):
    def test_candidate_portal_origin_is_automatically_allowed(self) -> None:
        settings = Settings(
            _env_file=None,
            candidate_app_base_url="https://candidate.example.com/invite/",
            cors_allow_origins="https://admin.example.com",
        )

        self.assertEqual(
            settings.cors_origins_list,
            ["https://admin.example.com", "https://candidate.example.com"],
        )

    def test_duplicate_candidate_origin_is_removed(self) -> None:
        settings = Settings(
            _env_file=None,
            candidate_app_base_url="https://candidate.example.com/",
            cors_allow_origins="https://candidate.example.com/",
        )

        self.assertEqual(settings.cors_origins_list, ["https://candidate.example.com"])


if __name__ == "__main__":
    unittest.main()
