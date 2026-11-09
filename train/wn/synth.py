"""학습 데이터 합성.

한 장의 학습 샘플 = (입력: 배경 정리된 사진 조각, 정답: 손글씨 위치 마스크)

재료
  1) 인쇄 페이지
     - 한국 문제집 스타일로 직접 그린 페이지 (명조/고딕, 문제 번호, 상자, 답칸, 색 띠, 도형,
       연한 회색 인쇄 등 — 지금 규칙 방식이 실수하던 요소를 일부러 많이 넣음)
     - ExamInk-Seg 의 '손글씨 지운' 실제 시험지 스캔 (target)
  2) 손글씨 층
     - 한글 손글씨 폰트로 쓴 풀이/답 (숫자, 식, 한글, 영어)
     - 손으로 그은 선: 동그라미, 밑줄, 체크, 화살표, 낙서, 계산 흔적
     - ExamInk-Seg 실제 학생 손글씨를 뽑아낸 것
  3) 필기구 스타일: 연필(회색·거친 결·연함~진함), 볼펜(검정/파랑), 빨간펜, 색연필
  4) 폰 사진 흉내: 조명 얼룩, 색온도, 흐림, 노이즈, JPEG
그 뒤 앱과 똑같이 배경 정리(normalize)를 거쳐 입력을 만듭니다.
"""
import io
import math
import os
import random
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy.ndimage import gaussian_filter, binary_opening, binary_dilation

from .normalize import normalize

# ---------------------------------------------------------------- 폰트
FONT_BASE = 'https://github.com/google/fonts/raw/main/ofl/'
PRINT_FONTS = [
    'nanummyeongjo/NanumMyeongjo-Regular.ttf',
    'nanummyeongjo/NanumMyeongjo-Bold.ttf',
    'nanumgothic/NanumGothic-Regular.ttf',
    'nanumgothic/NanumGothic-Bold.ttf',
    'notosanskr/NotoSansKR%5Bwght%5D.ttf',
    'notoserifkr/NotoSerifKR%5Bwght%5D.ttf',
]
HAND_FONTS = [
    'nanumpenscript/NanumPenScript-Regular.ttf',
    'nanumbrushscript/NanumBrushScript-Regular.ttf',
    'gaegu/Gaegu-Regular.ttf',
    'gaegu/Gaegu-Bold.ttf',
    'himelody/HiMelody-Regular.ttf',
    'gamjaflower/GamjaFlower-Regular.ttf',
    'poorstory/PoorStory-Regular.ttf',
    'yeonsung/YeonSung-Regular.ttf',
]


def ensure_fonts(font_dir):
    os.makedirs(font_dir, exist_ok=True)
    for rel in PRINT_FONTS + HAND_FONTS:
        dst = os.path.join(font_dir, os.path.basename(rel).replace('%5B', '[').replace('%5D', ']'))
        if not os.path.exists(dst):
            urllib.request.urlretrieve(FONT_BASE + rel, dst)


def _font_paths(font_dir, rels):
    return [os.path.join(font_dir, os.path.basename(r).replace('%5B', '[').replace('%5D', ']')) for r in rels]


class Fonts:
    def __init__(self, font_dir):
        ensure_fonts(font_dir)
        self.print_paths = _font_paths(font_dir, PRINT_FONTS)
        self.hand_paths = _font_paths(font_dir, HAND_FONTS)
        self._cache = {}

    def get(self, path, size):
        key = (path, size)
        if key not in self._cache:
            self._cache[key] = ImageFont.truetype(path, size)
        return self._cache[key]

    def print_font(self, rng, size, bold=None):
        paths = self.print_paths
        if bold is True:
            paths = [p for p in paths if 'Bold' in p or 'wght' in p]
        return self.get(rng.choice(paths), size)

    def hand_font(self, rng, size):
        return self.get(rng.choice(self.hand_paths), size)


