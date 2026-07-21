# server.py
from typing import List

import cv2
import numpy as np
import mediapipe as mp
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI()

# CORS (RN 앱 테스트용 – 필요 시 IP/도메인 제한해서 사용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발 단계에서만 *
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MediaPipe FaceMesh 초기화
mp_face_mesh = mp.solutions.face_mesh

# 입술 인덱스 (outer lip 기준 – 필요하면 더 추가 가능)
LIP_INDICES = [
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291,   # 윗입술 바깥
    146, 91, 181, 84, 17, 314, 405, 321, 375          # 아랫입술 바깥
]


def bytes_to_image(data: bytes) -> np.ndarray:
    """업로드된 바이트를 OpenCV BGR 이미지로 변환"""
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


@app.get("/")
async def health_check():
    return {"status": "ok", "message": "MediaPipe lip server running"}


@app.post("/detect-lips")
async def detect_lips(file: UploadFile = File(...)):
    """
    이미지에서 입술 랜드마크 검출
    - Request: multipart/form-data, field name = "file"
    - Response:
      {
        "lipPoints": [{ "x": float, "y": float }, ...],
        "faceDetected": bool,
        "width": int,
        "height": int
      }
    """
    try:
        data = await file.read()
        image = bytes_to_image(data)
        if image is None:
            return JSONResponse(
                {"lipPoints": [], "faceDetected": False, "error": "Invalid image data"},
                status_code=400,
            )

        # 원본 크기
        height, width, _ = image.shape

        # (선택) 너무 큰 이미지면 리사이즈해서 성능 향상
        max_side = max(width, height)
        scale = 1.0
        if max_side > 1280:
            scale = 1280.0 / max_side
            image = cv2.resize(
                image,
                (int(width * scale), int(height * scale)),
                interpolation=cv2.INTER_AREA,
            )
            height, width, _ = image.shape

        # MediaPipe FaceMesh 실행
        with mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        ) as face_mesh:
            # BGR → RGB
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            result = face_mesh.process(rgb)

        if not result.multi_face_landmarks:
            return {
                "lipPoints": [],
                "faceDetected": False,
                "width": width,
                "height": height,
            }

        face_landmarks = result.multi_face_landmarks[0].landmark

        lip_points: List[dict] = []
        for idx in LIP_INDICES:
            if idx < len(face_landmarks):
                lm = face_landmarks[idx]
                # MediaPipe는 0~1 정규화 좌표 → 픽셀 단위로 변환
                x = lm.x * width
                y = lm.y * height
                lip_points.append({"x": x, "y": y})

        return {
            "lipPoints": lip_points,
            "faceDetected": True,
            "width": width,
            "height": height,
            "pointCount": len(lip_points),
        }

    except Exception as e:
        return JSONResponse(
            {
                "lipPoints": [],
                "faceDetected": False,
                "error": str(e),
            },
            status_code=500,
        )


if __name__ == "__main__":
    import uvicorn

    # 0.0.0.0 으로 열어야 아이폰/안드 기기에서 접속 가능
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
