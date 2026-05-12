import json
from pathlib import Path

BASE_DIR = Path(__file__).parent

TRANSCRIPT_FILE = BASE_DIR / "sample_transcript.txt"

OUTPUT_LEARNING_FILE = BASE_DIR / "auto_learning_content.json"
OUTPUT_MIND_MAP_FILE = BASE_DIR / "auto_mind_map.json"
OUTPUT_CHAT_FILE = BASE_DIR / "auto_chat_test.json"


def load_transcript():
    if not TRANSCRIPT_FILE.exists():
        raise FileNotFoundError("找不到 sample_transcript.txt")

    return TRANSCRIPT_FILE.read_text(encoding="utf-8")


def save_json(data, output_file):
    output_file.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"已產生：{output_file.name}")


def generate_learning_content(transcript):
    return {
        "summary": "本課程介紹人工智慧、機器學習與深度學習的基本關係。人工智慧是最大的概念，機器學習是其中一種方法，而深度學習則是機器學習中的分支。",
        "knowledge_points": [
            {
                "title": "人工智慧的概念",
                "description": "人工智慧是讓電腦或機器模仿人類智慧的技術。",
                "start_time": None,
                "end_time": None
            },
            {
                "title": "機器學習的概念",
                "description": "機器學習是人工智慧的一種方法，讓電腦從資料中學習規律。",
                "start_time": None,
                "end_time": None
            }
        ],
        "questions": [
            {
                "question_text": "人工智慧、機器學習與深度學習的關係為何？",
                "options": [
                    "A. 人工智慧包含機器學習，機器學習包含深度學習",
                    "B. 深度學習包含人工智慧",
                    "C. 三者完全沒有關係",
                    "D. 機器學習包含人工智慧"
                ],
                "answer": "A",
                "explanation": "人工智慧是最大的範圍，機器學習是其中一種方法，而深度學習是機器學習的分支。",
                "related_knowledge_point": "三者的層級關係"
            }
        ]
    }


def generate_mind_map(transcript):
    return {
        "mind_map": {
            "title": "人工智慧、機器學習與深度學習",
            "description": "介紹 AI、機器學習與深度學習的定義與彼此關係。",
            "start_time": None,
            "end_time": None,
            "children": [
                {
                    "title": "人工智慧",
                    "description": "讓機器模仿人類智慧的技術。",
                    "start_time": None,
                    "end_time": None,
                    "children": [
                        {
                            "title": "主要能力",
                            "description": "包括判斷、學習、理解語言與解決問題。",
                            "start_time": None,
                            "end_time": None,
                            "children": []
                        }
                    ]
                },
                {
                    "title": "機器學習",
                    "description": "人工智慧中的一種學習方法。",
                    "start_time": None,
                    "end_time": None,
                    "children": []
                }
            ]
        }
    }


def ask_ai_assistant(transcript, question):
    return {
        "question": question,
        "answer": "這堂課的重點是介紹人工智慧、機器學習與深度學習的關係。人工智慧是最大的範圍，機器學習是其中一種方法，而深度學習又是機器學習中的一個分支。"
    }


def main():
    print("開始 AI 測試流程...")

    transcript = load_transcript()
    print("已讀取逐字稿")

    learning_content = generate_learning_content(transcript)
    save_json(learning_content, OUTPUT_LEARNING_FILE)

    mind_map = generate_mind_map(transcript)
    save_json(mind_map, OUTPUT_MIND_MAP_FILE)

    chat_result = ask_ai_assistant(transcript, "這堂課的重點是什麼？")
    save_json(chat_result, OUTPUT_CHAT_FILE)

    print("AI 測試流程完成")


if __name__ == "__main__":
    main()