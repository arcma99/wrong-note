// 필기 지우기 처리 (백그라운드 스레드에서 실행)
//
// 기본: AI 모델(models/inkseg.onnx)이 인쇄 글자와 손글씨를 구분해 손글씨만 지웁니다.
// AI를 쓸 수 없으면 아래 규칙 방식으로 대신합니다.
//
// 1) 배경 정리: 종이의 밝기/색을 추정해 나눠서, 그림자와 누런 기를 없애고 종이를 하얗게 만듭니다.
// 2) 빨간펜: 붉은/분홍 계열의 '가는 선'을 찾아 지웁니다. (넓게 칠해진 인쇄 색은 남김)
// 3) 연필: 인쇄 글자는 아주 진하고, 연필은 회색으로 연합니다.
//    '아주 진한 점'(씨앗) 근처의 획만 남기고, 씨앗과 떨어진 회색 획은 지웁니다.
//    → 인쇄 글자의 부드러운 가장자리는 살고, 연필 풀이만 사라집니다.

let W = 0, H = 0;
let norm = null;      // 배경 정리된 RGB (3바이트/픽셀)
let lum = null;       // 밝기 0~255
let chroma = null;    // 색의 진하기 0~255
let penMask = null;   // 빨간펜으로 판단된 픽셀
let colorPrint = null; // 인쇄된 색(초록 상자, 그림 등)
let redish = null;    // 붉은 계열 픽셀 (AI가 찾은 손글씨를 연필/빨간펜으로 나눌 때 사용)
let aiProb = null;    // AI가 본 '손글씨일 확률' 0~255 (원본 크기)
let aiScale = 1;      // AI를 돌린 축소 비율
let aiPromise = null;

self.onmessage = async (e) => {
  const { type } = e.data;
  if (type === 'init') {
    const { width, height, buffer, useAI } = e.data;
    init(width, height, new Uint8ClampedArray(buffer));
    const base = renderBase();
    self.postMessage({ type: 'base', buffer: base.buffer }, [base.buffer]);
    if (useAI) {
      aiPromise = computeAI()
        .then(() => true)
        .catch((err) => { console.warn('AI 실패, 규칙 방식으로 대신합니다', err); return false; });
      aiPromise.then((ok) => self.postMessage({ type: 'mode', ai: ok }));
    }
  } else if (type === 'run') {
    if (aiPromise) await aiPromise;
    const out = aiProb ? runAI(e.data.params) : run(e.data.params);
    self.postMessage({ type: 'result', id: e.data.id, buffer: out.buffer }, [out.buffer]);
  }
};

// ---------- AI 손글씨 찾기 (기기 안에서 실행, 인터넷 불필요) ----------
const AI_MAX_SIDE = 1200; // 학습 때와 비슷한 크기로 줄여서 판단 (작을수록 빠름)
const TILE = 512, MARGIN = 32; // 메모리를 아끼려고 조각으로 나눠 실행
let session = null;

