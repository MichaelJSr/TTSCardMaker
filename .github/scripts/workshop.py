"""
The TTS save as the file TTS itself uploads to the Workshop: BSON, floats as singles (TTS writes each decimal number as a
double holding a single's value) and BreakForce/BreakTorgue "Infinity" strings as doubles. Checked against TTS's own
11-18 upload of the save: same bytes but for TTS's physics drift.

    python .github/scripts/workshop.py "TTS/Impossibility Simulator.json" OUT_FILE

Prints sha1= and bytes= (also to $GITHUB_OUTPUT).
"""
import hashlib, json, math, os, struct, sys

import bson

MAX_BYTES = 100 * 1024 * 1024                  # Steam: one cloud file
INF = {"Infinity": math.inf, "-Infinity": -math.inf, "NaN": math.nan}


def single(x: float) -> float:
    return struct.unpack("<f", struct.pack("<f", x))[0] if abs(x) <= 3.4e38 else x


def tts(v, key=None):
    if isinstance(v, dict):
        return {k: tts(x, k) for k, x in v.items()}
    if isinstance(v, list):
        return [tts(x) for x in v]
    if isinstance(v, float):
        return single(v)
    if isinstance(v, str) and key in ("BreakForce", "BreakTorgue") and v in INF:
        return INF[v]
    return v


def build(path: str) -> bytes:
    with open(path, encoding="utf-8") as fh:
        save = tts(json.load(fh))
    out = bson.encode(save)
    if bson.encode(bson.decode(out)) != out:
        sys.exit("BSON round trip differs")
    if len(out) > MAX_BYTES:
        sys.exit(f"{len(out):,} bytes: over Steam's 100 MiB")
    return out


def main() -> int:
    save, out = sys.argv[1:3]
    data = build(save)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "wb") as fh:
        fh.write(data)
    lines = [f"sha1={hashlib.sha1(data).hexdigest()}", f"bytes={len(data)}"]
    print("\n".join(lines))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
            fh.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
