import os
import shutil
import tempfile
import hashlib
import time
from functools import lru_cache
from typing import Any
from urllib.parse import parse_qs, urlparse

from database.supabase import supabase_admin


DEFAULT_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "tiny")
DEFAULT_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
DEFAULT_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")


def calculate_file_sha256(file_path: str, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as source:
        while chunk := source.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


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
        from yt_dlp.utils import DownloadError
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
        "extractor_retries": 3,
        "file_access_retries": 3,
        "fragment_retries": 3,
        "socket_timeout": 30,
        "http_chunk_size": 10 * 1024 * 1024,
        "continuedl": True,
    }
    node_path = shutil.which("node")
    if node_path:
        # YouTube now requires JavaScript challenge solving for many media URLs.
        ydl_opts["js_runtimes"] = {"node": {"path": node_path}}

    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(clean_url, download=True)
        file_path = ydl.prepare_filename(info)

    return {
        "file_path": file_path,
        "title": info.get("title"),
        "webpage_url": info.get("webpage_url") or url,
        "duration": info.get("duration"),
    }


def get_youtube_metadata(url: str) -> dict[str, Any]:
    """Read YouTube metadata without downloading the media."""
    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:
        raise RuntimeError("yt-dlp is not installed. Run: pip install yt-dlp") from exc

    clean_url = normalize_youtube_url(url)
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "socket_timeout": 20,
    }
    node_path = shutil.which("node")
    if node_path:
        options["js_runtimes"] = {"node": {"path": node_path}}
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(clean_url, download=False)

    return {
        "title": info.get("title"),
        "webpage_url": info.get("webpage_url") or url,
        "duration": round(float(info["duration"])) if info.get("duration") else None,
        "video_id": info.get("id") or extract_youtube_video_id(url),
    }


def download_youtube_video(url: str, output_dir: str | None = None) -> dict[str, Any]:
    """Download a normal, accessible YouTube video without bypassing access controls."""
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError
    except ImportError as exc:
        raise RuntimeError("yt-dlp is not installed. Run: pip install yt-dlp") from exc

    target_dir = output_dir or tempfile.mkdtemp(prefix="youtube_video_")
    clean_url = normalize_youtube_url(url)
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        try:
            import imageio_ffmpeg

            ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
        except (ImportError, RuntimeError):
            ffmpeg_path = None
    if not ffmpeg_path:
        raise RuntimeError(
            "影片備份需要 FFmpeg 合併 YouTube 的影像與音訊。"
            "請執行 pip install -r requirements.txt 後再試一次。"
        )
    options = {
        # Most YouTube videos expose video and audio as separate streams.
        # Prefer MP4/M4A, then allow yt-dlp to choose any mergeable pair.
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
        "noplaylist": True,
        "outtmpl": os.path.join(target_dir, "%(id)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "retries": 3,
        "fragment_retries": 3,
        "socket_timeout": 30,
        "continuedl": True,
        "max_filesize": int(
            os.getenv("VIDEO_BACKUP_MAX_BYTES", str(2 * 1024**3))
        ),
    }
    options["merge_output_format"] = "mp4"
    options["ffmpeg_location"] = ffmpeg_path
    node_path = shutil.which("node")
    if node_path:
        options["js_runtimes"] = {"node": {"path": node_path}}

    download_attempts = max(1, int(os.getenv("YOUTUBE_DOWNLOAD_ATTEMPTS", "3")))
    last_error: Exception | None = None
    for attempt in range(download_attempts):
        try:
            with YoutubeDL(options) as ydl:
                info = ydl.extract_info(clean_url, download=True)
                requested = info.get("requested_downloads") or []
                candidates = [
                    item.get("filepath") for item in requested if item.get("filepath")
                ]
                candidates.extend(
                    os.path.join(target_dir, name) for name in os.listdir(target_dir)
                )
                file_path = next(
                    (path for path in candidates if path and os.path.isfile(path)),
                    ydl.prepare_filename(info),
                )
            break
        except DownloadError as exc:
            last_error = exc
            if attempt + 1 >= download_attempts:
                raise
            shutil.rmtree(target_dir, ignore_errors=True)
            os.makedirs(target_dir, exist_ok=True)
            time.sleep(attempt + 1)
    else:
        raise RuntimeError("Unable to download YouTube video") from last_error

    return {
        "file_path": file_path,
        "title": info.get("title"),
        "webpage_url": info.get("webpage_url") or url,
        "duration": info.get("duration"),
        "video_id": info.get("id") or extract_youtube_video_id(url),
    }


def save_lecture_duration(lecture_id: int, duration: float | int | None) -> int | None:
    if duration is None:
        return None
    duration_seconds = max(0, round(float(duration)))
    response = (
        supabase_admin.table("lectures")
        .update({"duration_seconds": duration_seconds})
        .eq("id", lecture_id)
        .execute()
    )
    if not response.data:
        raise RuntimeError("Lecture duration save failed")
    return duration_seconds


def normalize_youtube_url(url: str) -> str:
    video_id = extract_youtube_video_id(url)
    if not video_id:
        return url
    return f"https://www.youtube.com/watch?v={video_id}"


def extract_youtube_video_id(url: str) -> str | None:
    if not url:
        return None
    raw = str(url).strip()
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = parsed.netloc.lower().split(":")[0]
    if host.startswith("www."):
        host = host[4:]

    video_id: str | None = None
    if host == "youtu.be":
        video_id = next((part for part in parsed.path.split("/") if part), None)
    elif host in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
        video_id = parse_qs(parsed.query).get("v", [None])[0]
        if not video_id:
            parts = [part for part in parsed.path.split("/") if part]
            if len(parts) >= 2 and parts[0] in {"embed", "shorts", "live"}:
                video_id = parts[1]

    if not video_id:
        return None
    normalized = "".join(ch for ch in video_id if ch.isalnum() or ch in "-_")
    return normalized if len(normalized) == 11 else None


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
        response = (
            supabase_admin.table("transcripts")
            .upsert(row, on_conflict="lecture_id")
            .execute()
        )
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
