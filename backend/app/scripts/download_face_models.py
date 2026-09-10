"""Download pinned, checksum-verified CPU face models for local/Docker deployment."""

import hashlib
import urllib.request
from pathlib import Path

MODELS = {
    "face_detection_yunet_2023mar.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    "face_recognition_sface_2021dec.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
    "MiniFASNetV2.onnx": (
        "https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/MiniFASNetV2.onnx",
        "b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907",
    ),
}


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def main() -> None:
    target = Path(__file__).resolve().parents[2] / "models"
    target.mkdir(parents=True, exist_ok=True)
    for filename, (url, expected) in MODELS.items():
        destination = target / filename
        if destination.is_file() and digest(destination) == expected:
            print(f"verified {filename}")
            continue
        temporary = destination.with_suffix(".download")
        urllib.request.urlretrieve(url, temporary)
        actual = digest(temporary)
        if actual != expected:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"Checksum mismatch for {filename}: {actual}")
        temporary.replace(destination)
        print(f"downloaded {filename}")


if __name__ == "__main__":
    main()
