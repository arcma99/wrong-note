"""작은 U-Net: 배경 정리된 RGB → 손글씨일 확률(픽셀별).

약 60만 개 파라미터 (fp16 기준 1~2MB) — 아이패드/안드로이드 브라우저에서 돌리기 위해 작게 설계.
입력 크기는 16의 배수여야 합니다 (앱에서 여백을 채워 맞춤).
"""
import torch
import torch.nn as nn
import torch.nn.functional as F


class ConvBlock(nn.Module):
    def __init__(self, cin, cout):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(cin, cout, 3, padding=1, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(inplace=True),
            nn.Conv2d(cout, cout, 3, padding=1, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        return self.net(x)


class InkUNet(nn.Module):
    def __init__(self, chs=(16, 32, 64, 96, 128)):
        super().__init__()
        self.enc = nn.ModuleList()
        cin = 3
        for c in chs:
            self.enc.append(ConvBlock(cin, c))
            cin = c
        self.dec = nn.ModuleList()
        for i in range(len(chs) - 1, 0, -1):
            self.dec.append(ConvBlock(chs[i] + chs[i - 1], chs[i - 1]))
        self.head = nn.Conv2d(chs[0], 1, 1)

    def forward(self, x):
        # x: (N,3,H,W) 0~1
        x = x - 0.5
        skips = []
        for i, block in enumerate(self.enc):
            if i > 0:
                x = F.max_pool2d(x, 2)
            x = block(x)
            skips.append(x)
        skips.pop()
        for block in self.dec:
            s = skips.pop()
            x = F.interpolate(x, scale_factor=2, mode='bilinear', align_corners=False)
            x = block(torch.cat([x, s], dim=1))
        return self.head(x)  # 로짓


def count_params(m):
    return sum(p.numel() for p in m.parameters())
