# GitHub 上傳流程

這份文件整理平常把自己的程式碼上傳到專案 GitHub 的基本步驟。

## 1. 進入專案資料夾

```bash
cd /Users/shiyoulun/Documents/專題實作
```

如果是在自己的電腦，請改成自己專案所在的位置。

## 2. 先拉最新版本

在開始上傳前，先把 GitHub 上最新內容拉下來，避免跟其他人的程式衝突。

```bash
git pull
```

如果本機已經有還沒提交的修改，可以用：

```bash
git pull --rebase --autostash
```

這個指令會先暫時收起本機改動，拉完最新版本後再自動套回來。

## 3. 查看目前改了哪些檔案

```bash
git status
```

常見狀態：

```text
modified: 已修改的檔案
untracked: 新增但還沒被 Git 追蹤的檔案
```

## 4. 加入要上傳的檔案

建議只加入這次真的要上傳的檔案，避免把暫存檔、測試檔或別人的改動一起加進去。

例如只上傳某幾個檔案：

```bash
git add backend/routers/review.py
git add backend/main.py
git add student-platform/src/LectureDetail.js
```

如果很確定全部修改都要上傳，才使用：

```bash
git add .
```

## 5. 建立 commit

```bash
git commit -m "這次修改內容"
```

範例：

```bash
git commit -m "Add youtube AI pipeline"
```

或：

```bash
git commit -m "Add personalized review mode"
```

commit 訊息盡量簡短說明這次做了什麼。

## 6. 推上 GitHub

```bash
git push
```

如果是第一次推新的分支，可能需要：

```bash
git push -u origin 分支名稱
```

## 7. 到 GitHub 確認

打開專案 GitHub：

```text
https://github.com/cheng921226/Final-Project
```

確認剛剛修改的檔案有沒有出現在 GitHub 上。

## 常用完整流程

```bash
cd /Users/shiyoulun/Documents/專題實作
git pull --rebase --autostash
git status
git add 要上傳的檔案
git commit -m "這次修改內容"
git push
```

## 注意事項

- 上傳前先 `git pull`，避免版本落後。
- 不確定哪些檔案要上傳時，先用 `git status` 檢查。
- 不要直接亂用 `git add .`，可能會把不需要的檔案一起上傳。
- 如果 pull 或 push 出現 conflict，先不要亂刪檔案，先找組員一起確認。
