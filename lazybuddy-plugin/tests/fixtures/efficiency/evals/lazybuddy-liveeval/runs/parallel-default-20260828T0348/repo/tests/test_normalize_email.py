import unittest
from utility_pack.normalize_email import normalize_email


class TestNormalizeEmail(unittest.TestCase):
    """Test normalize_email function."""

    def test_basic(self):
        self.assertEqual(normalize_email("User@Example.com"), "user@example.com")

    def test_whitespace_stripped(self):
        self.assertEqual(normalize_email("  Alice@Example.org  "), "alice@example.org")

    def test_already_normalized(self):
        self.assertEqual(normalize_email("test@test.com"), "test@test.com")

    def test_reject_no_at(self):
        with self.assertRaises(ValueError):
            normalize_email("userexample.com")

    def test_reject_multiple_at(self):
        with self.assertRaises(ValueError):
            normalize_email("a@b@c.com")

    def test_reject_empty_local(self):
        with self.assertRaises(ValueError):
            normalize_email("@example.com")

    def test_reject_empty_domain(self):
        with self.assertRaises(ValueError):
            normalize_email("user@")

    def test_reject_internal_whitespace(self):
        with self.assertRaises(ValueError):
            normalize_email("user @example.com")

    def test_reject_non_string(self):
        with self.assertRaises(TypeError):
            normalize_email(42)