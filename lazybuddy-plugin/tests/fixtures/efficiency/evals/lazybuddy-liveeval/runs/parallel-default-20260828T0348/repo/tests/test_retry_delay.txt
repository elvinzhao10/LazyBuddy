import unittest
from utility_pack.retry_delay import retry_delay


class TestRetryDelay(unittest.TestCase):
    """Test retry_delay function."""

    def test_attempt_zero(self):
        self.assertEqual(retry_delay(0), 0.25)

    def test_attempt_one(self):
        self.assertEqual(retry_delay(1), 0.5)

    def test_attempt_two(self):
        self.assertEqual(retry_delay(2), 1.0)

    def test_attempt_three(self):
        self.assertEqual(retry_delay(3), 2.0)

    def test_capped(self):
        self.assertAlmostEqual(retry_delay(10), 8.0)

    def test_custom_base(self):
        self.assertEqual(retry_delay(0, base=1.0), 1.0)

    def test_custom_cap(self):
        self.assertEqual(retry_delay(5, base=0.1, cap=2.0), 2.0)

    def test_reject_negative_attempt(self):
        with self.assertRaises(ValueError):
            retry_delay(-1)

    def test_reject_float_attempt(self):
        with self.assertRaises(TypeError):
            retry_delay(1.5)

    def test_reject_bool_attempt(self):
        with self.assertRaises(TypeError):
            retry_delay(True)

    def test_reject_base_zero(self):
        with self.assertRaises(ValueError):
            retry_delay(0, base=0.0)

    def test_reject_base_gt_cap(self):
        with self.assertRaises(ValueError):
            retry_delay(0, base=10.0, cap=5.0)