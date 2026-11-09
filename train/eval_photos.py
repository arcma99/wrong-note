"""학습된 모델을 실제 사진에 돌려보기 (앱과 같은 순서: 배경 정리 → 모델 → 손글씨 부분 흰색).
사용법: python eval_photos.py --model work/run1/inkseg.onnx --photos ../샘플사진 --out work/eval
결과: 사진마다 [배경 정리본 | 모델이 찾은 손글씨(빨강) | 지운 결과] 3장 나란히.
"""
import argparse
import glob
import os

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps
from scipy.ndimage import binary_dilation

from wn.normalize import normalize


def run(sess, norm):
    h, w = norm.shape[:2]
    ph, pw = (-h) % 16, (-w) % 16
    x = np.pad(norm, ((0, ph), (0, pw), (0, 0)), mode='constant', constant_values=255)
    x = x.astype(np.float32).transpose(2, 0, 1)[None] / 255.0
    logits = sess.run(None, {'image': x})[0][0, 0, :h, :w]
    return 1 / (1 + np.exp(-logits))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--photos', default='../샘플사진')
    ap.add_argument('--out', default='work/eval')
    ap.add_argument('--max_side', type=int, default=1400)
    ap.add_argument('--th', type=float, default=0.5)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    sess = ort.InferenceSession(a.model, providers=['CPUExecutionProvider'])
    for p in sorted(glob.glob(os.path.join(a.photos, '*.jpg')) + glob.glob(os.path.join(a.photos, '*.png'))):
        im = ImageOps.exif_transpose(Image.open(p)).convert('RGB')  # 폰 회전 정보 반영 (브라우저와 동일)
        s = a.max_side / max(im.size)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        norm = normalize(np.asarray(im))
        prob = run(sess, norm)
        hand = binary_dilation(prob > a.th, iterations=1)
        over = norm.copy()
        over[hand] = (over[hand] * 0.3 + np.array([255, 0, 0]) * 0.7).astype(np.uint8)
        clean = norm.copy()
        clean[hand] = 255
        gap = np.full((norm.shape[0], 10, 3), 128, np.uint8)
        out = np.concatenate([norm, gap, over, gap, clean], axis=1)
        name = os.path.splitext(os.path.basename(p))[0]
        Image.fromarray(out).save(os.path.join(a.out, f'{name}.jpg'), quality=85)
        print('saved', name)


if __name__ == '__main__':
    main()