async function loadSession() {
  if (session) return session;
  importScripts('../vendor/ort/ort.wasm.min.js');
  /* global ort */
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL('../vendor/ort/', self.location.href).href;
  session = await ort.InferenceSession.create(new URL('../models/inkseg.onnx', self.location.href).href,
    { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return session;
}

async function computeAI() {
  const sess = await loadSession();
  const s = Math.min(1, AI_MAX_SIDE / Math.max(W, H));
  const w2 = Math.max(1, Math.round(W * s)), h2 = Math.max(1, Math.round(H * s));
  aiScale = s;

  // 1) 줄이기 (칸 평균), 0~1 값
  const small = new Float32Array(w2 * h2 * 3);
  const cnt = new Float32Array(w2 * h2);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h2 - 1, (y * s) | 0);
    for (let x = 0; x < W; x++) {
      const q = sy * w2 + Math.min(w2 - 1, (x * s) | 0), p = (y * W + x) * 3;
      small[q * 3] += norm[p]; small[q * 3 + 1] += norm[p + 1]; small[q * 3 + 2] += norm[p + 2];
      cnt[q]++;
    }
  }
  for (let q = 0; q < w2 * h2; q++) {
    const k = 1 / (255 * cnt[q]);
    small[q * 3] *= k; small[q * 3 + 1] *= k; small[q * 3 + 2] *= k;
  }

  // 2) 조각마다 모델 실행 (가장자리 여유를 두고 가운데만 사용)
  const prob = new Float32Array(w2 * h2);
  const core = TILE - 2 * MARGIN;
  for (let cy = 0; cy < h2; cy += core) {
    for (let cx = 0; cx < w2; cx += core) {
      const x0 = Math.max(0, cx - MARGIN), y0 = Math.max(0, cy - MARGIN);
      const x1 = Math.min(w2, cx + core + MARGIN), y1 = Math.min(h2, cy + core + MARGIN);
      const tw = x1 - x0, th = y1 - y0;
      const pw = Math.ceil(tw / 16) * 16, ph = Math.ceil(th / 16) * 16;
      const input = new Float32Array(3 * pw * ph).fill(1); // 빈 곳은 흰 종이
      const plane = pw * ph;
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const q = ((y0 + y) * w2 + x0 + x) * 3, o = y * pw + x;
        input[o] = small[q]; input[plane + o] = small[q + 1]; input[2 * plane + o] = small[q + 2];
      }
      const res = await sess.run({ image: new ort.Tensor('float32', input, [1, 3, ph, pw]) });
      const logits = res.logits.data;
      const ex = Math.min(w2, cx + core), ey = Math.min(h2, cy + core);
      for (let y = cy; y < ey; y++) for (let x = cx; x < ex; x++) {
        prob[y * w2 + x] = 1 / (1 + Math.exp(-logits[(y - y0) * pw + (x - x0)]));
      }
    }
  }

  // 3) 원래 크기로 늘리기 (양선형)
  aiProb = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h2 - 1, Math.max(0, (y + 0.5) * s - 0.5));
    const y0 = fy | 0, y1 = Math.min(h2 - 1, y0 + 1), dy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w2 - 1, Math.max(0, (x + 0.5) * s - 0.5));
      const x0 = fx | 0, x1 = Math.min(w2 - 1, x0 + 1), dx = fx - x0;
      const v = (prob[y0 * w2 + x0] * (1 - dx) + prob[y0 * w2 + x1] * dx) * (1 - dy)
              + (prob[y1 * w2 + x0] * (1 - dx) + prob[y1 * w2 + x1] * dx) * dy;
      aiProb[y * W + x] = v * 255;
    }
  }
}

// params: { pencil, pen, strength 0~100 }
function runAI({ pencil, pen, strength }) {
  const N = W * H;
  // 강도 50 → 확률 0.5 기준, 강할수록 애매한 것도 지움
  const th = Math.round((0.75 - strength * 0.005) * 255);
  let hand = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (aiProb[p] > th) hand[p] = 1;
  // 획 가장자리의 옅은 테두리까지 넓히되, AI가 '확실히 손글씨 아님'으로 본 곳(옆의 인쇄 글자)은 남김
  hand = dilate(hand, W, H, Math.max(1, Math.round(1 / aiScale)));
  const low = Math.round(th * 0.3);
  for (let p = 0; p < N; p++) if (hand[p] && aiProb[p] < low) hand[p] = 0;

  const out = new Uint8ClampedArray(N * 4);
  for (let p = 0; p < N; p++) {
    const red = redish[p] === 1;
    const remove = hand[p] === 1 && (red ? pen : pencil);
    const o = p * 4;
    if (remove) {
      out[o] = out[o + 1] = out[o + 2] = 255;
    } else {
      out[o] = levels(norm[p * 3]);
      out[o + 1] = levels(norm[p * 3 + 1]);
      out[o + 2] = levels(norm[p * 3 + 2]);
    }
    out[o + 3] = 255;
  }
  return out;
}

// ---------- 공통: 이진 마스크 팽창/침식 (정사각형 창, 누적합으로 O(N)) ----------
function boxPass(src, w, h, r, horizontal, mode) {
  const dst = new Uint8Array(w * h);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const pre = new Int32Array(len + 1);
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < len; i++) {
      const idx = horizontal ? l * w + i : i * w + l;
      pre[i + 1] = pre[i] + src[idx];
    }
    for (let i = 0; i < len; i++) {
      const a = Math.max(0, i - r), b = Math.min(len - 1, i + r);
      const sum = pre[b + 1] - pre[a];
      const idx = horizontal ? l * w + i : i * w + l;
      dst[idx] = mode === 'dilate' ? (sum > 0 ? 1 : 0) : (sum === b - a + 1 ? 1 : 0);
    }
  }
  return dst;
}
const dilate = (m, w, h, r) => (r <= 0 ? m : boxPass(boxPass(m, w, h, r, true, 'dilate'), w, h, r, false, 'dilate'));
const erode = (m, w, h, r) => (r <= 0 ? m : boxPass(boxPass(m, w, h, r, true, 'erode'), w, h, r, false, 'erode'));

