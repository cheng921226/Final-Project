# Final-Project
大四畢業專題

## 後端操作方法
### 進入後端資料夾
```bash
cd backend
```
### 第一次使用
1.在backend加入.env檔

2.建立虛擬環境
```bash
python -m venv venv
```
或
```bash
python3 -m venv venv
```
### 啟動虛擬環境
Windows(CMD)
```bash
.\venv\Scripts\activate.bat
```
Windows(PowerShell)
```bash
.\venv\Scripts\activate.ps1 	     
```
Mac/Linux 
```bash
source venv/bin/activate
```
啟動後會看到前面有(venv)
### 安裝套件
```bash
pip install -r requirements.txt
```
或
```bash
pip3 install -r requirements.txt
```
### 啟動 FastAPI
```bash
uvicorn main:app --reload
```
