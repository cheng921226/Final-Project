import json
import os
import sys
from pathlib import Path
from faster_whisper import WhisperModel

os.environ['HF_HUB_OFFLINE'] = '1'
out = Path(__file__).parent
model = WhisperModel('small', device='cpu', compute_type='int8', cpu_threads=6, local_files_only=True)
for source in sys.argv[1:]:
    source = Path(source)
    target = out / (source.stem.replace(':', '-') + '.transcript.jsonl')
    if target.exists():
        print('EXISTS', target, flush=True)
        continue
    print('START', source.name, flush=True)
    segments, info = model.transcribe(str(source), language='zh', beam_size=5, vad_filter=True,
        initial_prompt='以下是台灣大學專題研究會議，使用繁體中文。討論 AI 輔助學習平台、知識點、個人化補強、教師、學生、簡報、海報、學習成效。')
    with target.open('w') as f:
        f.write(json.dumps({'source': str(source), 'duration': info.duration, 'model': 'faster-whisper-small', 'note': 'Automatic transcription; speakers not identified.'}, ensure_ascii=False)+'\n')
        for s in segments:
            f.write(json.dumps({'start': round(s.start,2), 'end': round(s.end,2), 'text': s.text, 'avg_logprob': round(s.avg_logprob,3)}, ensure_ascii=False)+'\n')
            f.flush()
            print(f'{source.name} [{s.start/60:.1f}/{info.duration/60:.1f}m] {s.text}', flush=True)
    print('DONE', source.name, flush=True)
