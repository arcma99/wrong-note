"""학습용 조각 미리 만들어 두기 (여러 CPU로 병렬).
사용법: python make_dataset.py --exam work/examink --out work/tiles --n 8000
결과: out/x/00001.jpg (입력), out/y/00001.png (손글씨 마스크 0/255)
"""
import argparse
import os
import random
from multiprocessing import Pool, cpu_count

import numpy as np
from PIL import Image

from wn.synth import Fonts, ExamInk, make_sample

_fonts = None
_exam = None
_args = None


def _init(args):
    global _fonts, _exam, _args
    _args = args
    _fonts = Fonts(args.fonts)
    _exam = ExamInk(args.exam) if args.exam else None


def _work(i):
    rng = random.Random(_args.seed * 1_000_003 + i)
    np.random.seed((_args.seed * 7919 + i) % (2**31))
    x, y = make_sample(rng, _fonts, _exam, tile=_args.tile)
    Image.fromarray(x).save(os.path.join(_args.out, 'x', f'{i:06d}.jpg'), quality=95)
    Image.fromarray((y * 255).astype(np.uint8)).save(os.path.join(_args.out, 'y', f'{i:06d}.png'))
    return i


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--exam', default='')
    ap.add_argument('--fonts', default='work/fonts')
    ap.add_argument('--out', default='work/tiles')
    ap.add_argument('--n', type=int, default=8000)
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--tile', type=int, default=384)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--workers', type=int, default=max(1, cpu_count()))
    args = ap.parse_args()
    os.makedirs(os.path.join(args.out, 'x'), exist_ok=True)
    os.makedirs(os.path.join(args.out, 'y'), exist_ok=True)
    Fonts(args.fonts)  # 폰트 미리 받기
    with Pool(args.workers, initializer=_init, initargs=(args,)) as pool:
        for k, _ in enumerate(pool.imap_unordered(_work, range(args.start, args.start + args.n), chunksize=8)):
            if (k + 1) % 200 == 0:
                print(f'{k + 1}/{args.n}', flush=True)
    print('done', args.n)
