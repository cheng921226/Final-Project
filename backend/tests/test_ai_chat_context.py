import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from routers.ai import ChatRequest, ai_chat
from services.chat_context import MAX_CHAT_TRANSCRIPT_CHARS, build_chat_material


def point(title, start, end):
    return {"title": title, "description": f"{title}說明", "start_time": start, "end_time": end}


def segment(text, start, end):
    return {"text": text, "start_time": start, "end_time": end}


class ChatContextTests(unittest.TestCase):
    def test_sorts_points_and_includes_only_current_and_immediate_neighbors(self):
        points = [point("D", 300, 390), point("B", 100, 190),
                  point("A", 0, 90), point("E", 400, 490), point("C", 200, 290)]
        segments = [segment(f"{title}逐字稿", start + 10, start + 20)
                    for title, start in [("A", 0), ("B", 100), ("C", 200), ("D", 300), ("E", 400)]]
        # This segment starts before B, but overlaps it and must be included once.
        overlap = segment("跨區間講解", 95, 205)
        result = build_chat_material(segments + [overlap, overlap], "影片開頭", points, 240)
        self.assertIn("目前對應知識點：C", result)
        self.assertIn("前一個知識點（補充參考）：B", result)
        self.assertIn("後一個知識點（補充參考）：D", result)
        for title in ("B", "C", "D"):
            self.assertIn(f"{title}逐字稿", result)
        self.assertNotIn("A逐字稿", result)
        self.assertNotIn("E逐字稿", result)
        self.assertNotIn("影片開頭", result)
        self.assertEqual(result.count("跨區間講解"), 1)

    def test_gap_uses_nearest_interval_and_reports_that_it_is_not_current(self):
        points = [point("A", 0, 10), point("B", 100, 120), point("C", 200, 220)]
        result = build_chat_material([segment("B內容", 101, 110)], "", points, 95)
        self.assertIn("最近知識點（播放位置位於知識點區間外）：B", result)

    def test_shared_boundary_chooses_new_point_and_does_not_wrap_neighbors(self):
        points = [point("A", 0, 100), point("B", 100, 200), point("C", 200, 300)]
        segments = [segment("內容", 105, 110)]
        self.assertIn("目前對應知識點：B", build_chat_material(segments, "", points, 100))
        first = build_chat_material(segments, "", points, 0)
        self.assertNotIn("前一個知識點", first)
        self.assertNotIn("後一個知識點（補充參考）：C", first)
        last = build_chat_material(segments, "", points, 299)
        self.assertNotIn("後一個知識點", last)

    def test_missing_point_times_use_overlapping_transcript_then_nearest(self):
        points = [point("無時間", None, None), point("錯誤時間", "bad", 80)]
        segments = [{"start": "01:00", "end": "04:00", "text": "較長的講解"},
                    segment("重複時間格式", float("nan"), 300)]
        result = build_chat_material(segments, "", points, 200)
        self.assertIn("較長的講解", result)
        self.assertIn("前後 60 秒", result)
        far = build_chat_material(segments, "", points, 800)
        self.assertIn("時間上最近的片段", far)
        self.assertIn("較長的講解", far)

    def test_missing_transcript_in_selected_ranges_does_not_use_video_opening(self):
        result = build_chat_material(
            [segment("影片開頭", 0, 10)], "影片開頭",
            [point("A", 200, 250), point("B", 300, 350)], 220,
        )
        self.assertIn("所選知識點區間沒有對應的逐字稿", result)
        self.assertNotIn("影片開頭", result)

    def test_character_budget_prioritizes_current_point_and_handles_legacy_text(self):
        points = [point("前", 0, 90), point("目前", 100, 190), point("後", 200, 290)]
        result = build_chat_material([
            segment("前" * MAX_CHAT_TRANSCRIPT_CHARS, 10, 20),
            segment("重點", 120, 130),
            segment("後文", 220, 230),
        ], "", points, 125)
        self.assertIn("重點", result)
        self.assertIn("長度限制", result)
        excerpt = result.split("所選區間逐字稿：\n")[1]
        self.assertLessEqual(len(excerpt), MAX_CHAT_TRANSCRIPT_CHARS)
        legacy = build_chat_material([], "舊" * 9000, [], 100)
        self.assertIn("缺少可定位的時間片段", legacy)
        self.assertEqual(len(legacy.split("未定位逐字稿：\n")[1]), MAX_CHAT_TRANSCRIPT_CHARS)

    def test_chat_route_uses_selection_keeps_point_overview_and_text_history(self):
        points = [point("堆疊", 100, 200), point("佇列", 300, 400)]
        context = SimpleNamespace(profile={"id": 5, "role": "student"}, database=Mock())
        with (
            patch("routers.ai.get_chat_context", return_value=[{"role": "user", "content": "先前問題"}]) as history,
            patch("routers.ai.get_lecture_transcript", return_value=[{
                "content": "不相關的開頭",
                "segments_json": [segment("不相關的開頭", 0, 10), segment("堆疊講解", 110, 180)],
            }]),
            patch("routers.ai.get_lecture_knowledge_points", return_value=points),
            patch("routers.ai.generate_json_content", return_value=SimpleNamespace(text='{"answer":"回答"}')) as generate,
            patch("routers.ai.supabase_admin"),
        ):
            result = ai_chat(ChatRequest(lecture_id=2, question="為什麼？", video_timestamp=150), context)
        prompt = generate.call_args.args[0]
        self.assertIn("目前對應知識點：堆疊", prompt)
        self.assertIn("佇列說明", prompt)
        self.assertIn("先前問題", prompt)
        self.assertNotIn("不相關的開頭", prompt)
        self.assertNotIn("完整逐字稿備用參考", prompt)
        self.assertEqual(history.call_args.kwargs["limit"], 6)
        self.assertEqual(result["answer"], "回答")