// 주변 (2r+1)² 칸 안에 씨앗이 minCount개 이상 있는 씨앗만 남김
function minClusterFilter(m, w, h, r, minCount) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!m[p]) continue;
      let c = 0;
      for (let dy = -r; dy <= r && c < minCount; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && m[yy * w + xx]) c++;
        }
      }
      if (c >= minCount) out[p] = 1;
    }
  }
  return out;
}

// 씨앗에서 출발해 allow 영역을 따라 maxDist 픽셀까지만 번져나가기 (8방향 BFS)
function grow(seed, allow, w, h, maxDist) {
  const N = w * h;
  const dist = new Uint8Array(N).fill(255);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  for (let p = 0; p < N; p++) if (seed[p]) { dist[p] = 0; queue[tail++] = p; }
  while (head < tail) {
    const p = queue[head++];
    const d = dist[p] + 1;
    if (d > maxDist) continue;
    const x = p % w, y = (p / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const q = yy * w + xx;
        if (allow[q] && dist[q] > d) { dist[q] = d; queue[tail++] = q; }
      }
    }
  }
  const out = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (dist[p] !== 255) out[p] = 1;
  return out;
}

// ---------- 배경 추정 ----------
function estimateBackground(src, w, h) {
  const maxSide = Math.max(w, h);
  const f = Math.max(1, Math.round(maxSide / 320));
  const lw = Math.ceil(w / f), lh = Math.ceil(h / f);
  const ch = [new Float32Array(lw * lh), new Float32Array(lw * lh), new Float32Array(lw * lh)];

  // 1) 칸별 평균으로 축소
  const cnt = new Float32Array(lw * lh);
  for (let y = 0; y < h; y++) {
    const ly = (y / f) | 0;
    for (let x = 0; x < w; x++) {
      const li = ly * lw + ((x / f) | 0);
      const i = (y * w + x) * 4;
      ch[0][li] += src[i]; ch[1][li] += src[i + 1]; ch[2][li] += src[i + 2];
      cnt[li]++;
    }
  }
  for (let c = 0; c < 3; c++) for (let i = 0; i < lw * lh; i++) ch[c][i] /= cnt[i];

  // 2) 최대값 필터(글자를 지우고 종이만 남김) → 3) 흐리게
  const R = Math.max(2, Math.round(Math.max(40, maxSide * 0.04) / f));
  const out = [];
  for (let c = 0; c < 3; c++) {
    let a = maxFilter(ch[c], lw, lh, R);
    a = boxBlur(a, lw, lh, Math.max(1, R >> 1));
    a = boxBlur(a, lw, lh, Math.max(1, R >> 1));
    out.push(a);
  }
  return { bg: out, lw, lh, f };
}

function maxFilter(a, w, h, r) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (a[y * w + k] > m) m = a[y * w + k];
    t[y * w + x] = m;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let m = 0;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (t[k * w + x] > m) m = t[k * w + x];
    o[y * w + x] = m;
  }
  return o;
}

function boxBlur(a, w, h, r) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) { s += a[y * w + k]; n++; }
    t[y * w + x] = s / n;
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) { s += t[k * w + x]; n++; }
    o[y * w + x] = s / n;
  }
  return o;
}

