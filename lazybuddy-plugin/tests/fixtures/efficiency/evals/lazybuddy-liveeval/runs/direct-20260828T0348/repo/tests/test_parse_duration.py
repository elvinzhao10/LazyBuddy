import unittest
from duration_parser.parse_duration import parse_duration


class TestParseDuration(unittest.TestCase):
    """Test the parse_duration function."""

    def test_zero_ms(self):
        self.assertEqual(parse_duration("0ms"), 0)

    def test_250ms(self):
        self.assertEqual(parse_duration("250ms"), 250)

    def test_2s(self):
        self.assertEqual(parse_duration("2s"), 2000)

    def test_3m(self):
        self.assertEqual(parse_duration("3m"), 180000)

    def test_1h(self):
        self.assertEqual(parse_duration("1h"), 3600000)

    def test_outer_whitespace(self):
        self.assertEqual(parse_duration(" 2s "), 2000)

    def test_reject_empty_string(self):
        with self.assertRaises((ValueError, TypeError)):
            parse_duration("")

    def test_reject_missing_units(self):
        with self.assertRaises((ValueError, TypeError)):
            parse_duration("42")

    def test_reject_negative_values(self):
        with self.assertRaises((ValueError, TypeError)):
            parse_duration("-5s")

    def test_reject_decimal_values(self):
        with self.assertRaises((ValueError, TypeError)):
            parse_duration("1.5s")

    def test_reject_internal_whitespace(self):
        with self.assertRaises((ValueError, TypeError)):
            parse_duration("1 s")

    def test_reject_unknown_units(self):
        with self.assertRaises((ValueError, TypeError)):
            parse_duration("2d")

    def test_reject_non_string_inputs(self):
        with self.assertRaises((ValueError, TypeError)):
            parse_duration(123)