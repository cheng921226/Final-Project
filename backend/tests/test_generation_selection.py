import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from routers.lectures import _selected_generation_components
from services.ai_generation import generate_questions, run_ai_generation_pipeline
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
            {"question_text": "第一題", "options": ["A. 是", "B. 否"], "answer": "A", "source_timestamp": 30},
            {"question_text": "第二題", "options": ["A. 是", "B. 否"], "answer": "B", "source_timestamp": 58},
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
                [{"id": 3, "start_time": 0, "end_time": 30}],
            )

        rows = table.insert.call_args.args[0]
        self.assertEqual([row["source_timestamp"] for row in rows], [35, 59])
        self.assertEqual(rows[0]["knowledge_point_id"], 3)
        self.assertEqual(
            [question["source_timestamp"] for question in result["data"]["questions"]],
            [35, 59],
        )
