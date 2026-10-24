#!/usr/bin/env python3
"""Generate clearly labeled placeholder assets for the Pose with a Flyer prototype.

Nothing in here is a Dayton, NCAA, or sponsor trademark. Headshots are synthetic
illustrations. Athlete clips are flat silhouettes. Swap these files for the
real roster when it arrives; see the repository README.
"""

from __future__ import annotations

import json
import math
import random
import struct
import subprocess
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"

W_CLIP = 360
H_CLIP = 640
FPS = 12
FRAMES = 48  # 4.0s, matches walk-in from countdown 6 to the freeze at 2

NAVY = (0, 37, 84, 255)
RED = (189, 22, 52, 255)
CHAPEL = (0, 172, 236, 255)
WHITE = (255, 255, 255, 255)
BLACK = (8, 10, 14, 255)

MEN = [
    ("m01", "CASEY", "ALDEN", 4),
    ("m02", "MARCUS", "BELL", 11),
    ("m03", "ANDRE", "COLE", 15),
    ("m04", "LUIS", "ORTEGA", 22),
    ("m05", "NOAH", "PATEL", 3),
    ("m06", "EVAN", "BROOKS", 8),
    ("m07", "MALIK", "REED", 24),
    ("m08", "JONAH", "KIM", 1),
    ("m09", "THEO", "MARSH", 32),
    ("m10", "CALEB", "NGUYEN", 5),
    ("m11", "OMAR", "HASSAN", 12),
    ("m12", "FELIX", "GRANT", 21),
    ("m13", "WYATT", "SHAW", 33),
    ("m14", "DIEGO", "RAMOS", 10),
    ("m15", "QUINN", "HARPER", 2),
    ("m16", "BLAKE", "SOTO", 23),
    ("m17", "IAN", "FOSTER", 14),
    ("m18", "MILES", "CHEN", 0),
    ("m19", "ROWAN", "PIKE", 25),
]
WOMEN = [
    ("w01", "AVERY", "LANE", 4),
    ("w02", "MAYA", "CHEN", 11),
    ("w03", "SOFIA", "REYES", 15),
    ("w04", "JORDAN", "BLAKE", 22),
    ("w05", "PRIYA", "SHAH", 3),
    ("w06", "ELENA", "VOSS", 8),
    ("w07", "NAOMI", "BROOKS", 24),
    ("w08", "HANA", "ITO", 1),
    ("w09", "RILEY", "QUINN", 32),
    ("w10", "CAMILA", "ORTIZ", 5),
    ("w11", "TESS", "MORGAN", 12),
    ("w12", "BIANCA", "COLE", 21),
    ("w13", "GRACE", "ADEYEMI", 33),
    ("w14", "LILA", "PARK", 10),
    ("w15", "NORA", "SINGH", 2),
    ("w16", "PAIGE", "DONOVAN", 23),
    ("w17", "SUMMER", "ELLIS", 14),
    ("w18", "VALERIE", "CHO", 0),
    ("w19", "WREN", "ALVAREZ", 25),
]

SKIN = [
    (255, 224, 196),
    (241, 194, 152),
    (224, 172, 128),
    (198, 140, 98),
    (166, 108, 72),
    (120, 78, 52),
    (92, 60, 42),
    (232, 196, 168),
]
HAIR = [
    (28, 22, 18),
    (72, 48, 28),
    (140, 92, 48),
    (40, 40, 44),
    (180, 140, 70),
    (90, 40, 32),
]

