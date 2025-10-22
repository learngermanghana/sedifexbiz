"""A lightweight in-memory Firestore replacement used for tests."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional

from .timestamp import Timestamp


@dataclass
class DocumentSnapshot:
    """Represents a point-in-time view of a document."""

    id: str
    _data: Optional[MutableMapping[str, Any]]

    @property
    def exists(self) -> bool:
        return self._data is not None

    def data(self) -> Mapping[str, Any]:
        return dict(self._data or {})


class DocumentReference:
    """A reference to a document inside a collection."""

    def __init__(self, storage: MutableMapping[str, MutableMapping[str, Any]], doc_id: str) -> None:
        self._storage = storage
        self.id = doc_id

    def get(self) -> DocumentSnapshot:
        payload = self._storage.get(self.id)
        return DocumentSnapshot(self.id, payload.copy() if payload is not None else None)

    def set(self, data: Mapping[str, Any], *, merge: bool = False) -> None:
        existing = self._storage.get(self.id)
        if merge and existing is not None:
            existing.update(_normalise_values(data))
        else:
            self._storage[self.id] = _normalise_values(data)

    def update(self, data: Mapping[str, Any]) -> None:
        if self.id not in self._storage:
            raise KeyError(f"Document {self.id} does not exist")
        self._storage[self.id].update(_normalise_values(data))


class Query:
    def __init__(self, storage: MutableMapping[str, MutableMapping[str, Any]], filters: List[Any], limit: Optional[int] = None):
        self._storage = storage
        self._filters = filters
        self._limit = limit

    def where(self, field: str, op: str, value: Any) -> "Query":
        return Query(self._storage, [*self._filters, (field, op, value)], self._limit)

    def limit(self, count: int) -> "Query":
        return Query(self._storage, self._filters, count)

    def get(self) -> List[DocumentSnapshot]:
        documents = []
        for doc_id, payload in self._storage.items():
            if _matches_filters(payload, self._filters):
                documents.append(DocumentSnapshot(doc_id, payload.copy()))
            if self._limit is not None and len(documents) >= self._limit:
                break
        return documents


class CollectionReference:
    def __init__(self, storage: MutableMapping[str, MutableMapping[str, Any]]) -> None:
        self._storage = storage

    def doc(self, doc_id: Optional[str] = None) -> DocumentReference:
        key = doc_id or _auto_id()
        return DocumentReference(self._storage, key)

    def where(self, field: str, op: str, value: Any) -> Query:
        return Query(self._storage, [(field, op, value)])

    def limit(self, count: int) -> Query:
        return Query(self._storage, [], count)


class InMemoryFirestore:
    """Very small Firestore facsimile used for unit tests."""

    def __init__(self) -> None:
        self._collections: Dict[str, MutableMapping[str, MutableMapping[str, Any]]] = {}

    def collection(self, name: str) -> CollectionReference:
        storage = self._collections.setdefault(name, {})
        return CollectionReference(storage)

    def run_transaction(self, func) -> Any:
        return func(SimpleTransaction(self))


class SimpleTransaction:
    """Transaction wrapper for parity with Firebase Functions code."""

    def __init__(self, firestore: InMemoryFirestore) -> None:
        self._firestore = firestore

    def get(self, ref: DocumentReference) -> DocumentSnapshot:
        return ref.get()

    def set(self, ref: DocumentReference, data: Mapping[str, Any]) -> None:
        ref.set(data)

    def update(self, ref: DocumentReference, data: Mapping[str, Any]) -> None:
        ref.update(data)


def _auto_id() -> str:
    from uuid import uuid4

    return uuid4().hex


def _normalise_values(data: Mapping[str, Any]) -> MutableMapping[str, Any]:
    normalised: Dict[str, Any] = {}
    for key, value in data.items():
        if isinstance(value, Timestamp):
            normalised[key] = value
        elif isinstance(value, dict):
            normalised[key] = _normalise_values(value)
        else:
            normalised[key] = value
    return normalised


def _matches_filters(payload: Mapping[str, Any], filters: Iterable[Any]) -> bool:
    for field, op, value in filters:
        candidate = payload.get(field)
        if op == "==" and candidate != value:
            return False
        if op == ">=" and not (candidate >= value):
            return False
        if op == "<=" and not (candidate <= value):
            return False
    return True
