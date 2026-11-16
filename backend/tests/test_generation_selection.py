import unittest
from unittest.mock import patch

from routers.lectures import _selected_generation_components
from services.ai_generation import run_ai_generation_pipeline
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
