import os
import tempfile
from functools import lru_cache
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from database.supabase import supabase_admin


DEFAULT_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "tiny")
DEFAULT_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
DEFAULT_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")


@lru_cache(maxsize=2)
def get_whisper_model(model_size: str, device: str, compute_type: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "faster-whisper is not installed. Run: pip install faster-whisper"
        ) from exc

    return WhisperModel(model_size, device=device, compute_type=compute_type)


def transcribe_media(
    file_path: str,
    model_size: str = DEFAULT_MODEL_SIZE,
    language: str | None = None,
    word_timestamps: bool = False,
) -> dict[str, Any]:
    model = get_whisper_model(model_size, DEFAULT_DEVICE, DEFAULT_COMPUTE_TYPE)
    segments_iter, info = model.transcribe(
        file_path,
        language=language,
        vad_filter=True,
        word_timestamps=word_timestamps,
    )

    segments = []
    full_text_parts = []

    for segment in segments_iter:
        text = segment.text.strip()
        full_text_parts.append(text)

        item: dict[str, Any] = {
            "start_time": round(float(segment.start), 3),
            "end_time": round(float(segment.end), 3),
            "text": text,
        }

        if word_timestamps and segment.words:
            item["words"] = [
                {
                    "start_time": round(float(word.start), 3),
                    "end_time": round(float(word.end), 3),
                    "word": word.word.strip(),
                }
                for word in segment.words
            ]

        segments.append(item)

    return {
        "language": info.language,
        "language_probability": round(float(info.language_probability), 4),
        "duration": round(float(info.duration), 3) if info.duration else None,
        "text": " ".join(part for part in full_text_parts if part),
        "segments": segments,
    }


def download_youtube_audio(url: str, output_dir: str | None = None) -> dict[str, Any]:
    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:
        raise RuntimeError("yt-dlp is not installed. Run: pip install yt-dlp") from exc

    target_dir = output_dir or tempfile.mkdtemp(prefix="youtube_audio_")
    output_template = os.path.join(target_dir, "%(id)s.%(ext)s")
    clean_url = normalize_youtube_url(url)
    ydl_opts = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "outtmpl": output_template,
        "quiet": True,
        "no_warnings": True,
        "retries": 3,
        "fragment_retries": 3,
        "socket_timeout": 30,
        "http_chunk_size": 10 * 1024 * 1024,
        "continuedl": True,
    }

    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(clean_url, download=True)
        file_path = ydl.prepare_filename(info)

    return {
        "file_path": file_path,
        "title": info.get("title"),
        "webpage_url": info.get("webpage_url") or url,
        "duration": info.get("duration"),
    }


def normalize_youtube_url(url: str) -> str:
    parsed = urlparse(url)
    if "youtube.com" not in parsed.netloc:
        return url

    video_id = parse_qs(parsed.query).get("v", [None])[0]
    if not video_id:
        return url

    return urlunparse(
        (parsed.scheme, parsed.netloc, parsed.path, "", urlencode({"v": video_id}), "")
    )


def save_transcript_segments(
    lecture_id: int, segments: list[dict[str, Any]]
) -> dict[str, Any]:
    if not segments:
        return {
            "saved_to_db": False,
            "inserted": 0,
            "db_error": "No transcript segments",
        }

    content = " ".join(
        f"({format_timestamp(segment['start_time'])}) {segment['text']}"
        for segment in segments
        if segment["text"]
    )

    row = {
        "lecture_id": lecture_id,
        "content": content,
        "segments_json": segments,
    }

    try:
        response = supabase_admin.table("transcripts").insert(row).execute()
        return {
            "saved_to_db": True,
            "inserted": len(response.data or [row]),
            "db_error": None,
        }
    except Exception as exc:
        return {
            "saved_to_db": False,
            "inserted": 0,
            "db_error": str(exc),
        }


def format_timestamp(seconds: float) -> str:
    total_seconds = int(seconds)
    minutes, second = divmod(total_seconds, 60)
    hour, minute = divmod(minutes, 60)

    if hour:
        return f"{hour}:{minute:02d}:{second:02d}"

    return f"{minute}:{second:02d}"
