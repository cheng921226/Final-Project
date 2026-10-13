import tempfile
import unittest
from pathlib import Path

from services.transcription import (
    calculate_file_sha256,
    extract_youtube_video_id,
    normalize_youtube_url,
)
from services.video_backup import safe_storage_filename, safe_storage_key_part


class YoutubeUtilityTests(unittest.TestCase):
    def test_common_urls_share_the_same_video_id(self):
        urls = [
            "https://www.youtube.com/watch?v=JSKtJqj2pwc",
            "https://youtu.be/JSKtJqj2pwc?t=120",
            "https://www.youtube.com/embed/JSKtJqj2pwc",
            "https://www.youtube.com/shorts/JSKtJqj2pwc",
        ]
        self.assertEqual(
            {extract_youtube_video_id(url) for url in urls},
            {"JSKtJqj2pwc"},
        )
        self.assertEqual(
            normalize_youtube_url(urls[1]),
            "https://www.youtube.com/watch?v=JSKtJqj2pwc",
        )

    def test_non_youtube_url_is_not_treated_as_youtube(self):
        self.assertIsNone(extract_youtube_video_id("https://example.com/video.mp4"))

    def test_file_hash_uses_file_content(self):
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "first.mp4"
            second = Path(directory) / "renamed.mp4"
            first.write_bytes(b"same video bytes")
            second.write_bytes(b"same video bytes")
            self.assertEqual(calculate_file_sha256(first), calculate_file_sha256(second))

    def test_backup_filename_keeps_names_and_removes_path_characters(self):
        self.assertEqual(
            safe_storage_filename('演算法／第一章: 搜尋?*', "未命名"),
            "演算法-第一章-搜尋",
        )

    def test_backup_filename_uses_fallback_for_blank_names(self):
        self.assertEqual(safe_storage_filename("  ", "小節-48"), "小節-48")

    def test_backup_storage_key_is_ascii_only(self):
        self.assertEqual(
            safe_storage_key_part("1-1-2 重點摘要", "lecture-52"),
            "1-1-2",
        )
        self.assertEqual(
            safe_storage_key_part("完全中文", "lecture-52"),
            "lecture-52",
        )


if __name__ == "__main__":
    unittest.main()
