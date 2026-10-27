from services import ai_generation


def test_content_models_use_configured_order(monkeypatch):
    monkeypatch.setenv(
        "GEMINI_CONTENT_MODELS",
        "gemini-3.8-flash, gemini-3.1-flash-lite, gemini-2.5-flash, gemini-3.5-flash-lite",
    )

    assert ai_generation.get_content_generation_models() == (
        "gemini-3.8-flash",
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash",
        "gemini-3.5-flash-lite",
    )


def test_content_models_remove_blanks_and_duplicates(monkeypatch):
    monkeypatch.setenv(
        "GEMINI_CONTENT_MODELS",
        "gemini-3.8-flash, ,gemini-2.5-flash,gemini-3.8-flash",
    )

    assert ai_generation.get_content_generation_models() == (
        "gemini-3.8-flash",
        "gemini-2.5-flash",
    )
