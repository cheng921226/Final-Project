# 增加課程與 YouTube 連結流程

這份文件說明如何在後端建立一堂課程小節，並使用 YouTube 連結自動產生逐字稿、摘要、知識點、心智圖與題目資料。

目前這個流程主要從 FastAPI 後端操作，不是從前端頁面上傳。

## 1. 啟動後端

進入後端資料夾：

```bash
cd /Users/shiyoulun/Documents/專題實作/backend
```

啟動虛擬環境：

```bash
source venv/bin/activate
```

啟動 FastAPI：

```bash
uvicorn main:app --host 127.0.0.1 --port 8000
```

如果 8000 port 被占用，要先關掉原本的後端，或改用其他 port。

## 2. 打開 FastAPI Docs

瀏覽器打開：

```text
http://127.0.0.1:8000/docs
```

Docs 會列出目前後端已經建立好的 API。

## 3. 確認或新增 course

lecture 一定要掛在某一個 course 底下，所以要先有課程資料。

可以先用：

```text
GET /courses
```

確認目前有哪些課程，記下要使用的 `course_id`。

如果還沒有課程，可以用：

```text
POST /courses
```

範例 Request Body：

```json
{
  "title": "資料結構",
  "teacher_id": 1
}
```

成功後會回傳新課程資料，裡面的 `id` 就是下一步要使用的 `course_id`。

## 4. 新增 lecture

在 Docs 找：

```text
POST /lectures
```

範例 Request Body：

```json
{
  "title": "第一堂課：陣列",
  "media_url": "https://www.youtube.com/watch?v=影片ID",
  "course_id": 1,
  "status": "uploaded"
}
```

欄位說明：

```text
title: 課程小節名稱
media_url: YouTube 影片連結
course_id: 這堂小節屬於哪一門課
status: 目前先填 uploaded
```

成功後會回傳 lecture 資料，請記下回傳的：

```text
id
```

這個 `id` 就是後面要用的 `lecture_id`。

## 5. 使用 YouTube AI Pipeline

在 Docs 找：

```text
POST /lectures/{lecture_id}/ai-pipeline-youtube
```

把 `{lecture_id}` 換成剛剛新增 lecture 回傳的 `id`。

例如 lecture id 是 5，就填：

```text
lecture_id = 5
```

Request Body 範例：

```json
{
  "url": "https://www.youtube.com/watch?v=影片ID",
  "language": "zh",
  "model_size": "tiny",
  "word_timestamps": false,
  "save_to_db": true,
  "skip_existing_transcript": true,
  "skip_existing_ai": true
}
```

欄位說明：

```text
url: YouTube 影片連結
language: 影片語言，中文可以填 zh
model_size: whisper 模型大小，測試先用 tiny 速度比較快
word_timestamps: 是否要逐字時間點，目前 false 就可以
save_to_db: 是否把逐字稿存回資料庫
skip_existing_transcript: 如果已經有逐字稿，就不要重複產生
skip_existing_ai: 如果已經有 AI 生成資料，就不要重複產生
```

按下 Execute 後，後端會自動執行：

```text
YouTube 連結
→ 下載音訊
→ faster-whisper 產生逐字稿與時間段
→ 存入 transcripts
→ Gemini 產生摘要
→ Gemini 產生知識點
→ Gemini 產生心智圖
→ Gemini 產生題目
→ 存回 Supabase
```

## 6. 到資料庫確認

執行成功後，可以到 Supabase 檢查這幾張表：

```text
lectures
transcripts
summaries
knowledge_points
mindmaps
questions
```

確認資料是否都對應到同一個 `lecture_id`。

## 7. 前端查看結果

啟動前端：

```bash
cd /Users/shiyoulun/Documents/專題實作/student-platform
npm start
```

打開：

```text
http://127.0.0.1:3000/
```

進入對應課程與小節後，就可以查看影片、摘要、知識點、心智圖、題目等資料。

## 補充：用 curl 測試

如果不想用 Docs，也可以直接在終端機打：

```bash
curl -X POST "http://127.0.0.1:8000/lectures/5/ai-pipeline-youtube" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=影片ID",
    "language": "zh",
    "model_size": "tiny",
    "word_timestamps": false,
    "save_to_db": true,
    "skip_existing_transcript": true,
    "skip_existing_ai": true
  }'
```

記得把：

```text
/lectures/5/
```

改成真正的 lecture id。
