"""손글씨 분리 모델 학습 + ONNX 내보내기.
사용법: python train.py --tiles work/tiles --out work/run1 --epochs 30
GPU가 있으면 자동으로 사용 (Colab). 끝나면 out/inkseg.onnx 생성.
"""
import argparse
import glob
import os
import random
import time

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import Dataset, DataLoader

from wn.model import InkUNet, count_params


class Tiles(Dataset):
    def __init__(self, files, train):
        self.files = files
        self.train = train

    def __len__(self):
        return len(self.files)

    def __getitem__(self, i):
        xp = self.files[i]
        yp = xp.replace(os.sep + 'x' + os.sep, os.sep + 'y' + os.sep).replace('/x/', '/y/')[:-4] + '.png'
        x = np.asarray(Image.open(xp).convert('RGB'), dtype=np.float32) / 255.0
        y = (np.asarray(Image.open(yp)) > 127).astype(np.float32)
        if self.train:
            if random.random() < 0.5:   # 좌우 뒤집기
                x, y = x[:, ::-1], y[:, ::-1]
            if random.random() < 0.3:   # 옆으로/거꾸로 찍힌 사진
                k = random.choice([1, 2, 3])
                x, y = np.rot90(x, k), np.rot90(y, k)
            # 밝기/대비 살짝
            x = np.clip((x - 0.5) * random.uniform(0.85, 1.15) + 0.5 + random.uniform(-0.04, 0.04), 0, 1)
        x = torch.from_numpy(np.ascontiguousarray(x.transpose(2, 0, 1)))
        y = torch.from_numpy(np.ascontiguousarray(y))[None]
        return x, y


def loss_fn(logits, y):
    bce = F.binary_cross_entropy_with_logits(logits, y, pos_weight=torch.tensor(2.0, device=y.device))
    p = torch.sigmoid(logits)
    inter = (p * y).sum((1, 2, 3))
    dice = 1 - (2 * inter + 1) / (p.sum((1, 2, 3)) + y.sum((1, 2, 3)) + 1)
    return bce + dice.mean()


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    tp = fp = fn = 0.0
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        p = (torch.sigmoid(model(x)) > 0.5).float()
        tp += (p * y).sum().item()
        fp += (p * (1 - y)).sum().item()
        fn += ((1 - p) * y).sum().item()
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    f1 = 2 * prec * rec / max(1e-9, prec + rec)
    return prec, rec, f1


def export_onnx(model, path):
    model = model.cpu().eval()
    dummy = torch.rand(1, 3, 256, 256)
    torch.onnx.export(
        model, dummy, path, input_names=['image'], output_names=['logits'], opset_version=17,
        dynamic_axes={'image': {2: 'h', 3: 'w'}, 'logits': {2: 'h', 3: 'w'}}, dynamo=False)
    # 검증
    import onnxruntime as ort
    sess = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    out = sess.run(None, {'image': np.random.rand(1, 3, 320, 480).astype(np.float32)})[0]
    print('onnx ok', out.shape, f'{os.path.getsize(path) / 1e6:.2f} MB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles', nargs='+', default=['work/tiles'])
    ap.add_argument('--out', default='work/run1')
    ap.add_argument('--epochs', type=int, default=30)
    ap.add_argument('--batch', type=int, default=16)
    ap.add_argument('--lr', type=float, default=2e-3)
    ap.add_argument('--workers', type=int, default=2)
    ap.add_argument('--resume', default='')
    ap.add_argument('--val_frac', type=float, default=0.05)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    files = sorted(sum([glob.glob(os.path.join(t, 'x', '*.jpg')) for t in args.tiles], []))
    random.Random(0).shuffle(files)
    nval = max(8, int(len(files) * args.val_frac))
    val_files, train_files = files[:nval], files[nval:]
    print(f'train {len(train_files)}  val {len(val_files)}')

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = InkUNet().to(device)
    if args.resume:
        model.load_state_dict(torch.load(args.resume, map_location=device))
        print('resumed from', args.resume)
    print(f'params {count_params(model) / 1e6:.2f}M  device {device}')

    tl = DataLoader(Tiles(train_files, True), batch_size=args.batch, shuffle=True, num_workers=args.workers, drop_last=True, pin_memory=device == 'cuda')
    vl = DataLoader(Tiles(val_files, False), batch_size=args.batch, num_workers=args.workers)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    steps = args.epochs * len(tl)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=max(1, steps), pct_start=0.1)
    scaler = torch.amp.GradScaler('cuda', enabled=device == 'cuda')

    best = -1
    for ep in range(args.epochs):
        model.train()
        t0, tot = time.time(), 0.0
        for x, y in tl:
            x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
            with torch.autocast(device_type=device, dtype=torch.float16, enabled=device == 'cuda'):
                logits = model(x)
            loss = loss_fn(logits.float(), y)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            tot += loss.item()
        prec, rec, f1 = evaluate(model, vl, device)
        print(f'epoch {ep + 1}/{args.epochs}  loss {tot / max(1, len(tl)):.4f}  '
              f'prec {prec:.3f}  rec {rec:.3f}  F1 {f1:.3f}  ({time.time() - t0:.0f}s)', flush=True)
        if f1 > best:
            best = f1
            torch.save(model.state_dict(), os.path.join(args.out, 'best.pt'))
    torch.save(model.state_dict(), os.path.join(args.out, 'last.pt'))

    model.load_state_dict(torch.load(os.path.join(args.out, 'best.pt'), map_location='cpu'))
    export_onnx(model, os.path.join(args.out, 'inkseg.onnx'))
    print('best F1', round(best, 4))


if __name__ == '__main__':
    main()
