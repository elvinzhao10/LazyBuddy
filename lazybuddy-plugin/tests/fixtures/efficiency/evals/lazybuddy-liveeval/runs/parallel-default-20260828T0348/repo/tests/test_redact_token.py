import unittest
from utility_pack.redact_token import redact_token


class TestRedactToken(unittest.TestCase):
    """Test redact_token function."""

    def test_redact_sk(self):
        result = redact_token("sk-abc123def456ghi789jkl")
        self.assertEqual(result, "[REDACTED]")

    def test_redact_ghp(self):
        result = redact_token("ghp_abc123def456ghi789jklmno")
        self.assertEqual(result, "[REDACTED]")

    def test_redact_bearer(self):
        result = redact_token("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNqP")
        self.assertEqual(result, "[REDACTED]")

    def test_preserve_surrounding_text(self):
        result = redact_token("API key: sk-abc123def456ghi789jkl, sent")
        self.assertEqual(result, "API key: [REDACTED], sent")

    def test_no_token(self):
        result = redact_token("hello world")
        self.assertEqual(result, "hello world")

    def test_reject_non_string(self):
        with self.assertRaises(TypeError):
            redact_token(True)