import unittest
from utility_pack.slugify import slugify


class TestSlugify(unittest.TestCase):
    """Test slugify function."""

    def test_basic(self):
        self.assertEqual(slugify("Hello World"), "hello-world")

    def test_multiple_spaces(self):
        self.assertEqual(slugify("Hello   World"), "hello-world")

    def test_special_chars(self):
        self.assertEqual(slugify("Hello! World?"), "hello-world")

    def test_leading_trailing_hyphens_removed(self):
        self.assertEqual(slugify("--hello--"), "hello")

    def test_unicode_nfkd(self):
        self.assertEqual(slugify("Café"), "cafe")

    def test_already_slug(self):
        self.assertEqual(slugify("hello-world"), "hello-world")

    def test_numbers(self):
        self.assertEqual(slugify("Hello 2 World"), "hello-2-world")

    def test_only_special_chars(self):
        self.assertEqual(slugify("!!!"), "")

    def test_reject_non_string(self):
        with self.assertRaises(TypeError):
            slugify(123)