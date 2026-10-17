"""Path resolution shared by the Step 2 generators and rehearsal tools.
 - EVID_ROOT : the protected folder with raw Stage B captures and scratch outputs (never in Git). Override with BPC_EVIDENCE_ROOT.
 - DERIVED   : audit/evidence/derived, committed derived inputs (statement-level classification and database-validated atoms; no raw captures, no customer data).
 - workdir() : where generators leave intermediate files. BPC_WORKDIR overrides; otherwise the protected scratch folder when it exists, else a temporary directory.
A generator must be reproducible from the committed repository alone: inputs come from DERIVED , outputs from `workdir()`.
Rehearsals still need the raw Stage B captures and a local PostgreSQL cluster (EVID_ROOT)."""
import os
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
EVID_DIR = os.path.abspath(os.path.join(HERE, ".."))
EVID_ROOT = os.environ.get("BPC_EVIDENCE_ROOT") or os.path.join("C:" + os.sep, "Users", "vikki", "migration-evidence")
DERIVED = os.path.join(EVID_DIR, "derived")


def workdir():
    d = os.environ.get("BPC_WORKDIR")
    if not d:
        prot = os.path.join(EVID_ROOT, "step2-final-scratch")
        d = prot if os.path.isdir(EVID_ROOT) else os.path.join(tempfile.gettempdir(), "bpc-step2")
    os.makedirs(d, exist_ok=True)
    return d


def derived(name):
    """Committed derived input (audit/evidence/derived/<name>)."""
    p = os.path.join(DERIVED, name)
    if not os.path.exists(p):
        raise SystemExit(f"missing committed derived input {p}")
    return p