# ---------------------------------------------------------------- 문장 재료
KO_PHRASES = [
    '주어진 비를 간단한 자연수의 비로 나타내면', '안에 알맞은 수를 구해 보시오.', '다음 중 옳은 것을 고르시오.',
    '가로와 세로의 비가', '직사각형이 있습니다.', '세로는 몇 cm입니까?', '넓이를 구하시오.', '비례식을 만들고 답을 구해 보시오.',
    '우리말과 일치하도록 주어진 말을 이용하여 문장을 완성하시오.', '구슬의 수의 비는', '가지고 있다면', '몇 개입니까?',
    '케이크 한 개를 나누어 먹었습니다.', '전체의', '먹었습니다.', '물음에 답하시오.', '그림을 보고', '설명한 것입니다.',
    '알맞은 말에 ○표 하시오.', '계산 결과를 비교하여', '빈칸에 알맞은 수를 써넣으시오.', '분수의 나눗셈', '소수의 곱셈',
    '원의 넓이', '삼각형의 둘레', '평균을 구하시오.', '비율을 백분율로 나타내시오.', '그래프를 보고', '규칙을 찾아',
    '어느 것입니까?', '바르게 고친 것은?', '틀린 이유를 쓰시오.', '식을 세워 보시오.', '단원 평가', '교과서 pick',
    '서술형 대비 연습문제', '다음 문장을 읽고', '그들은 해변에 갔다.', '물이 100도에 끓으니?', '아니, 그녀는 머핀을 먹었어.',
]
EN_WORDS = ['live', 'boil', 'have', 'go', 'Heidi', 'in', 'New', 'York', 'last', 'year', 'She', 'Sydney', 'now',
            'water', 'at', 'They', 'to', 'the', 'mountains', 'beach', 'Amy', 'doughnut', 'for', 'No', "didn't",
            'muffin', 'Did', 'Does', 'Yes', 'it', 'wrote', 'Christmas', 'cards', 'my', 'aunt', 'teaches', 'music']
HAND_TEXTS = [
    '12×5/9=25×△', '17/15=△', '17÷15=△', '△=4', '6:9=2:3', '1:2=12:□', '5:3=25:□', '24cm', '15개', '9개',
    '가, 라', '답', '1:20', '4/15', '20/3×1/25', '12', '25', '3', '7', '0.5', '3.14', '100', '=', '+', '-', '×',
    'lived', 'lives', 'Does', 'boil', 'it', 'does', "didn't", 'go', 'went', 'Did', 'have', 'ate', 'I wrote',
    '모르겠다', '다시', '왜?', '정답', '풀이', '①', '②', '③', '④', '⑤', '○', '×', '?', '!!', '1/2', '2/3', '3/8', '9/16',
]


def _rand_ko_line(rng, max_chars=26):
    s = rng.choice(KO_PHRASES)
    while len(s) < max_chars * 0.6 and rng.random() < 0.7:
        s += ' ' + rng.choice(KO_PHRASES + [str(rng.randint(1, 99)), f'{rng.randint(1, 30)} : {rng.randint(1, 30)}'])
    return s[:max_chars]


def _rand_en_line(rng):
    return ' '.join(rng.choice(EN_WORDS) for _ in range(rng.randint(3, 8)))


# ---------------------------------------------------------------- 인쇄 페이지
def _gray(v):
    return (v, v, v)


