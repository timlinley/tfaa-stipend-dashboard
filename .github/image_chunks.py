"""Image files may carry image data only (Cadenza Security ruling 11/20/2026, Quality Control). A PNG may hold only
the chunks below: no text, EXIF, ICC profile (iCCP) or C2PA Content Credentials (caBX), which can name the tool,
account and edit history behind a file. Any other image type fails if it carries C2PA/JUMBF or EXIF markers.
Run: python3 image_chunks.py [repo folder]   (prints each problem; exit 1 if any)"""
import pathlib
import struct
import sys

ALLOWED = {"IHDR", "PLTE", "tRNS", "IDAT", "IEND", "sRGB", "gAMA", "pHYs"}
IMAGES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".svg", ".avif"}
SKIP = {".git", "node_modules", ".venv", "venv", "__pycache__"}
MARKERS = (b"caBX", b"c2pa", b"jumb", b"Exif\x00\x00")


def png_chunks(data: bytes) -> list[str]:
    out, i = [], 8
    while i + 8 <= len(data):
        n, kind = struct.unpack(">I4s", data[i:i + 8])
        out.append(kind.decode("latin-1"))
        i += 12 + n
    return out


def problems(root: pathlib.Path) -> list[str]:
    bad = []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.suffix.lower() not in IMAGES or SKIP & set(p.relative_to(root).parts):
            continue
        data = p.read_bytes()
        name = p.relative_to(root).as_posix()
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            extra = sorted(set(png_chunks(data)) - ALLOWED)
            if extra:
                bad.append(f"{name}: chunks {', '.join(extra)} are not allowed")
        elif any(m in data for m in MARKERS):
            bad.append(f"{name}: carries C2PA/JUMBF or EXIF data")
    return bad


if __name__ == "__main__":
    found = problems(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "."))
    for line in found:
        print("Image check: " + line + ". Re-save the file with image data only.")
    print(f"Image check: {len(found)} problem(s).")
    sys.exit(1 if found else 0)
