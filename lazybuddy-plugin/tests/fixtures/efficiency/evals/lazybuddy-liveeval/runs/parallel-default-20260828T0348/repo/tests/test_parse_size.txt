import unittest
from utility_pack.parse_size import parse_size


class TestParseSize(unittest.TestCase):
    """Test parse_size function."""

    def test_bytes(self):
        self.assertEqual(parse_size("100B"), 100)

    def test_kb(self):
        self.assertEqual(parse_size("1KB"), 1024)

    def test_mb(self):
        self.assertEqual(parse_size("1MB"), 1048576)

    def test_gb(self):
        self.assertEqual(parse_size("1GB"), 1073741824)

    def test_case_insensitive(self):
        self.assertEqual(parse_size("1kb"), 1024)

    def test_outer_whitespace(self):
        self.assertEqual(parse_size("  2MB  "), 2097152)

    def test_reject_negative(self):
        with self.assertRaises(ValueError):
            parse_size("-1KB")

    def test_reject_decimal(self):
        with self.assertRaises(ValueError):
            parse_size("1.5MB")

    def test_reject_missing_unit(self):
        with self.assertRaises(ValueError):
            parse_size("42")

    def test_reject_internal_whitespace(self):
        with self.assertRaises(ValueError):
            parse_size("1 KB")

    def test_reject_unknown_unit(self):
        with self.assertRaises(ValueError):
            parse_size("1TB")

    def test_reject_non_string(self):
        with self.assertRaises(TypeError):
            parse_size(100)