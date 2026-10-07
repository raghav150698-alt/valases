import unittest
from scripts.analyze_english_pilot import analyse


class EnglishPilotTest(unittest.TestCase):
    def row(self, code, role, recording, region="US", failed="0"):
        return dict(participant_code=code, region=region, role_group=role, conversation_id=recording,
                    listening_score_pct="50", reading_score_pct="75", listening_minutes="8",
                    reading_minutes="12", writing_minutes="14", speaking_minutes="10",
                    audio_failed=failed, microphone_failed="0", resume_failed="0", feedback="")

    def test_groups_across_roles_recordings_and_regions_without_calibration_claims(self):
        report = analyse([self.row("a", "engineering", "first"), self.row("b", "sales", "second", failed="1"), self.row("c", "operations", "third", region="UK")])
        self.assertEqual(report["participants"], 3)
        self.assertEqual(len(report["groups"]["role_group"]), 3)
        self.assertEqual(report["groups"]["region"]["US"]["failures"]["audio_failed"], 1)
        self.assertEqual(report["calibration_status"], "Not calibrated")
        self.assertEqual(report["groups"]["region"]["UK"]["means"]["reading_score_pct"], 75)

    def test_rejects_invalid_regions_and_duplicate_participants(self):
        with self.assertRaises(ValueError):
            analyse([self.row("a", "sales", "one", region="CA")])
        with self.assertRaises(ValueError):
            analyse([self.row("a", "sales", "one"), self.row("a", "sales", "two")])

    def test_empty_pilot_is_reported_as_empty(self):
        self.assertEqual(analyse([])["participants"], 0)

if __name__ == "__main__":
    unittest.main()
