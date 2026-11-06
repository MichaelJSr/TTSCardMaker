# Card previews

Made by TTSCardMaker's `.github/workflows/card-preview.yml` (AutoCroissant `commands/card_preview.py`): `previews/<request>/` holds `result.json`, `preview.webp` and `before.webp` (the card before the edit, for the Diff); `index.json` lists them. One commit per preview; rewritten as one fresh commit when it holds more than 200 previews or one older than 7 days. Never merged into main.
