import base64
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException

from routers.ai import ChatImage, ChatRequest, ai_chat


PNG_DATA = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8"
    "/x8AAwMCAO+aQ1sAAAAASUVORK5CYII="
)


class ChatImageTests(unittest.TestCase):
    def test_attaches_image_to_model_request_and_saves_text_history(self):
        context = SimpleNamespace(profile={"id": 5, "role": "student"}, database=Mock())
        body = ChatRequest(
            lecture_id=2,
            question="請解釋這張圖。",
            image=ChatImage(mime_type="image/png", data=PNG_DATA),
        )

        with (
            patch("routers.ai.get_chat_context", return_value=[]),
            patch("routers.ai.get_lecture_transcript", return_value=[{"content": "逐字稿"}]),
            patch("routers.ai.get_lecture_knowledge_points", return_value=[]),
            patch("routers.ai.supabase_admin") as database,
            patch("routers.ai.generate_json_content", return_value=SimpleNamespace(text='{"answer":"圖片解說"}')) as generate,
        ):
            result = ai_chat(body, context)

        prompt, image = generate.call_args.args[0]
        self.assertIn("請解釋這張圖。", prompt)
        self.assertEqual(image.inline_data.mime_type, "image/png")
        self.assertEqual(image.inline_data.data, base64.b64decode(PNG_DATA))
        self.assertEqual(result["answer"], "圖片解說")
        record = database.table.return_value.insert.call_args.args[0]
        self.assertEqual(record["question"], body.question)
        self.assertNotIn("image", record)

    def test_rejects_an_image_that_does_not_match_its_mime_type(self):
        with self.assertRaises(HTTPException) as error:
            ChatImage(mime_type="image/jpeg", data=PNG_DATA).to_part()
        self.assertEqual(error.exception.status_code, 422)
