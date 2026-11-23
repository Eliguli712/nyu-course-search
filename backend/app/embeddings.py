"""
Text embeddings via nomic-ai/nomic-embed-text-v1.

The Nomic model requires task-specific prefixes to achieve its published accuracy:
  - Documents being indexed: "search_document: <text>"
  - Query strings at search time: "search_query: <text>"

Without these prefixes the model still works but quality degrades.
See: https://huggingface.co/nomic-ai/nomic-embed-text-v1
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import torch
from transformers import AutoTokenizer, AutoModel

from .config import settings
from .models import EMBEDDING_DIM

# Task prefixes required by nomic-embed-text-v1
_DOC_PREFIX   = "search_document: "
_QUERY_PREFIX = "search_query: "


def _mean_pool(last_hidden_state: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
    mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
    summed = torch.sum(last_hidden_state * mask, dim=1)
    counts = torch.clamp(mask.sum(dim=1), min=1e-9)
    return summed / counts


@lru_cache(maxsize=1)
def get_embedder():
    tokenizer = AutoTokenizer.from_pretrained(
        settings.embedding_model_id, trust_remote_code=True
    )
    model = AutoModel.from_pretrained(
        settings.embedding_model_id, trust_remote_code=True
    )
    model.eval()
    return tokenizer, model


@torch.inference_mode()
def _embed_raw(texts: list[str], device: str) -> list[list[float]]:
    """Embed a list of already-prefixed strings."""
    tokenizer, model = get_embedder()
    model = model.to(device)

    out: list[list[float]] = []
    bs = settings.embedding_batch_size

    for i in range(0, len(texts), bs):
        batch = texts[i : i + bs]
        enc = tokenizer(
            batch,
            padding=True,
            truncation=True,
            max_length=settings.embedding_max_length,
            return_tensors="pt",
        )
        enc = {k: v.to(device) for k, v in enc.items()}
        outputs = model(**enc)
        pooled = _mean_pool(outputs.last_hidden_state, enc["attention_mask"])
        pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
        arr = pooled.detach().cpu().numpy().astype(np.float32)
        if arr.shape[1] != EMBEDDING_DIM:
            raise RuntimeError(
                f"Embedding dim mismatch: got {arr.shape[1]}, expected {EMBEDDING_DIM}. "
                "Update EMBEDDING_DIM in models.py to match the chosen model."
            )
        out.extend(arr.tolist())
    return out


def _device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed course documents for storage (uses search_document: prefix)."""
    prefixed = [_DOC_PREFIX + t for t in texts]
    return _embed_raw(prefixed, _device())


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed query strings at search time (uses search_query: prefix).

    Named `embed_texts` for backward compatibility with callers in cache.py / main.py.
    """
    prefixed = [_QUERY_PREFIX + t for t in texts]
    return _embed_raw(prefixed, _device())
