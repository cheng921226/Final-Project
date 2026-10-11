import tempfile
import unittest
from pathlib import Path

from services.transcription import (
    calculate_file_sha256,
    extract_youtube_video_id,
    normalize_youtube_url,
)


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
            self.assertEqual(
                calculate_file_sha256(first), calculate_file_sha256(second)
            )


if __name__ == "__main__":
    unittest.main()
