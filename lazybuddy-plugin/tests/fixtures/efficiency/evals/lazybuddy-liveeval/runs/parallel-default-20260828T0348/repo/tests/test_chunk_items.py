import unittest
from utility_pack.chunk_items import chunk_items


class TestChunkItems(unittest.TestCase):
    """Test chunk_items function."""

    def test_exact_chunks(self):
        result = chunk_items([1, 2, 3, 4], 2)
        self.assertEqual(result, [[1, 2], [3, 4]])

    def test_final_partial(self):
        result = chunk_items([1, 2, 3, 4, 5], 2)
        self.assertEqual(result, [[1, 2], [3, 4], [5]])

    def test_single_chunk(self):
        result = chunk_items([1, 2, 3], 5)
        self.assertEqual(result, [[1, 2, 3]])

    def test_order_preserved(self):
        result = chunk_items(["a", "b", "c", "d"], 3)
        self.assertEqual(result, [["a", "b", "c"], ["d"]])

    def test_does_not_mutate_input(self):
        original = [1, 2, 3, 4]
        chunk_items(original, 2)
        self.assertEqual(original, [1, 2, 3, 4])

    def test_reject_non_list(self):
        with self.assertRaises(TypeError):
            chunk_items("not a list", 2)

    def test_reject_zero_size(self):
        with self.assertRaises(ValueError):
            chunk_items([1, 2], 0)

    def test_reject_negative_size(self):
        with self.assertRaises(ValueError):
            chunk_items([1, 2], -1)

    def test_reject_non_int_size(self):
        with self.assertRaises(TypeError):
            chunk_items([1, 2], 2.5)