import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from routers.lectures import _selected_generation_components
from services.ai_generation import (
    generate_knowledge_points,
    generate_question_group,
    generate_questions,
    run_ai_generation_pipeline,
)
from services.lecture_processing import GENERATION_COMPONENTS
from services.pipeline_runner import run_media_ai_pipeline


class GenerationSelectionTests(unittest.TestCase):
    def test_upload_selection_preserves_defaults_and_adds_transcript_when_needed(self):
        self.assertEqual(_selected_generation_components(False, ["summary"]), [])
        self.assertEqual(_selected_generation_components(True, []), [])
        self.assertEqual(
            _selected_generation_components(True, None), list(GENERATION_COMPONENTS)
        )
        self.assertEqual(
            _selected_generation_components(True, ["mindmap", "mindmap"]),
            ["transcript", "mindmap"],
        )

    def test_transcript_only_does_not_invoke_ai_generation(self):
        with (
            patch(
                "services.pipeline_runner.get_existing_transcript_segments",
                return_value=[{"start": 0, "end": 5, "text": "教材內容"}],
            ),
            patch("services.pipeline_runner.set_generation_status"),
            patch("services.pipeline_runner.run_ai_generation_pipeline") as generate,
        ):
            result = run_media_ai_pipeline(
                8, file_path=None, source="upload", components=["transcript"]
            )
        self.assertEqual(result["transcription"]["status"], "cached")
        self.assertEqual(result["ai_generation"], {})
        generate.assert_not_called()

    def test_ai_pipeline_runs_only_selected_steps(self):
        with (
            patch("services.ai_generation.claim_generation", return_value=True),
            patch("services.ai_generation.set_generation_status"),
            patch("services.ai_generation.generate_summary") as summary,
            patch("services.ai_generation.generate_knowledge_points") as knowledge,
            patch("services.ai_generation.generate_mindmap", return_value={"status": "success"}) as mindmap,
            patch("services.ai_generation.generate_questions") as questions,
        ):
            results = run_ai_generation_pipeline(
                8, [{"start": 0, "end": 5, "text": "教材內容"}], components=["mindmap"]
            )
        self.assertEqual(results, {"mindmap": {"status": "success"}})
        mindmap.assert_called_once()
        summary.assert_not_called()
        knowledge.assert_not_called()
        questions.assert_not_called()


    def test_generated_questions_add_five_seconds_and_stay_inside_video(self):
        ai_questions = [
            {"question_text": title, "options": ["一", "二", "三", "四"], "answer": "A",
             "source_timestamp": timestamp, "related_knowledge_point": point_id}
            for title, timestamp, point_id in [("第一題", 30, 3), ("第二題", 58, 4)]
        ]
        response = SimpleNamespace(text=json.dumps({"questions": ai_questions}))
        with (
            patch("services.ai_generation.existing_rows", return_value=[]),
            patch("services.ai_generation.generate_json_content", return_value=response),
            patch("services.ai_generation.supabase_admin") as database,
        ):
            table = database.table.return_value
            table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
                "duration_seconds": 60,
            }
            table.insert.return_value.execute.return_value.data = []
            result = generate_questions(
                8, "[0 - 30] 教材內容",
                [
                    {"id": 3, "start_time": 0, "end_time": 30},
                    {"id": 4, "start_time": 31, "end_time": 59},
                ],
            )

        rows = table.insert.call_args.args[0]
        self.assertEqual([row["source_timestamp"] for row in rows], [35, 59])
        self.assertEqual(rows[0]["knowledge_point_id"], 3)
        self.assertEqual(
            [question["source_timestamp"] for question in result["data"]["questions"]],
            [35, 59],
        )


    def test_knowledge_points_only_save_ranges_from_the_timed_transcript(self):
        points = [
            {"title": name, "description": "原則", "start_time": start, "end_time": end}
            for name, start, end in [
                ("正確區間", 0, 20),
                ("缺少結束時間", 0, None),
                ("未對齊", 1, 20),
                ("時間反向", 20, 8),
                ("超過片尾", 20, 40),
                ("空區間", 20, 20),
            ]
        ]
        segments = [
            {"text": "開始講解", "start_time": 0.1, "end_time": 8.2},
            {"text": "接續講解", "start_time": 8.2, "end_time": 20.1},
            {"text": "片尾", "start_time": 20.1, "end_time": 40},
        ]
        response = SimpleNamespace(text=json.dumps({"knowledge_points": points}))
        with (
            patch("services.ai_generation.existing_rows", return_value=[]),
            patch("services.ai_generation.generate_json_content", return_value=response) as generate,
            patch("services.ai_generation.supabase_admin") as database,
        ):
            table = database.table.return_value
            table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {
                "duration_seconds": 30,
            }
            table.insert.return_value.execute.return_value.data = []
            result = generate_knowledge_points(8, segments)

        self.assertEqual(result["data"]["knowledge_points"], [points[0]])
        table.insert.assert_called_once_with([{"lecture_id": 8, **points[0]}])
        self.assertIn("[0 - 8] 開始講解", generate.call_args.args[0])
        self.assertNotIn("[20 - 40]", generate.call_args.args[0])

    def test_knowledge_points_without_timestamps_do_not_call_ai_or_insert(self):
        with (
            patch("services.ai_generation.existing_rows", return_value=[]),
            patch("services.ai_generation.generate_json_content") as generate,
            patch("services.ai_generation.supabase_admin") as database,
        ):
            table = database.table.return_value
            table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {}
            with self.assertRaisesRegex(ValueError, "逐字稿沒有可定位"):
                generate_knowledge_points(8, [{"text": "沒有時間的內容"}])

        generate.assert_not_called()
        table.insert.assert_not_called()


    def test_question_group_caps_each_point_and_reports_explicit_skips(self):
        questions = [
            {
                "question_text": f"題目 {index}", "options": ["一", "二", "三", "四"],
                "answer": "A", "source_timestamp": 10, "related_knowledge_point": 1,
            }
            for index in range(3)
        ]
        skipped = [{"id": 2, "reason": "逐字稿裡只提到名詞，沒有講解"}]
        response = SimpleNamespace(
            text=json.dumps({"questions": questions, "skipped_knowledge_points": skipped})
        )
        with patch("services.ai_generation.generate_json_content", return_value=response):
            generated, reported_skips = generate_question_group("教材內容", [{"id": 1}, {"id": 2}])
            self.assertEqual(len(generated), 2)
            self.assertEqual(reported_skips, skipped)
            with self.assertRaisesRegex(RuntimeError, "AI 未處理以下知識點：3"):
                generate_question_group("教材內容", [{"id": 1}, {"id": 2}, {"id": 3}])

    def test_question_generation_groups_long_videos_without_splitting_the_saved_batch(self):
        points = [
            {"id": index, "start_time": index * 60, "end_time": index * 60 + 30}
            for index in range(1, 11)
        ]
        segments = [
            {"start_time": point["start_time"], "end_time": point["end_time"], "text": f"段落 {point['id']}。"}
            for point in points
        ]

        def questions_for_group(_transcript, group):
            return ([
                {"question_text": f"課堂題 {point['id']}", "options": ["一", "二", "三", "四"],
                 "answer": "A", "source_timestamp": point["end_time"],
                 "related_knowledge_point": point["id"]}
                for point in group
            ], [])

        with (
            patch("services.ai_generation.generate_question_group", side_effect=questions_for_group) as generate,
            patch("services.ai_generation.supabase_admin") as database,
        ):
            table = database.table.return_value
            table.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = {}
            table.insert.return_value.execute.return_value.data = []
            generate_questions(8, "完整逐字稿", points, skip_existing=False, segments=segments)

        self.assertEqual([len(call.args[1]) for call in generate.call_args_list], [8, 2])
        self.assertNotIn("段落 9。", generate.call_args_list[0].args[0])
        self.assertIn("段落 9。", generate.call_args_list[1].args[0])
        table.insert.assert_called_once()
        rows = table.insert.call_args.args[0]
        self.assertEqual(len(rows), 10)
        self.assertEqual(len({row["generation_batch_id"] for row in rows}), 1)