def render_print_page(rng, fonts, w=960, h=960):
    paper = rng.randint(238, 255)
    img = Image.new('RGB', (w, h), (paper, paper, max(225, paper - rng.randint(0, 10))))
    d = ImageDraw.Draw(img)
    base = rng.randint(22, 36)              # 본문 글자 크기
    ink = _gray(rng.randint(10, 45))        # 본문 인쇄 색
    light = _gray(rng.randint(95, 175))     # 연한 회색 인쇄 (지우면 안 되는 것)
    accent = rng.choice([(232, 96, 80), (240, 120, 90), (90, 170, 110), (120, 180, 140), (80, 130, 200), (230, 90, 140)])
    y = rng.randint(-base, base)
    x0 = rng.randint(10, 60)

    while y < h - base:
        kind = rng.choices(
            ['problem', 'text', 'box', 'answer', 'paren', 'band', 'label', 'figure', 'gray', 'dots', 'table', 'english'],
            weights=[18, 14, 8, 10, 8, 4, 6, 6, 8, 3, 3, 8])[0]
        fs = int(base * rng.uniform(0.85, 1.15))
        if kind == 'problem':
            num = str(rng.randint(1, 30))
            d.text((x0, y), num, font=fonts.print_font(rng, int(fs * 1.5), bold=True), fill=ink)
            tx = x0 + int(fs * 1.4)
            for _ in range(rng.randint(1, 3)):
                d.text((tx, y), _rand_ko_line(rng), font=fonts.print_font(rng, fs), fill=ink)
                y += int(fs * 1.6)
        elif kind == 'text':
            d.text((x0 + rng.randint(0, 80), y), _rand_ko_line(rng), font=fonts.print_font(rng, fs), fill=ink)
            y += int(fs * 1.6)
        elif kind == 'english':
            d.text((x0 + rng.randint(0, 120), y), _rand_en_line(rng), font=fonts.print_font(rng, fs), fill=ink)
            y += int(fs * 1.6)
        elif kind == 'gray':
            d.text((x0 + rng.randint(0, 100), y), _rand_ko_line(rng), font=fonts.print_font(rng, int(fs * 0.85)), fill=light)
            y += int(fs * 1.4)
        elif kind == 'box':
            bw, bh = rng.randint(w // 3, w - 2 * x0), int(fs * rng.uniform(2.2, 4.5))
            bx = rng.randint(x0, max(x0 + 1, w - bw - 10))
            col = rng.choice([ink, light, _gray(rng.randint(60, 130))])
            d.rounded_rectangle((bx, y, bx + bw, y + bh), radius=rng.randint(4, 18), outline=col, width=rng.randint(1, 3))
            # 상자 안 분수/식
            cx = bx + bw // 3
            fnt = fonts.print_font(rng, fs)
            d.text((cx, y + bh * 0.15), str(rng.randint(1, 9)), font=fnt, fill=ink)
            d.line((cx - 4, y + bh / 2, cx + fs, y + bh / 2), fill=ink, width=2)
            d.text((cx, y + bh * 0.52), str(rng.randint(2, 19)), font=fnt, fill=ink)
            d.text((cx + fs * 2, y + bh * 0.3), ':', font=fnt, fill=ink)
            d.rectangle((cx + fs * 3, y + bh * 0.12, cx + fs * 3.8, y + bh * 0.42), outline=ink, width=2)
            y += bh + int(fs * 0.8)
        elif kind == 'answer':
            fnt = fonts.print_font(rng, fs, bold=rng.random() < 0.5)
            lab = rng.choice(['식 |', '답 |', '→', '답:'])
            lx = x0 + rng.randint(0, w // 3)
            d.text((lx, y), lab, font=fnt, fill=ink)
            ly = y + int(fs * 1.2)
            d.line((lx + fs * 1.5, ly, min(w - 10, lx + rng.randint(w // 3, w)), ly), fill=rng.choice([ink, light]), width=rng.randint(1, 2))
            y += int(fs * 2.2)
        elif kind == 'paren':
            fnt = fonts.print_font(rng, fs)
            px = x0 + rng.randint(w // 5, w // 2)
            d.text((px, y), '(', font=fnt, fill=ink)
            d.text((min(w - 30, px + rng.randint(w // 4, w // 2)), y), ')', font=fnt, fill=ink)
            y += int(fs * 1.8)
        elif kind == 'band':
            bh = int(fs * 1.8)
            col = tuple(int(c + (255 - c) * rng.uniform(0.0, 0.6)) for c in accent)
            d.rounded_rectangle((rng.randint(-40, x0), y, w + 40, y + bh), radius=bh // 2, fill=col)
            if rng.random() < 0.6:
                d.ellipse((x0, y + 3, x0 + bh - 6, y + bh - 3), fill=accent)
                d.text((x0 + bh * 0.3, y + bh * 0.15), str(rng.randint(1, 9)), font=fonts.print_font(rng, int(fs * 1.1), bold=True), fill=(255, 255, 255))
            d.text((x0 + bh * 1.2, y + bh * 0.15), _rand_ko_line(rng, 14), font=fonts.print_font(rng, int(fs * 1.1), bold=True), fill=ink)
            y += bh + int(fs * 0.8)
        elif kind == 'label':
            fnt = fonts.print_font(rng, fs)
            lw = int(fs * rng.uniform(4, 7))
            col = tuple(int(c + (255 - c) * rng.uniform(0.2, 0.6)) for c in accent)
            d.rectangle((x0, y, x0 + lw, y + int(fs * 1.6)), fill=col)
            d.text((x0 + lw * 0.3, y + fs * 0.2), rng.choice(EN_WORDS), font=fnt, fill=_gray(rng.randint(30, 80)))
            d.text((x0 + lw + fs, y + fs * 0.2), _rand_en_line(rng), font=fnt, fill=ink)
            y += int(fs * 2.2)
        elif kind == 'figure':
            fx = rng.randint(x0, w // 2)
            fw, fh = rng.randint(80, 220), rng.randint(80, 200)
            col = rng.choice([ink, (150, 100, 60), light, accent])
            shape = rng.choice(['rect', 'tri', 'circle'])
            wid = rng.randint(2, 8)
            if shape == 'rect':
                d.rectangle((fx, y, fx + fw, y + fh), outline=col, width=wid)
                if rng.random() < 0.5:
                    d.rectangle((fx + wid, y + wid, fx + fw - wid, y + fh - wid), fill=(205, 220, 240))
            elif shape == 'tri':
                d.polygon([(fx, y + fh), (fx + fw, y + fh), (fx + fw * rng.random(), y)], outline=col, width=wid)
            else:
                d.ellipse((fx, y, fx + fh, y + fh), outline=col, width=wid)
            d.text((fx + fw + 8, y + fh // 2), f'{rng.randint(2, 30)} cm', font=fonts.print_font(rng, int(fs * 0.9)), fill=ink)
            y += fh + int(fs)
        elif kind == 'dots':
            for xx in range(x0, w - x0, 8):
                d.point((xx, y + fs // 2), fill=light)
            y += fs
        elif kind == 'table':
            rows, cols = rng.randint(2, 4), rng.randint(3, 6)
            cw, ch = (w - 2 * x0) // cols, int(fs * 1.6)
            for r in range(rows + 1):
                d.line((x0, y + r * ch, x0 + cols * cw, y + r * ch), fill=ink, width=1)
            for c in range(cols + 1):
                d.line((x0 + c * cw, y, x0 + c * cw, y + rows * ch), fill=ink, width=1)
            for r in range(rows):
                for c in range(cols):
                    if rng.random() < 0.6:
                        d.text((x0 + c * cw + 8, y + r * ch + 4), str(rng.randint(1, 99)), font=fonts.print_font(rng, int(fs * 0.85)), fill=ink)
            y += rows * ch + fs
        y += rng.randint(0, fs)
    return np.asarray(img)


# ---------------------------------------------------------------- 손글씨 층
def _bezier(p0, p1, p2, n=24):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in np.linspace(0, 1, n)]


def _draw_strokes(rng, d, w, h, scale):
    kind = rng.choice(['circle', 'underline', 'check', 'arrow', 'scribble', 'cross', 'bracket', 'calc_lines'])
    lw = max(1, int(rng.uniform(1.5, 4.5) * scale))
    cx, cy = rng.uniform(0, w), rng.uniform(0, h)
    s = rng.uniform(30, 160) * scale
    if kind == 'circle':
        pts = [(cx + s * math.cos(t) * rng.uniform(0.9, 1.1), cy + s * 0.6 * math.sin(t) * rng.uniform(0.9, 1.1))
               for t in np.linspace(rng.uniform(0, 1), rng.uniform(6.0, 7.0), 40)]
        d.line(pts, fill=255, width=lw, joint='curve')
    elif kind == 'underline':
        pts = _bezier((cx, cy), (cx + s, cy + rng.uniform(-8, 8) * scale), (cx + 2 * s, cy + rng.uniform(-6, 6) * scale))
        d.line(pts, fill=255, width=lw, joint='curve')
    elif kind == 'check':
        d.line([(cx, cy), (cx + s * 0.3, cy + s * 0.4), (cx + s * 0.8, cy - s * 0.5)], fill=255, width=lw, joint='curve')
    elif kind == 'arrow':
        ex, ey = cx + rng.uniform(-s, s), cy + rng.uniform(-s, s)
        d.line([(cx, cy), (ex, ey)], fill=255, width=lw)
        a = math.atan2(ey - cy, ex - cx)
        for da in (2.6, -2.6):
            d.line([(ex, ey), (ex + 15 * scale * math.cos(a + da), ey + 15 * scale * math.sin(a + da))], fill=255, width=lw)
    elif kind == 'scribble':
        pts = [(cx, cy)]
        for _ in range(rng.randint(5, 20)):
            pts.append((pts[-1][0] + rng.uniform(-s, s) * 0.3, pts[-1][1] + rng.uniform(-s, s) * 0.3))
        d.line(pts, fill=255, width=lw, joint='curve')
    elif kind == 'cross':
        d.line([(cx - s / 3, cy - s / 3), (cx + s / 3, cy + s / 3)], fill=255, width=lw)
        d.line([(cx - s / 3, cy + s / 3), (cx + s / 3, cy - s / 3)], fill=255, width=lw)
    elif kind == 'bracket':
        d.line([(cx, cy), (cx, cy - s * 0.4), (cx + s * 1.5, cy - s * 0.4), (cx + s * 1.5, cy)], fill=255, width=lw)
    else:  # 계산 흔적: 짧은 가로선 여러 개
        for i in range(rng.randint(2, 5)):
            yy = cy + i * s * 0.35
            d.line([(cx, yy), (cx + s * rng.uniform(0.8, 2), yy + rng.uniform(-4, 4))], fill=255, width=lw)


def _draw_hand_text(rng, fonts, layer, w, h, scale):
    text = rng.choice(HAND_TEXTS) if rng.random() < 0.7 else ' '.join(rng.choice(HAND_TEXTS) for _ in range(rng.randint(2, 4)))
    size = int(rng.uniform(26, 60) * scale)
    font = fonts.hand_font(rng, size)
    tile = Image.new('L', (int(size * (len(text) + 2) * 0.8) + 20, int(size * 1.8)), 0)
    td = ImageDraw.Draw(tile)
    x = 10
    for ch in text:   # 글자마다 위치/크기 흔들기
        f = fonts.hand_font(rng, max(8, int(size * rng.uniform(0.85, 1.15)))) if rng.random() < 0.3 else font
        td.text((x, size * 0.2 + rng.uniform(-size * 0.12, size * 0.12)), ch, font=f, fill=255)
        x += int(size * rng.uniform(0.5, 0.85)) if ch != ' ' else int(size * 0.4)
    if rng.random() < 0.5:
        tile = tile.filter(ImageFilter.MaxFilter(3))   # 굵은 필기
    tile = tile.rotate(rng.uniform(-10, 10), resample=Image.BILINEAR, expand=True)
    sx = rng.randint(-tile.width // 3, max(1, w - tile.width // 2))
    sy = rng.randint(-tile.height // 3, max(1, h - tile.height // 2))
    layer.paste(Image.fromarray(np.maximum(np.asarray(layer.crop((sx, sy, sx + tile.width, sy + tile.height))), np.asarray(tile))), (sx, sy))


def render_hand_alpha(rng, fonts, w, h, scale=1.0, n_text=None, n_strokes=None):
    """손글씨 덮개 (0~1). 2배로 그린 뒤 줄여서 부드러운 가장자리."""
    W2, H2 = w * 2, h * 2
    layer = Image.new('L', (W2, H2), 0)
    d = ImageDraw.Draw(layer)
    for _ in range(rng.randint(1, 6) if n_text is None else n_text):
        _draw_hand_text(rng, fonts, layer, W2, H2, scale * 2)
    for _ in range(rng.randint(0, 5) if n_strokes is None else n_strokes):
        _draw_strokes(rng, d, W2, H2, scale * 2)
    return np.asarray(layer.resize((w, h), Image.BILINEAR)).astype(np.float32) / 255.0


# ---------------------------------------------------------------- 필기구 스타일
INK_STYLES = ['pencil', 'pencil', 'pencil', 'pencil_dark', 'pen_black', 'pen_blue', 'pen_red', 'color_pencil']


def apply_ink(page, alpha, rng, style=None):
    """page: HxWx3 float(0~255), alpha: HxW (0~1) → (새 페이지, 실제로 보이는 진하기)"""
    style = style or rng.choice(INK_STYLES)
    h, w = alpha.shape
    if style.startswith('pencil'):
        g = rng.uniform(55, 115)
        color = np.array([g, g, g * rng.uniform(1.0, 1.08)])
        strength = rng.uniform(0.75, 1.0) if style == 'pencil_dark' else rng.uniform(0.3, 0.8)
        grain = gaussian_filter(np.random.default_rng(rng.randint(0, 2**31)).random((h, w)).astype(np.float32), 0.7)
        grain = (grain - grain.mean()) / (grain.std() + 1e-6)
        a = alpha * strength * np.clip(0.75 + 0.35 * grain, 0.15, 1.2)
        a = gaussian_filter(a, rng.uniform(0.3, 0.8))
    elif style == 'pen_black':
        color = np.array([rng.uniform(10, 40)] * 3)
        a = alpha * rng.uniform(0.85, 1.0)
    elif style == 'pen_blue':
        color = np.array([rng.uniform(20, 60), rng.uniform(40, 80), rng.uniform(120, 190)])
        a = alpha * rng.uniform(0.8, 1.0)
    elif style == 'pen_red':
        color = np.array([rng.uniform(190, 230), rng.uniform(30, 80), rng.uniform(50, 100)])
        a = alpha * rng.uniform(0.8, 1.0)
    else:  # 색연필
        base = rng.choice([(230, 90, 140), (90, 120, 220), (60, 160, 90), (240, 150, 60)])
        color = np.array(base, dtype=np.float32)
        a = alpha * rng.uniform(0.4, 0.8)
    a = np.clip(a, 0, 1)[..., None]
    out = page * (1 - a + a * color / 255.0)       # 곱하기 합성 (인쇄 위에 쓰면 더 진해짐)
    visible = (a[..., 0] * (1 - color.min() / 255.0))
    return out, visible


# ---------------------------------------------------------------- 폰 사진 흉내
def photo_aug(img, rng):
    h, w = img.shape[:2]
    out = img.astype(np.float32)
    # 조명 얼룩 (저해상도 랜덤 → 확대)
    gh, gw = rng.randint(2, 5), rng.randint(2, 5)
    field = np.random.default_rng(rng.randint(0, 2**31)).uniform(rng.uniform(0.55, 0.9), 1.05, (gh, gw)).astype(np.float32)
    field = np.asarray(Image.fromarray(field).resize((w, h), Image.BICUBIC))
    out *= field[..., None]
    # 색온도
    out *= np.array([rng.uniform(0.92, 1.06), rng.uniform(0.95, 1.03), rng.uniform(0.85, 1.05)])[None, None]
    # 흐림 / 노이즈
    if rng.random() < 0.7:
        out = gaussian_filter(out, sigma=(rng.uniform(0.2, 1.3), rng.uniform(0.2, 1.3), 0))
    out += np.random.default_rng(rng.randint(0, 2**31)).normal(0, rng.uniform(0, 5), out.shape)
    out = np.clip(out, 0, 255).astype(np.uint8)
    # JPEG
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, 'JPEG', quality=rng.randint(55, 95))
    return np.asarray(Image.open(io.BytesIO(buf.getvalue())).convert('RGB'))


# ---------------------------------------------------------------- 실제 시험지 (ExamInk-Seg)
class ExamInk:
    """ExamInk-Seg 폴더: data/{train,val}/{source,target}/*.jpg"""

    def __init__(self, root, split='train'):
        self.src_dir = os.path.join(root, 'data', split, 'source')
        self.tgt_dir = os.path.join(root, 'data', split, 'target')
        names = sorted(os.listdir(self.src_dir)) if os.path.isdir(self.src_dir) else []
        self.names = [n for n in names if os.path.exists(os.path.join(self.tgt_dir, n))]

    def __len__(self):
        return len(self.names)

    def load(self, rng, scale):
        n = rng.choice(self.names)
        src = Image.open(os.path.join(self.src_dir, n)).convert('RGB')
        tgt = Image.open(os.path.join(self.tgt_dir, n)).convert('RGB')
        if tgt.size != src.size:
            tgt = tgt.resize(src.size, Image.BILINEAR)
        size = (max(64, int(src.width * scale)), max(64, int(src.height * scale)))
        src, tgt = src.resize(size, Image.BILINEAR), tgt.resize(size, Image.BILINEAR)
        return np.asarray(src), np.asarray(tgt)

    @staticmethod
    def ink_from_pair(src, tgt):
        """원본-정답 차이로 손글씨 덮개(진하기)와 마스크 계산."""
        ls = src.astype(np.float32).mean(axis=2)
        lt = tgt.astype(np.float32).mean(axis=2)
        diff = np.abs(src.astype(np.int16) - tgt.astype(np.int16)).max(axis=2)
        darker = (lt - ls)
        mask = ((diff > 40) & (darker > 12)) | (darker > 45)
        mask = binary_opening(mask, iterations=1)
        alpha = np.clip(darker / np.maximum(lt, 1) * 1.6, 0, 1) * binary_dilation(mask, iterations=1)
        return alpha.astype(np.float32), mask


# ---------------------------------------------------------------- 샘플 1개 만들기
def _random_crop(rng, arrs, size):
    h, w = arrs[0].shape[:2]
    if h < size or w < size:
        ph, pw = max(0, size - h), max(0, size - w)
        arrs = [np.pad(a, ((0, ph), (0, pw)) + ((0, 0),) * (a.ndim - 2), mode='edge') for a in arrs]
        h, w = arrs[0].shape[:2]
    y, x = rng.randint(0, h - size), rng.randint(0, w - size)
    return [a[y:y + size, x:x + size] for a in arrs]


def make_sample(rng, fonts, exam=None, tile=384, region=768):
    """반환: (입력 RGB uint8 tile×tile, 마스크 uint8 0/1)"""
    mode = rng.random()
    use_exam = exam is not None and len(exam) > 0
    scale = rng.uniform(0.75, 1.3)

    if use_exam and mode < 0.3:
        # (a) 실제 학생 손글씨가 있는 시험지 그대로
        src, tgt = exam.load(rng, scale * rng.uniform(0.75, 1.0))
        src, tgt = _random_crop(rng, [src, tgt], region)
        _, mask = ExamInk.ink_from_pair(src, tgt)
        page = src.astype(np.float32)
        hand = mask.astype(bool)
    else:
        # (b) 인쇄 페이지 + 합성 손글씨
        if use_exam and mode < 0.6:
            _, tgt = exam.load(rng, scale * rng.uniform(0.75, 1.0))
            page = _random_crop(rng, [tgt], region)[0].astype(np.float32)
        else:
            page = render_print_page(rng, fonts, region, region).astype(np.float32)
        hand = np.zeros(page.shape[:2], bool)
        n_layers = rng.randint(1, 3)
        for _ in range(n_layers):
            if use_exam and rng.random() < 0.35:
                s2, t2 = exam.load(rng, scale * rng.uniform(0.75, 1.0))
                s2, t2 = _random_crop(rng, [s2, t2], region)
                alpha, _ = ExamInk.ink_from_pair(s2, t2)
            else:
                alpha = render_hand_alpha(rng, fonts, region, region, scale=scale)
            page, visible = apply_ink(page, alpha, rng)
            hand |= visible > 0.07
        page = np.clip(page, 0, 255)

    img = photo_aug(page.astype(np.uint8), rng)
    img = normalize(img)
    x, y = _random_crop(rng, [img, hand.astype(np.uint8)], tile)
    return x, y
