"""Pin optional Parakeet downloads; never downloads the large model weights."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
MODELS = (
    ("multilingual", "parakeet-tdt-0.6b-v3-coreml", "7dd20fe6b1797d35f5e3307e8b1732d9a178edfe", "JointDecisionv3.mlmodelc"),
    ("english", "parakeet-tdt-0.6b-v2-coreml", "ee09c569f73759e6d44c9bd16766f477b2b36d39", "JointDecision.mlmodelc"),
)


def manifest(identifier, name, revision, joint):
    repository = "FluidInference/" + name
    with urlopen(f"https://huggingface.co/api/models/{repository}/revision/{revision}?blobs=true", timeout=30) as response:
        metadata = json.load(response)
    assert metadata["sha"] == revision
    folders = {"Preprocessor.mlmodelc", "Encoder.mlmodelc", "Decoder.mlmodelc", joint}
    files = [f for f in metadata["siblings"] if f["rfilename"].split("/")[0] in folders or f["rfilename"] == "parakeet_vocab.json"]

    def asset(file):
        path = file["rfilename"]
        if "lfs" in file:
            digest = file["lfs"]["sha256"]
        else:
            assert file["size"] < 2_000_000
            with urlopen(f"https://huggingface.co/{repository}/resolve/{revision}/{path}", timeout=30) as response:
                contents = response.read()
            assert len(contents) == file["size"]
            digest = hashlib.sha256(contents).hexdigest()
        return {"path": path, "bytes": file["size"], "sha256": digest}

    with ThreadPoolExecutor(max_workers=4) as executor:
        assets = list(executor.map(asset, files))
    return {"id": identifier, "repository": repository, "revision": revision, "files": assets}


if __name__ == "__main__":
    models = [manifest(*model) for model in MODELS]
    destination = ROOT / "Sources/ZRemote/Resources/AudioModels.json"
    destination.write_text(json.dumps(models, indent=2) + "\n", encoding="utf-8")
    for model in models:
        print(f'{model["id"]}: {len(model["files"])} files, {sum(f["bytes"] for f in model["files"])} bytes')