function sampleBg(bg, lw, lh, f, x, y) {
  // 양선형 보간
  const fx = Math.min(lw - 1, Math.max(0, (x + 0.5) / f - 0.5));
  const fy = Math.min(lh - 1, Math.max(0, (y + 0.5) / f - 0.5));
  const x0 = fx | 0, y0 = fy | 0;
  const x1 = Math.min(lw - 1, x0 + 1), y1 = Math.min(lh - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0;
  const a = bg[y0 * lw + x0], b = bg[y0 * lw + x1], c = bg[y1 * lw + x0], d = bg[y1 * lw + x1];
  return (a * (1 - dx) + b * dx) * (1 - dy) + (c * (1 - dx) + d * dx) * dy;
}

// ---------- 준비 ----------
function init(w, h, src) {
  W = w; H = h;
  const N = w * h;
  const { bg, lw, lh, f } = estimateBackground(src, w, h);

  norm = new Uint8ClampedArray(N * 3);
  lum = new Uint8Array(N);
  chroma = new Uint8Array(N);
  const penCand = new Uint8Array(N);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4;
      const br = Math.max(1, sampleBg(bg[0], lw, lh, f, x, y));
      const bgG = Math.max(1, sampleBg(bg[1], lw, lh, f, x, y));
      const bb = Math.max(1, sampleBg(bg[2], lw, lh, f, x, y));
      const r = Math.min(255, (src[i] / br) * 255);
      const g = Math.min(255, (src[i + 1] / bgG) * 255);
      const b = Math.min(255, (src[i + 2] / bb) * 255);
      norm[p * 3] = r; norm[p * 3 + 1] = g; norm[p * 3 + 2] = b;
      lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const c = mx - mn;
      chroma[p] = c;

      // 빨강~분홍 색상 판단
      if (c > 32) {
        let hue;
        if (mx === r) hue = 60 * (((g - b) / c) % 6);
        else if (mx === g) hue = 60 * ((b - r) / c + 2);
        else hue = 60 * ((r - g) / c + 4);
        if (hue < 0) hue += 360;
        // 갈색(약 25~40도)은 인쇄 그림에 흔하므로 제외
        if (hue <= 20 || hue >= 280) penCand[p] = 1;
      }
    }
  }

  // 넓게 칠해진 붉은 인쇄 영역(제목 띠 등)은 '가는 선'이 아니므로 보호
  const maxSide = Math.max(w, h);
  // 굵은 색연필 획도 '선'으로 보도록 넉넉하게 (인쇄된 띠/면은 이보다 훨씬 넓음)
  const rOpen = Math.max(6, Math.round(maxSide / 110));
  // 넓은 면의 안쪽(침식 후 남는 곳)에서 출발해 같은 색을 따라 가장자리까지 복원
  const wideCore = erode(penCand, w, h, rOpen);
  const wide = grow(wideCore, penCand, w, h, Math.min(250, rOpen * 2 + 3));
  penMask = new Uint8Array(N);
  colorPrint = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (penCand[p] && !wide[p]) penMask[p] = 1;
    else if (chroma[p] > 16 || wide[p]) colorPrint[p] = 1;
  }
  // 빨간펜 가장자리의 옅은 분홍 테두리까지 포함
  penMask = dilate(penMask, w, h, 1);
  redish = dilate(penCand, w, h, 2);
}

function levels(v) {
  // 종이를 완전한 흰색으로 (밝은 쪽 조금 당김)
  return Math.min(255, v * 1.08);
}

// 아무것도 지우지 않고 배경만 정리한 이미지 (복원 브러시용)
function renderBase() {
  const N = W * H;
  const out = new Uint8ClampedArray(N * 4);
  for (let p = 0; p < N; p++) {
    out[p * 4] = levels(norm[p * 3]);
    out[p * 4 + 1] = levels(norm[p * 3 + 1]);
    out[p * 4 + 2] = levels(norm[p * 3 + 2]);
    out[p * 4 + 3] = 255;
  }
  return out;
}

// params: { pencil: bool, pen: bool, tDark: 0~255 }
function run({ pencil, pen, tDark }) {
  const N = W * H;
  const removePen = pen ? penMask : null;

  // 진한 '씨앗' 점에서 출발해, 이어진 획(잉크)을 따라 일정 거리까지 남김
  //  → 인쇄 글자는 획 전체가 남고, 씨앗이 없는 연한 연필 획은 사라짐
  let near = null;
  if (pencil) {
    const seed = new Uint8Array(N);
    const ink = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
      if (removePen && removePen[p]) continue;
      if (lum[p] < 215) ink[p] = 1;
      if (lum[p] < tDark && chroma[p] < 60) seed[p] = 1;
    }
    const reach = Math.max(6, Math.round(Math.max(W, H) / 120));
    // 연필 속 우연히 진한 점 1~2개는 씨앗에서 제외 (진한 점이 모여 있어야 인쇄로 봄)
    const solidSeed = minClusterFilter(seed, W, H, 1, 4);
    near = grow(solidSeed, ink, W, H, reach);
  }

  const out = new Uint8ClampedArray(N * 4);
  for (let p = 0; p < N; p++) {
    let keep;
    if (removePen && removePen[p]) keep = false;
    else if (!pencil) keep = true;
    else keep = near[p] === 1 || colorPrint[p] === 1;

    const o = p * 4;
    if (keep) {
      out[o] = levels(norm[p * 3]);
      out[o + 1] = levels(norm[p * 3 + 1]);
      out[o + 2] = levels(norm[p * 3 + 2]);
    } else {
      out[o] = out[o + 1] = out[o + 2] = 255;
    }
    out[o + 3] = 255;
  }
  return out;
}
