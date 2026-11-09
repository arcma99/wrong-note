"""합성 샘플 미리보기: 입력과 마스크(빨간색)를 나란히 붙여 한 장으로 저장.
사용법: python preview_synth.py --exam work/examink --out work/preview.jpg --n 8
"""
import argparse
import random

import numpy as np
from PIL import Image

from wn.synth import Fonts, ExamInk, make_sample

ap = argparse.ArgumentParser()
ap.add_argument('--exam', default='')
ap.add_argument('--fonts', default='work/fonts')
ap.add_argument('--out', default='work/preview.jpg')
ap.add_argument('--n', type=int, default=8)
ap.add_argument('--seed', type=int, default=1)
a = ap.parse_args()

rng = random.Random(a.seed)
fonts = Fonts(a.fonts)
exam = ExamInk(a.exam) if a.exam else None
rows = []
for i in range(a.n):
    x, y = make_sample(rng, fonts, exam)
    over = x.copy()
    over[y > 0] = (over[y > 0] * 0.3 + np.array([255, 0, 0]) * 0.7).astype(np.uint8)
    rows.append(np.concatenate([x, np.full((x.shape[0], 8, 3), 128, np.uint8), over], axis=1))
grid = np.concatenate([np.concatenate(rows[i:i + 2], axis=1) for i in range(0, len(rows), 2)], axis=0)
Image.fromarray(grid).save(a.out, quality=88)
print('saved', a.out, grid.shape)