LEFT_CLIPS = [
    "athletes/left_dribble.mp4",
    "athletes/left_stand.mp4",
    "athletes/left_crossover.mp4",
]
RIGHT_CLIPS = [
    "athletes/right_dribble.mp4",
    "athletes/right_stand.mp4",
    "athletes/right_crossover.mp4",
]
POSES = ["dribble", "stand", "crossover"]


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def draw_player(
    canvas: Image.Image,
    origin_x: float,
    pose: str,
    mirror: bool,
    jersey: tuple[int, int, int, int],
    number: str,
    bob: float,
) -> None:
    """Draw a flat original basketball-player silhouette. Not a likeness."""
    draw = ImageDraw.Draw(canvas)
    cx = origin_x + (W_CLIP / 2)
    ground = H_CLIP - 18 + bob

    def x(dx: float) -> float:
        return cx + (-dx if mirror else dx)

    def box(x0: float, y0: float, x1: float, y1: float) -> list[float]:
        return [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]

    head_r = 38
    head_c = (cx, ground - 520)
    shoulder_y = ground - 455
    hip_y = ground - 250
    # legs
    draw.polygon(
        [
            (x(-34), hip_y),
            (x(34), hip_y),
            (x(48), ground),
            (x(16), ground),
            (x(6), hip_y + 40),
            (x(-8), ground),
            (x(-46), ground),
        ],
        fill=NAVY,
    )
    # shoes
    draw.ellipse(box(x(-52), ground - 16, x(-4), ground + 8), fill=(20, 20, 20, 255))
    draw.ellipse(box(x(6), ground - 16, x(58), ground + 8), fill=(20, 20, 20, 255))
    # torso
    draw.rounded_rectangle(
        box(x(-78), shoulder_y, x(78), hip_y + 10),
        radius=28,
        fill=jersey,
    )
    # arms
    if pose == "dribble":
        draw.polygon(
            [(x(-70), shoulder_y + 20), (x(-110), hip_y - 20), (x(-78), hip_y + 10), (x(-40), shoulder_y + 50)],
            fill=jersey,
        )
        draw.ellipse(box(x(-128), hip_y - 10, x(-78), hip_y + 46), fill=SKIN[2] + (255,))
        draw.polygon(
            [(x(60), shoulder_y + 16), (x(96), shoulder_y + 80), (x(70), hip_y - 30), (x(36), shoulder_y + 40)],
            fill=jersey,
        )
        ball_c = (x(-104), hip_y + 70)
    elif pose == "crossover":
        draw.polygon(
            [(x(-60), shoulder_y + 24), (x(-20), hip_y + 20), (x(20), hip_y + 30), (x(10), shoulder_y + 40)],
            fill=jersey,
        )
        draw.ellipse(box(x(-36), hip_y + 8, x(20), hip_y + 64), fill=SKIN[2] + (255,))
        ball_c = (x(-8), hip_y + 78)
    else:
        draw.polygon(
            [(x(-70), shoulder_y + 18), (x(-108), shoulder_y + 120), (x(-70), shoulder_y + 140), (x(-36), shoulder_y + 40)],
            fill=jersey,
        )
        draw.polygon(
            [(x(50), shoulder_y + 10), (x(108), hip_y - 80), (x(78), hip_y - 40), (x(30), shoulder_y + 36)],
            fill=jersey,
        )
        draw.ellipse(box(x(78), hip_y - 100, x(132), hip_y - 46), fill=SKIN[2] + (255,))
        ball_c = (x(112), hip_y - 40)

    # head
    draw.ellipse(
        [head_c[0] - head_r, head_c[1] - head_r, head_c[0] + head_r, head_c[1] + head_r + 6],
        fill=(232, 196, 160, 255),
    )
    # hair cap
    draw.chord(
        [head_c[0] - head_r, head_c[1] - head_r - 4, head_c[0] + head_r, head_c[1] + 8],
        start=200,
        end=340,
        fill=(30, 24, 20, 255),
    )
    # jersey number
    fnt = font(54, bold=True)
    num = number
    bbox = draw.textbbox((0, 0), num, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((cx - tw / 2, shoulder_y + 48), num, font=fnt, fill=WHITE)

    # basketball
    bx, by = ball_c
    r = 28
    draw.ellipse([bx - r, by - r, bx + r, by + r], fill=(214, 112, 36, 255))
    draw.arc([bx - r, by - r, bx + r, by + r], 0, 360, fill=(90, 40, 16, 255), width=2)
    draw.line([(bx - r, by), (bx + r, by)], fill=(90, 40, 16, 255), width=2)
    draw.arc([bx - r, by - r - 8, bx + r, by + r - 18], 300, 60, fill=(90, 40, 16, 255), width=2)


def render_clip_frame(pose: str, mirror: bool, frame_index: int) -> tuple[bytes, bytes]:
    t = ease(frame_index / (FRAMES - 1))
    bob = math.sin(frame_index / FRAMES * math.pi * 3) * 6 * (1 - t * 0.3)
    if mirror:
        start, end = W_CLIP * 0.85, 0.0
    else:
        start, end = -W_CLIP * 0.85, 0.0
    origin = lerp(start, end, t)
    jersey = RED if pose == "crossover" else NAVY
    number = {"dribble": "1", "stand": "2", "crossover": "3"}[pose]
    # Draw onto RGBA then split so the alpha plane matches the color silhouette.
    rgba = Image.new("RGBA", (W_CLIP, H_CLIP), (0, 0, 0, 0))
    draw_player(rgba, origin, pose, mirror, jersey, number, bob)
    rgb = Image.new("RGB", (W_CLIP, H_CLIP), (0, 0, 0))
    rgb.paste(rgba, mask=rgba.getchannel("A"))
    return rgb.tobytes(), rgba.getchannel("A").tobytes()


def encode_stacked(path: Path, pose: str, mirror: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    stacked_h = H_CLIP * 2
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{W_CLIP}x{stacked_h}",
        "-r",
        str(FPS),
        "-i",
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-profile:v",
        "baseline",
        "-level",
        "3.1",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "20",
        "-movflags",
        "+faststart",
        str(path),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None
    last_rgba_alpha = None
    last_rgb = None
    for i in range(FRAMES):
        rgb, alpha = render_clip_frame(pose, mirror, i)
        # Alpha plane is grayscale stored as RGB so H.264 can carry it.
        alpha_rgb = b"".join(bytes([a, a, a]) for a in alpha)
        proc.stdin.write(rgb + alpha_rgb)
        last_rgb, last_rgba_alpha = rgb, alpha
    proc.stdin.close()
    code = proc.wait()
    if code != 0:
        raise RuntimeError(f"ffmpeg failed for {path} ({code})")
    # Poster of the last frame with a real alpha channel, for the no-decode fallback.
    poster = Image.frombytes("RGB", (W_CLIP, H_CLIP), last_rgb).convert("RGBA")
    mask = Image.frombytes("L", (W_CLIP, H_CLIP), last_rgba_alpha)
    poster.putalpha(mask)
    poster.save(path.with_suffix(".png"))


def encode_webm(path: Path, pose: str, mirror: bool) -> None:
    """VP9 with a real alpha plane. Fallback path if stacked H.264 is unsuitable.

    The two raw streams are files, not a shared stdin. ffmpeg reads both `-i -`
    inputs from the same pipe and the planes get truncated.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    color_bytes = bytearray()
    alpha_bytes = bytearray()
    for i in range(FRAMES):
        rgb, alpha = render_clip_frame(pose, mirror, i)
        color_bytes.extend(rgb)
        alpha_bytes.extend(alpha)
    tmp = path.parent / f".{path.stem}"
    tmp.mkdir(parents=True, exist_ok=True)
    color_path = tmp / "color.raw"
    alpha_path = tmp / "alpha.raw"
    color_path.write_bytes(color_bytes)
    alpha_path.write_bytes(alpha_bytes)
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{W_CLIP}x{H_CLIP}",
        "-r",
        str(FPS),
        "-i",
        str(color_path),
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "-s",
        f"{W_CLIP}x{H_CLIP}",
        "-r",
        str(FPS),
        "-i",
        str(alpha_path),
        "-filter_complex",
        "[0:v]format=gbrp[c];[1:v]format=gray[a];[c][a]alphamerge,format=yuva420p",
        "-an",
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-b:v",
        "1M",
        "-auto-alt-ref",
        "0",
        "-metadata:s:v:0",
        "alpha_mode=1",
        str(path),
    ]
    subprocess.check_call(cmd)
    color_path.unlink(missing_ok=True)
    alpha_path.unlink(missing_ok=True)
    tmp.rmdir()


def headshot(path: Path, first: str, last: str, jersey: int, team: str, seed: int) -> None:
    rng = random.Random(seed)
    size = 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    skin = SKIN[seed % len(SKIN)]
    hair = HAIR[seed % len(HAIR)]
    jersey_color = (250, 250, 252, 255) if team == "womens" else NAVY
    trim = RED
    # backdrop circle
    draw.ellipse([16, 16, size - 16, size - 16], fill=(236, 240, 244, 255))
    # shoulders
    draw.ellipse([70, 300, size - 70, 560], fill=jersey_color)
    draw.rectangle([70, 390, size - 70, 512], fill=jersey_color)
    draw.rectangle([150, 330, size - 150, 360], fill=trim)
    # neck + head
    draw.rounded_rectangle([220, 250, 292, 340], radius=16, fill=skin + (255,))
    draw.ellipse([146, 78, 366, 310], fill=skin + (255,))
    # hair
    style = seed % 4
    if style == 0:
        draw.chord([146, 70, 366, 240], 200, 340, fill=hair + (255,))
    elif style == 1:
        draw.ellipse([140, 70, 372, 230], fill=hair + (255,))
        draw.rectangle([146, 160, 190, 280], fill=hair + (255,))
        draw.rectangle([322, 160, 366, 280], fill=hair + (255,))
    elif style == 2:
        draw.ellipse([156, 60, 356, 200], fill=hair + (255,))
    else:
        draw.ellipse([150, 90, 362, 250], fill=hair + (255,))
        draw.ellipse([170, 40, 250, 120], fill=hair + (255,))
    # simple face, deliberately generic
    eye_y = 190
    draw.ellipse([200, eye_y, 228, eye_y + 18], fill=(255, 255, 255, 255))
    draw.ellipse([284, eye_y, 312, eye_y + 18], fill=(255, 255, 255, 255))
    draw.ellipse([208, eye_y + 4, 220, eye_y + 16], fill=(40, 40, 40, 255))
    draw.ellipse([292, eye_y + 4, 304, eye_y + 16], fill=(40, 40, 40, 255))
    draw.arc([230, 210, 286, 258], 20, 160, fill=(150, 80, 80, 255), width=3)
    if rng.random() > 0.5:
        draw.arc([210, 168, 236, 188], 200, 340, fill=hair + (255,), width=3)
        draw.arc([276, 168, 302, 188], 200, 340, fill=hair + (255,), width=3)
    # number
    fnt = font(72, bold=True)
    label = str(jersey)
    bbox = draw.textbbox((0, 0), label, font=fnt)
    tw = bbox[2] - bbox[0]
    fill = NAVY if team == "womens" else WHITE
    draw.text(((size - tw) / 2, 360), label, font=fnt, fill=fill)
    # FPO tag so these can never be mistaken for athlete photos
    tag = font(22, bold=True)
    draw.rounded_rectangle([186, 24, 326, 58], radius=8, fill=(189, 22, 52, 230))
    draw.text((214, 30), "FPO", font=tag, fill=WHITE)
    img.save(path)
    # silence unused
    _ = (first, last)


def guest_cutout(path: Path) -> None:
    w, h = 720, 1400
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = w / 2
    skin = (232, 196, 168, 255)
    shirt = (214, 216, 220, 255)
    pants = (32, 34, 38, 255)
    # legs
    draw.polygon([(cx - 70, 760), (cx + 70, 760), (cx + 90, 1240), (cx + 20, 1240), (cx, 860), (cx - 24, 1240), (cx - 96, 1240)], fill=pants)
    draw.rounded_rectangle([cx - 110, 1220, cx - 10, 1288], radius=12, fill=(246, 246, 246, 255))
    draw.rounded_rectangle([cx + 8, 1220, cx + 108, 1288], radius=12, fill=(246, 246, 246, 255))
    # torso
    draw.rounded_rectangle([cx - 150, 430, cx + 150, 820], radius=60, fill=shirt)
    # arms
    draw.rounded_rectangle([cx - 210, 470, cx - 130, 760], radius=36, fill=shirt)
    draw.rounded_rectangle([cx + 130, 500, cx + 210, 800], radius=36, fill=shirt)
    draw.ellipse([cx - 230, 720, cx - 150, 800], fill=skin)
    draw.ellipse([cx + 150, 760, cx + 230, 840], fill=skin)
    # head
    draw.ellipse([cx - 92, 150, cx + 92, 360], fill=skin)
    draw.chord([cx - 96, 140, cx + 96, 300], 200, 340, fill=(90, 56, 40, 255))
    draw.ellipse([cx - 46, 230, cx - 18, 252], fill=WHITE)
    draw.ellipse([cx + 18, 230, cx + 46, 252], fill=WHITE)
    draw.ellipse([cx - 36, 236, cx - 24, 248], fill=BLACK)
    draw.ellipse([cx + 26, 236, cx + 38, 248], fill=BLACK)
    draw.arc([cx - 36, 260, cx + 36, 320], 20, 160, fill=(176, 96, 110, 255), width=4)
    fnt = font(48, bold=True)
    draw.rounded_rectangle([cx - 70, 500, cx + 70, 560], radius=8, fill=(214, 40, 160, 255))
    bbox = draw.textbbox((0, 0), "FPO", font=fnt)
    tw = bbox[2] - bbox[0]
    draw.text((cx - tw / 2, 508), "FPO", font=fnt, fill=WHITE)
    img.save(path)


def noise_png(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(7)
    img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    pix = img.load()
    for y in range(512):
        for x in range(512):
            if rng.random() > 0.82:
                v = rng.randint(0, 255)
                a = rng.randint(20, 90)
                pix[x, y] = (v, v, v, a)
    img.save(path)


def attract_and_fire() -> None:
    attract = ASSETS / "attract" / "loop.mp4"
    attract.parent.mkdir(parents=True, exist_ok=True)
    w, h, frames = 1280, 720, 72
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", "12", "-i", "-",
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart",
        str(attract),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None
    for i in range(frames):
        img = Image.new("RGB", (w, h), (0, 37, 84))
        draw = ImageDraw.Draw(img, "RGBA")
        # diagonal brighter panel
        shift = int(math.sin(i / frames * math.pi * 2) * 30)
        draw.polygon([(0, 0), (520 + shift, 0), (700 + shift, h), (0, h)], fill=(26, 110, 184, 255))
        # slow light streak
        streak = int((i / frames) * (w + 400)) - 200
        draw.polygon([(streak, 0), (streak + 80, 0), (streak + 200, h), (streak + 80, h)], fill=(255, 255, 255, 28))
        # grid
        for x in range(0, w, 48):
            draw.line([(x, 0), (x, h)], fill=(255, 255, 255, 18), width=1)
        for y in range(0, h, 48):
            draw.line([(0, y), (w, y)], fill=(255, 255, 255, 18), width=1)
        proc.stdin.write(img.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("attract encode failed")

    fire = ASSETS / "fx" / "fire.mp4"
    fire.parent.mkdir(parents=True, exist_ok=True)
    fw, fh, fframes = 320, 180, 24
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{fw}x{fh}", "-r", "12", "-i", "-",
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-movflags", "+faststart",
        str(fire),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None
    rng = random.Random(3)
    for i in range(fframes):
        img = Image.new("RGB", (fw, fh), (20, 8, 4))
        draw = ImageDraw.Draw(img)
        for k in range(18):
            x = rng.randint(0, fw)
            y = (fh - ((i * 12 + k * 17) % (fh + 40)))
            r = rng.randint(8, 28)
            color = rng.choice([(255, 140, 32), (255, 80, 16), (255, 200, 80), (180, 30, 10)])
            draw.ellipse([x - r, y - r, x + r, y + r], fill=color)
        img = img.filter(ImageFilter.GaussianBlur(radius=2))
        proc.stdin.write(img.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("fire encode failed")


def takeaway_frame(path: Path) -> None:
    w, h = 2560, 1440
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # red hairline border
    for i in range(10):
        draw.rectangle([i, i, w - 1 - i, h - 1 - i], outline=RED)
    # placeholder D mark, original geometric letter, not the Flyers logo
    draw.rounded_rectangle([48, 40, 168, 150], radius=18, fill=RED)
    fnt = font(78, bold=True)
    draw.text((78, 52), "D", font=fnt, fill=WHITE)
    # bottom banner
    banner_h = 110
    y0 = h - banner_h
    draw.rectangle([0, y0, w, h], fill=RED)
    title = font(42, bold=True)
    draw.text((48, y0 + 32), "THE EPICENTER OF COLLEGE BASKETBALL", font=title, fill=WHITE)
    small = font(28, bold=True)
    draw.text((1680, y0 + 38), "SPONSORED BY", font=small, fill=WHITE)
    # text sponsor lockup, not the credit-union logo artwork
    serif = font(32, bold=True)
    draw.rectangle([1960, y0 + 18, 2500, h - 18], fill=(10, 42, 92, 255))
    draw.text((1980, y0 + 28), "Wright-Patt", font=serif, fill=WHITE)
    tiny = font(16, bold=True)
    draw.text((1980, y0 + 66), "CREDIT UNION, INC.", font=tiny, fill=(180, 200, 220, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def write_qr(path: Path) -> None:
    try:
        import qrcode
    except ImportError:
        # Leave a labeled box; the on-screen card also draws a CSS placeholder.
        img = Image.new("RGB", (280, 280), "white")
        d = ImageDraw.Draw(img)
        d.rectangle([8, 8, 271, 271], outline="black", width=4)
        d.text((70, 120), "QR PLACEHOLDER", font=font(18, True), fill="black")
        img.save(path)
        return
    img = qrcode.make("https://qrco.de/FLYERPOSE").convert("RGB")
    img = img.resize((280, 280), Image.Resampling.NEAREST)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def write_roster() -> None:
    def entry(row: tuple[str, str, str, int], team: str, index: int) -> dict:
        ident, first, last, jersey = row
        variant = index % 3
        webm = {}
        if variant == 0:
            webm = {
                "leftWebm": "athletes/left_dribble.webm",
                "rightWebm": "athletes/right_dribble.webm",
            }
        return {
            "id": ident,
            "firstName": first,
            "lastName": last,
            "jersey": jersey,
            "team": team,
            "headshot": f"headshots/{ident}.png",
            "placeholder": True,
            "clips": {
                "left": LEFT_CLIPS[variant],
                "right": RIGHT_CLIPS[variant],
                **webm,
            },
        }

    clip_meta = {}
    for path in LEFT_CLIPS + RIGHT_CLIPS:
        clip_meta[path] = {
            "layout": "stacked-alpha",
            "width": W_CLIP,
            "height": H_CLIP,
            "fps": FPS,
            "durationSeconds": FRAMES / FPS,
        }
    for path in ("athletes/left_dribble.webm", "athletes/right_dribble.webm"):
        clip_meta[path] = {
            "layout": "vp9-alpha",
            "width": W_CLIP,
            "height": H_CLIP,
            "fps": FPS,
            "durationSeconds": FRAMES / FPS,
        }
    roster = {
        "version": 1,
        "note": "Synthetic placeholder roster. Names, numbers, and portraits are fictional. Replace this file and the headshots/athletes folders with licensed assets.",
        "clipMeta": clip_meta,
        "teams": {
            "mens": [entry(row, "mens", i) for i, row in enumerate(MEN)],
            "womens": [entry(row, "womens", i) for i, row in enumerate(WOMEN)],
        },
    }
    (ASSETS / "roster.json").write_text(json.dumps(roster, indent=2) + "\n")


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_icon_source(path: Path) -> None:
    img = Image.new("RGBA", (1024, 1024), (0, 37, 84, 255))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([160, 160, 864, 864], radius=140, fill=RED)
    fnt = font(520, bold=True)
    draw.text((300, 180), "D", font=fnt, fill=WHITE)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    _ = png_chunk  # kept so a future raw writer can reuse it


def main() -> None:
    (ASSETS / "headshots").mkdir(parents=True, exist_ok=True)
    (ASSETS / "athletes").mkdir(parents=True, exist_ok=True)
    (ASSETS / "placeholders").mkdir(parents=True, exist_ok=True)
    print("headshots")
    for i, row in enumerate(MEN):
        headshot(ASSETS / "headshots" / f"{row[0]}.png", row[1], row[2], row[3], "mens", i + 1)
    for i, row in enumerate(WOMEN):
        headshot(ASSETS / "headshots" / f"{row[0]}.png", row[1], row[2], row[3], "womens", i + 40)
    print("guest, noise, frame, qr, icon")
    guest_cutout(ASSETS / "placeholders" / "guest.png")
    noise_png(ASSETS / "textures" / "grain.png")
    takeaway_frame(ASSETS / "frames" / "takeaway_v1.png")
    write_qr(ASSETS / "branding" / "register-qr.png")
    write_icon_source(ROOT / "src-tauri" / "icons" / "source.png")
    print("clips")
    for pose, left, right in zip(POSES, LEFT_CLIPS, RIGHT_CLIPS):
        print(" ", left)
        encode_stacked(ASSETS / left, pose, mirror=False)
        print(" ", right)
        encode_stacked(ASSETS / right, pose, mirror=True)
    print("webm fallback")
    encode_webm(ASSETS / "athletes" / "left_dribble.webm", "dribble", mirror=False)
    encode_webm(ASSETS / "athletes" / "right_dribble.webm", "dribble", mirror=True)
    print("attract + fire")
    attract_and_fire()
    write_roster()
    print("done")
    for path in sorted(ASSETS.rglob("*")):
        if path.is_file():
            print(f"{path.relative_to(ROOT)} {path.stat().st_size}")


if __name__ == "__main__":
    main()
