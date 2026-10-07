import unittest

from app.services.region_routing import choose_region, normalize_region, region_assignment_payload


class RegionRoutingTest(unittest.TestCase):
    def test_residency_has_priority(self):
        self.assertEqual(choose_region(company_country="in", residency_region="tokyo"), "tokyo")

    def test_country_defaults_are_used_when_no_preference_exists(self):
        self.assertEqual(choose_region(company_country="IN"), "mumbai")
        self.assertEqual(choose_region(company_country="jp"), "tokyo")

    def test_unknown_country_uses_deployment_default(self):
        self.assertEqual(choose_region(company_country="sg", default_region="mumbai"), "mumbai")

    def test_invalid_regions_are_rejected(self):
        self.assertIsNone(normalize_region("singapore"))

    def test_assignment_is_locked(self):
        self.assertEqual(
            region_assignment_payload(region="tokyo"),
            {"data_region": "tokyo", "region_assignment_source": "operator", "region_locked": True},
        )


if __name__ == "__main__":
    unittest.main()
