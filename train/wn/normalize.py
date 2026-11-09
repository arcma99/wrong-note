"""배경 정리 (앱의 app/js/clean-worker.js estimateBackground 와 같은 방식).

모델은 항상 '배경이 정리된' 이미지를 입력으로 받습니다.
스캔본(학습 데이터)과 폰 사진(실제 사용)의 조명 차이를 줄이기 위해서입니다.
"""
import numpy as np
from PIL import Image
from scipy.ndimage import maximum_filter, uniform_filter


def estimate_background(img: np.ndarray) -> np.ndarray:
    """img: HxWx3 uint8 → 같은 크기의 배경(종이) 추정치 float32."""
    h, w = img.shape[:2]
    max_side = max(h, w)
    f = max(1, round(max_side / 320))
    lh, lw = -(-h // f), -(-w // f)
    pad = np.pad(img.astype(np.float32), ((0, lh * f - h), (0, lw * f - w), (0, 0)), mode='edge')
    low = pad.reshape(lh, f, lw, f, 3).mean(axis=(1, 3))

    r = max(2, round(max(40, max_side * 0.04) / f))
    rb = max(1, r >> 1)
    bg = np.empty_like(low)
    for c in range(3):
        a = maximum_filter(low[..., c], size=2 * r + 1, mode='nearest')
        a = uniform_filter(a, size=2 * rb + 1, mode='nearest')
        a = uniform_filter(a, size=2 * rb + 1, mode='nearest')
        bg[..., c] = a
    up = np.stack([
        np.asarray(Image.fromarray(bg[..., c]).resize((w, h), Image.BILINEAR))
        for c in range(3)
    ], axis=-1)
    return np.maximum(up, 1.0)


def normalize(img: np.ndarray) -> np.ndarray:
    """종이를 흰색으로, 그림자 제거. 앱의 renderBase()와 같은 결과(근사)."""
    bg = estimate_background(img)
    out = img.astype(np.float32) / bg * 255.0
    out = np.minimum(out, 255.0) * 1.08
    return np.clip(out, 0, 255).astype(np.uint8)
