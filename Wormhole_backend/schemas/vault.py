from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class VaultStatusResponse(BaseModel):
    initialized: bool
    key_salt: Optional[str] = None
    kdf_algo: str = "pbkdf2-sha256"
    kdf_iterations: int = 30000
    check_nonce: Optional[str] = None
    check_ciphertext: Optional[str] = None
    check_tag: Optional[str] = None
    max_file_bytes: int


class VaultInitRequest(BaseModel):
    space_id: int
    user_id: str
    key_salt: str
    kdf_algo: str = "pbkdf2-sha256"
    kdf_iterations: int = Field(default=30000, ge=10000, le=120000)
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
