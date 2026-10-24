import unittest

from services.time_values import normalize_seconds, normalize_time_range, time_to_seconds


class TimeValuesTests(unittest.TestCase):
    def test_time_to_seconds_accepts_seconds_and_clock_formats(self):
        self.assertEqual(time_to_seconds(320), 320)
        self.assertEqual(time_to_seconds("05:20"), 320)
        self.assertEqual(time_to_seconds("01:05:20"), 3920)

    def test_normalize_seconds_rounds_and_rejects_invalid_values(self):
        self.assertEqual(normalize_seconds(12.6), 13)
        self.assertEqual(normalize_seconds("12.4"), 12)
        self.assertIsNone(normalize_seconds(-1))
        self.assertIsNone(normalize_seconds("not-a-time"))

    def test_normalize_time_range_corrects_reversed_values(self):
        self.assertEqual(normalize_time_range("01:30", "01:00"), (60, 90))


if __name__ == "__main__":
    unittest.main()
