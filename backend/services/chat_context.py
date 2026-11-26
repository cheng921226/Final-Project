from services.time_values import time_to_seconds


MAX_CHAT_TRANSCRIPT_CHARS = 8000


def interval_distance(timestamp, start, end):
    return max(start - timestamp, timestamp - end, 0)


def build_chat_material(segments, transcript_text, knowledge_points, timestamp):
    """Locate a knowledge point and its neighbors, keeping each transcript segment once."""
    timestamp = time_to_seconds(timestamp) or 0
    points = []
    for point in knowledge_points:
        start = time_to_seconds(point.get("start_time"))
        end = time_to_seconds(point.get("end_time"))
        if start is not None and end is not None and end > start:
            points.append((start, end, point))
    points.sort(key=lambda item: (item[0], item[1]))

    timed_segments = set()
    for segment in segments:
        start = time_to_seconds(segment.get("start_time", segment.get("start")))
        end = time_to_seconds(segment.get("end_time", segment.get("end")))
        text = segment.get("text")
        if start is None or not isinstance(text, str) or not text.strip():
            continue
        if end is None:
            end = start
        if end >= start:
            timed_segments.add((start, end, text.strip()))

    if points:
        index = min(
            range(len(points)),
            key=lambda i: (
                interval_distance(timestamp, points[i][0], points[i][1]),
                points[i][0] > timestamp,
                -points[i][0],
            ),
        )
        start, end, point = points[index]
        located = start <= timestamp <= end
        label = "目前對應知識點" if located else "最近知識點（播放位置位於知識點區間外）"
        details = [f"{label}：{point.get('title', '')}（{start:g}–{end:g} 秒）"]
        selected = points[max(0, index - 1):index + 2]
        for position, label in ((index - 1, "前一個知識點"), (index + 1, "後一個知識點")):
            if 0 <= position < len(points):
                left, right, neighbor = points[position]
                details.append(f"{label}（補充參考）：{neighbor.get('title', '')}（{left:g}–{right:g} 秒）")
        ranges = [(left, right) for left, right, _ in selected]
        candidates = [
            segment for segment in timed_segments
            if any(segment[0] <= right and segment[1] >= left for left, right in ranges)
        ]
        # Keep current-point material first when long neighboring ranges exceed the budget.
        candidates.sort(key=lambda segment: (
            not (segment[0] <= end and segment[1] >= start),
            interval_distance(timestamp, segment[0], segment[1]),
            segment[0], segment[1], segment[2],
        ))
    else:
        details = ["本節沒有有效的知識點時間區間，改用播放位置前後 60 秒的逐字稿。"]
        candidates = [
            segment for segment in timed_segments
            if segment[0] <= timestamp + 60 and segment[1] >= max(0, timestamp - 60)
        ]
        if not candidates and timed_segments:
            candidates = [min(timed_segments, key=lambda segment: (
                interval_distance(timestamp, segment[0], segment[1]),
                segment[0], segment[1], segment[2],
            ))]
            details.append("附近沒有轉錄片段，以下是時間上最近的片段，可能與目前畫面不同。")
        candidates.sort(key=lambda segment: (
            interval_distance(timestamp, segment[0], segment[1]),
            segment[0], segment[1], segment[2],
        ))

    if not timed_segments:
        details.append("逐字稿缺少可定位的時間片段，以下文字無法對應目前播放位置。")
        excerpt = transcript_text[:MAX_CHAT_TRANSCRIPT_CHARS]
        if len(transcript_text) > len(excerpt):
            details.append("課程文字因長度限制已截短。")
        return "\n".join(details) + "\n\n未定位逐字稿：\n" + excerpt

    remaining = MAX_CHAT_TRANSCRIPT_CHARS
    excerpts = []
    truncated = False
    for start, end, text in candidates:
        line = f"[{start:g}–{end:g} 秒] {text}"
        if len(line) + 1 > remaining:
            truncated = True
            # Only include a partial segment if there is room for its timestamp and text.
            if remaining > 80:
                excerpts.append((start, end, line[:remaining - 2] + "…"))
            break
        excerpts.append((start, end, line))
        remaining -= len(line) + 1
    if truncated:
        details.append("逐字稿因長度限制已節錄，優先保留目前位置相關片段。")
    excerpt = "\n".join(line for _, _, line in sorted(excerpts))
    if not excerpt:
        excerpt = "（所選知識點區間沒有對應的逐字稿，請依知識點說明回答，資料不足時請學生補充。）"
    return "\n".join(details) + "\n\n所選區間逐字稿：\n" + excerpt
