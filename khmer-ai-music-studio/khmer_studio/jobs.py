"""Background jobs with REAL status.

A job is queued -> running -> succeeded | failed | cancelled. While running it reports a stage, a
Khmer message and (when the engine knows it) a true progress fraction. Every change is written to
`projects/<id>/jobs/<job_id>.json`, so a page refresh — or a server restart — never loses the truth.
Two single-worker queues: "engine" (music models: one at a time, GPU safe) and "media" (FFmpeg work).
"""
from __future__ import annotations

import logging
import queue
import threading
import time
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .errors import Cancelled, StudioError
from .storage import ProjectStore
from .util import atomic_write_json, new_id, now_iso, read_json

log = logging.getLogger("khmer_studio.jobs")

STAGE_MESSAGES = {
    "queued": "កំពុងរង់ចាំក្នុងជួរ",
    "starting": "កំពុងចាប់ផ្ដើម",
    "engine_check": "កំពុងពិនិត្យការភ្ជាប់ទៅម៉ូដែល",
    "engine_loading": "កំពុងផ្ទុកម៉ូដែល",
    "submitting": "កំពុងផ្ញើទៅម៉ូដែល",
    "generating": "កំពុងបង្កើតសំឡេង",
    "decoding": "កំពុងបំលែងជាសំឡេង",
    "downloading": "កំពុងទាញយកឯកសារសំឡេង",
    "encoding": "កំពុងបំលែងឯកសារ",
    "analyzing": "កំពុងពិនិត្យសំឡេង",
    "saving": "កំពុងរក្សាទុក",
    "mixing": "កំពុងលាយសំឡេងច្រៀង និងភ្លេង",
    "rendering": "កំពុងបង្កើតវីដេអូ MP4",
    "done": "រួចរាល់",
    "failed": "មានកំហុស",
    "cancelled": "បានបោះបង់",
}

ACTIVE = {"queued", "running"}


@dataclass
class JobCtx:
    job_id: str
    project_id: str
    kind: str
    params: Dict[str, Any]
    workdir: Path
    _mgr: "JobManager"

    def progress(self, fraction: Optional[float], stage: str, message: Optional[str] = None) -> None:
        self._mgr._update(self.job_id, progress=fraction, stage=stage, message=message or STAGE_MESSAGES.get(stage, stage))

    def log(self, text: str) -> None:
        self._mgr._log(self.job_id, text)

    def cancelled(self) -> bool:
        return self._mgr.is_cancel_requested(self.job_id)


