"""Colab 학습 노트북 만들기: 이 폴더의 코드를 노트북 안에 그대로 넣어 하나의 파일로 만듭니다.
사용법: python build_notebook.py  → colab_train.ipynb
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = ['wn/__init__.py', 'wn/normalize.py', 'wn/model.py', 'wn/synth.py',
         'make_dataset.py', 'train.py', 'eval_photos.py']


def md(text):
    return {'cell_type': 'markdown', 'metadata': {}, 'source': text.strip().splitlines(keepends=True)}


def code(text):
    return {'cell_type': 'code', 'metadata': {}, 'execution_count': None, 'outputs': [],
            'source': text.strip().splitlines(keepends=True)}


cells = [md('''
# 오답노트 · 손글씨 지우기 AI 학습

**실행 방법**
1. 위 메뉴 **런타임 → 런타임 유형 변경 → T4 GPU** 선택 후 저장
2. **런타임 → 모두 실행** (Ctrl+F9)
3. 약 1시간 30분 뒤 마지막 칸에서 `inkseg.onnx` 파일이 자동으로 다운로드됩니다
4. 받은 파일을 PC의 `wrong_question/train/` 폴더에 넣어주세요

중간에 창을 닫으면 학습이 멈춥니다. 탭은 열어둔 채로 다른 일을 하셔도 됩니다.
'''),
         code('!nvidia-smi -L || echo "GPU가 없습니다 — 런타임 유형을 T4 GPU로 바꿔주세요"'),
         md('## 1. 코드 준비'),
         code('!mkdir -p wn work')]

for rel in FILES:
    with open(os.path.join(HERE, rel), encoding='utf-8') as f:
        cells.append(code(f'%%writefile {rel}\n{f.read()}'))

cells += [
    code('!pip -q install onnx onnxruntime onnxscript huggingface_hub'),
    md('## 2. 공개 데이터 받기 (ExamInk-Seg, 약 2.5GB · 3~5분)'),
    code('''
from huggingface_hub import snapshot_download
snapshot_download('ynyg/ExamInk-Seg', repo_type='dataset', local_dir='work/examink',
                  allow_patterns=['data/train/source/*', 'data/train/target/*'])
import os; print(len(os.listdir('work/examink/data/train/source')), '장')
'''),
    md('## 3. 학습 조각 만들기 (약 10,000개 · 50~70분)'),
    code('!python make_dataset.py --exam work/examink --out work/tiles --n 10000'),
    md('## 4. 학습 (약 15~25분)'),
    code('!python train.py --tiles work/tiles --out work/run1 --epochs 30 --batch 32 --workers 2'),
    md('## 5. 결과 파일 받기'),
    code('''
from google.colab import files
files.download('work/run1/inkseg.onnx')
'''),
]



def save(name, cells):
    nb = {'cells': cells, 'metadata': {'accelerator': 'GPU', 'colab': {'provenance': []},
                                       'kernelspec': {'display_name': 'Python 3', 'name': 'python3'}},
          'nbformat': 4, 'nbformat_minor': 0}
    out = os.path.join(HERE, name)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(nb, f, ensure_ascii=False, indent=1)
    print('wrote', out, len(cells), 'cells')


save('colab_train.ipynb', cells)

# ---- 빠른 버전: PC에서 미리 만든 학습 조각(tiles.zip)을 구글 드라이브에서 가져와 학습만 (GPU 약 20~30분)
fast = [md('''
# 오답노트 · 손글씨 지우기 AI 학습 (빠른 버전)

학습 조각은 PC에서 미리 만들어 두었습니다. 여기서는 GPU로 **학습만** 합니다.

**실행 방법**
1. 구글 드라이브의 **내 드라이브** 맨 위에 `tiles.zip` 을 올려두기
2. 위 메뉴 **런타임 → 런타임 유형 변경 → T4 GPU** 선택 후 저장
3. **런타임 → 모두 실행** (Ctrl+F9) → 드라이브 연결을 물으면 **허용**
4. 약 30분 뒤 `inkseg.onnx` 파일이 자동으로 다운로드됩니다 → PC의 `wrong_question/train/` 폴더에 넣기
'''),
        code('!nvidia-smi -L || echo "GPU가 없습니다 — 런타임 유형을 T4 GPU로 바꿔주세요"'),
        code('!mkdir -p wn work')]
for rel in ['wn/__init__.py', 'wn/model.py', 'train.py']:
    with open(os.path.join(HERE, rel), encoding='utf-8') as f:
        fast.append(code(f'%%writefile {rel}\n{f.read()}'))
fast += [
    code('!pip -q install onnx onnxruntime onnxscript'),
    md('## 학습 조각 가져오기 (드라이브 → 약 2~5분)'),
    code('''
from google.colab import drive
drive.mount('/content/drive')
!cp /content/drive/MyDrive/tiles.zip /content/ && unzip -q -o /content/tiles.zip -d work/
import os; print(len(os.listdir('work/tiles/x')), '조각')
'''),
    md('## 학습 (약 15~25분)'),
    code('!python train.py --tiles work/tiles --out work/run1 --epochs 30 --batch 32 --workers 2'),
    md('## 결과 파일 받기'),
    code('''
from google.colab import files
files.download('work/run1/inkseg.onnx')
'''),
]
save('colab_train_fast.ipynb', fast)
