from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class VaultStatusResponse(BaseModel):
    initialized: bool
    key_salt: Optional[str] = None
    kdf_algo: str = "pbkdf2-sha256"
    # Default reflects the value used for *new* vaults; existing rows return
    # whatever was stored at init time (typically 30000 for vaults created
    # before 2026-05-06; 100000 thereafter — see docs/audits/2026-05-vault.md F1).
    kdf_iterations: int = 100000
    check_nonce: Optional[str] = None
    check_ciphertext: Optional[str] = None
    check_tag: Optional[str] = None
    max_file_bytes: int


class VaultInitRequest(BaseModel):
    space_id: int
    user_id: str
    key_salt: str
    kdf_algo: str = "pbkdf2-sha256"
    # Floor raised to 100000 (was 10000) per docs/audits/2026-05-vault.md F1.
    # Ceiling raised to 600000 to allow conservative clients to opt into the
    # OWASP-recommended value if device CPU permits.
    kdf_iterations: int = Field(default=100000, ge=100000, le=600000)
    check_nonce: str
    check_ciphertext: str
    check_tag: str


class VaultFileResponse(BaseModel):
    id: int
    space_id: int
    uploader_user_id: str
    encrypted_name: str
    name_nonce: str
    name_tag: str
    encrypted_meta: str
    meta_nonce: str
    meta_tag: str
    file_nonce: str
    file_tag: str
    cipher_algo: str
    original_size: int
    encrypted_size: int
    content_type: str
    created_at: datetime
    created_at_ts: Optional[int] = None


class VaultFilesResponse(BaseModel):
    files: list[VaultFileResponse] = Field(default_factory=list)


class VaultDownloadResponse(BaseModel):
    url: str
    file: VaultFileResponse


class VaultResetRequest(BaseModel):
    space_id: int
    user_id: str
    # Client must echo this exact string to acknowledge the destructive intent.
    # Any other value (or missing) returns 400 without touching anything.
    confirm: str = Field(..., description="必须等于 '重置' 才会执行")


class VaultResetResponse(BaseModel):
    success: bool
    deleted_files: int