class JobManager:
    def __init__(self, store: ProjectStore) -> None:
        self.store = store
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._runners: Dict[str, Callable[[JobCtx], Dict[str, Any]]] = {}
        self._queues: Dict[str, "queue.Queue[Optional[str]]"] = {"engine": queue.Queue(), "media": queue.Queue()}
        self._order: Dict[str, List[str]] = {"engine": [], "media": []}
        self._lock = threading.RLock()
        self._last_write: Dict[str, float] = {}
        self._threads: List[threading.Thread] = []
        self._stopping = False

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        self._recover()
        for name in self._queues:
            t = threading.Thread(target=self._worker, args=(name,), name=f"job-worker-{name}", daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        self._stopping = True
        for q in self._queues.values():
            q.put(None)

    def _recover(self) -> None:
        """Load old job files. Anything that was queued/running when the app stopped is marked failed."""
        if not self.store.root.is_dir():
            return
        for pdir in self.store.root.iterdir():
            jdir = pdir / "jobs"
            if not jdir.is_dir():
                continue
            for jf in jdir.glob("*.json"):
                job = read_json(jf)
                if not isinstance(job, dict) or "id" not in job:
                    continue
                if job.get("status") in ACTIVE:
                    job["status"] = "failed"
                    job["stage"] = "failed"
                    job["message"] = "កម្មវិធីត្រូវបានបិទ ឬចាប់ផ្ដើមឡើងវិញ ពេលការងារនេះកំពុងដំណើរការ"
                    job["error"] = {
                        "code": "interrupted",
                        "message": "ការងារត្រូវបានរំខាន (កម្មវិធីបិទ/ចាប់ផ្ដើមឡើងវិញ) — សូមចុចធ្វើម្ដងទៀត",
                        "detail": None, "hint": None,
                    }
                    job["finished_at"] = now_iso()
                    atomic_write_json(jf, job)
                self._jobs[job["id"]] = job

    # ------------------------------------------------------------------ public API
    def submit(
        self,
        project_id: str,
        kind: str,
        runner: Callable[[JobCtx], Dict[str, Any]],
        params: Optional[Dict[str, Any]] = None,
        queue_name: str = "engine",
        label: str = "",
    ) -> Dict[str, Any]:
        job_id = new_id("j")
        job = {
            "id": job_id, "project_id": project_id, "kind": kind, "label": label,
            "status": "queued", "stage": "queued", "message": STAGE_MESSAGES["queued"], "progress": None,
            "created_at": now_iso(), "started_at": None, "finished_at": None,
            "params": params or {}, "result": None, "error": None, "log": [],
            "cancel_requested": False, "queue": queue_name,
        }
        with self._lock:
            self._jobs[job_id] = job
            self._runners[job_id] = runner
            self._order[queue_name].append(job_id)
        self._persist(job, force=True)
        self._queues[queue_name].put(job_id)
        return self.get(job_id)

    def get(self, job_id: str) -> Dict[str, Any]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise StudioError("not_found", "រកមិនឃើញការងារនេះ", status=404)
            snap = dict(job)
            snap["server_now"] = now_iso()  # lets the browser show correct elapsed time even if its clock is off
            snap["log"] = list(job["log"][-60:])
            q = job.get("queue", "engine")
            if job["status"] == "queued" and job_id in self._order[q]:
                snap["queue_position"] = self._order[q].index(job_id) + 1
            else:
                snap["queue_position"] = None
            return snap

    def list_for_project(self, project_id: str, limit: int = 30) -> List[Dict[str, Any]]:
        with self._lock:
            ids = [j["id"] for j in self._jobs.values() if j["project_id"] == project_id]
        jobs = [self.get(i) for i in ids]
        jobs.sort(key=lambda j: j["created_at"], reverse=True)
        for j in jobs:
            j["log"] = j["log"][-8:]
        return jobs[:limit]

    def active_count(self) -> int:
        with self._lock:
            return sum(1 for j in self._jobs.values() if j["status"] in ACTIVE)

    def cancel(self, job_id: str) -> Dict[str, Any]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise StudioError("not_found", "រកមិនឃើញការងារនេះ", status=404)
            if job["status"] == "queued":
                job.update(status="cancelled", stage="cancelled", message=STAGE_MESSAGES["cancelled"], finished_at=now_iso(), cancel_requested=True)
                q = job.get("queue", "engine")
                if job_id in self._order[q]:
                    self._order[q].remove(job_id)
            elif job["status"] == "running":
                job["cancel_requested"] = True
                job["message"] = "កំពុងបោះបង់…"
        self._persist(job, force=True)
        return self.get(job_id)

    def is_cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            return bool(self._jobs.get(job_id, {}).get("cancel_requested"))

    # ------------------------------------------------------------------ internals
    def _persist(self, job: Dict[str, Any], force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_write.get(job["id"], 0) < 0.4:
            return
        self._last_write[job["id"]] = now
        try:
            if self.store.valid_id(job["project_id"]) and self.store.project_dir(job["project_id"]).is_dir():
                with self._lock:
                    snapshot = dict(job)
                    snapshot["log"] = list(job["log"][-200:])
                atomic_write_json(self.store.project_dir(job["project_id"]) / "jobs" / f"{job['id']}.json", snapshot)
        except Exception:  # persistence problems must never kill a running job
            log.exception("could not persist job %s", job.get("id"))

    def _update(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            changed_stage = fields.get("stage") not in (None, job.get("stage"))
            job.update(fields)
        self._persist(job, force=changed_stage)

    def _log(self, job_id: str, text: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            entries = job["log"]
            if entries and entries[-1]["msg"] == text:
                return
            entries.append({"t": now_iso(), "msg": text[:400]})
            if len(entries) > 300:
                del entries[:100]
        self._persist(job)

    def _worker(self, qname: str) -> None:
        q = self._queues[qname]
        while not self._stopping:
            job_id = q.get()
            if job_id is None:
                break
            with self._lock:
                job = self._jobs.get(job_id)
                runner = self._runners.get(job_id)
                if job_id in self._order[qname]:
                    self._order[qname].remove(job_id)
                if not job or job["status"] != "queued" or not runner:
                    continue
                job.update(status="running", stage="starting", message=STAGE_MESSAGES["starting"], started_at=now_iso())
            self._persist(job, force=True)
            workdir = self.store.project_dir(job["project_id"]) / "jobs" / f"{job_id}.work"
            ctx = JobCtx(job_id, job["project_id"], job["kind"], job["params"], workdir, self)
            try:
                result = runner(ctx) or {}
                with self._lock:
                    job.update(status="succeeded", stage="done", message=STAGE_MESSAGES["done"], progress=1.0, result=result, finished_at=now_iso())
            except Cancelled:
                with self._lock:
                    job.update(status="cancelled", stage="cancelled", message=STAGE_MESSAGES["cancelled"], finished_at=now_iso())
            except StudioError as exc:
                with self._lock:
                    job.update(status="failed", stage="failed", message=exc.message, error=exc.to_dict(), finished_at=now_iso())
                self._log(job_id, f"កំហុស [{exc.code}] {exc.message}")
            except Exception as exc:  # noqa: BLE001 - last line of defence, reported to the user
                tb = traceback.format_exc()
                log.error("job %s crashed:\n%s", job_id, tb)
                with self._lock:
                    job.update(
                        status="failed", stage="failed", message="កំហុសខាងក្នុងកម្មវិធី",
                        error={"code": "internal", "message": "កំហុសខាងក្នុងកម្មវិធី", "detail": f"{type(exc).__name__}: {exc}"[:600], "hint": None},
                        finished_at=now_iso(),
                    )
            finally:
                self._runners.pop(job_id, None)
                self._cleanup_workdir(workdir)
            self._persist(job, force=True)

    @staticmethod
    def _cleanup_workdir(workdir: Path) -> None:
        import shutil

        try:
            if workdir.is_dir():
                shutil.rmtree(workdir, ignore_errors=True)
        except Exception:  # pragma: no cover
            pass
