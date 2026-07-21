# BloomDent FastAPI Server

MediaPipe를 사용한 입술 랜드마크 검출 FastAPI 서버입니다.

## 설치 및 실행

### 1. 가상 환경 생성

```bash
python3 -m venv venv
```

### 2. 가상 환경 활성화

**macOS/Linux:**
```bash
source venv/bin/activate
```

**Windows:**
```bash
venv\Scripts\activate
```

### 3. 패키지 설치

```bash
pip install -r requirements.txt
```

### 4. 서버 실행

```bash
python server.py
```

또는

```bash
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

서버는 `http://0.0.0.0:8000`에서 실행됩니다.

## API 엔드포인트

- `GET /`: 헬스 체크
- `POST /detect-lips`: 이미지에서 입술 랜드마크 검출

