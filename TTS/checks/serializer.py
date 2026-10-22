#!/usr/bin/env python3
"""The save's bytes are a fixed point of the updater's TTS serializer, and look like TTS JSON.

python3 serializer.py [save.json]   (the updater's code: $AUTOCROISSANT)
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from checks_env import save_arg, use_bot  # noqa: E402

use_bot()
from commands.tts_save import _dump  # noqa: E402

fails = []
raw = open(save_arg(), "rb").read()
text = raw.decode("utf-8")
save = json.loads(text)
out = _dump(save)
if out.encode("utf-8") != raw:
    a, b = text, out
    i = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
    fails.append(f"not a fixed point of _dump at char {i}: {a[max(0, i - 60):i + 60]!r} vs {b[max(0, i - 60):i + 60]!r}")
if raw.endswith(b"\n"):
    fails.append("trailing newline (TTS writes none)")
if "\r" in text:
    fails.append("CR in the file")
for m in re.finditer(r":\s(-?\d+\.\d+e[+-]?\d+)", text):
    fails.append(f"lower-case exponent {m.group(1)}")
    break
for tok in ("NaN", "Infinity"):
    if re.search(r":\s-?" + tok + r"\b", text):
        fails.append(f"{tok} literal")
for ch in (chr(0x2028), chr(0x2029), chr(0x85)):
    if ch in text:
        fails.append(f"raw {ch!r} (TTS escapes it)")
for m in fails:
    print("FAIL", m)
print(f"serializer: {len(fails)} failures ({len(raw):,} bytes)")
sys.exit(1 if fails else 0)
