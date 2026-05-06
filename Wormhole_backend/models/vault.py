from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.sql import func

from app.database import Base


class VaultSpace(Base):
    __tablename__ = "vault_spaces"

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"), unique=True, index=True)
    created_by = Column(String, index=True)
    kdf_algo = Column(String, default="pbkdf2-sha256")
    # Default for newly-inserted rows; existing rows retain their original
    # value. See docs/audits/2026-05-vault.md F1.
    kdf_iterations = Column(Integer, default=100000)
    key_salt = Column(String)
    check_nonce = Column(String)
    check_ciphertext = Column(Text)
    check_tag = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class VaultFile(Base):
    __tablename__ = "vault_files"

    id = Column(Integer, primary_key=True, index=True)
    space_id = Column(Integer, ForeignKey("spaces.id"), index=True)
    uploader_user_id = Column(String, index=True)
    object_key = Column(String, index=True)
    encrypted_name = Column(Text)
    name_nonce = Column(String)
    name_tag = Column(String)
    encrypted_meta = Column(Text)
    meta_nonce = Column(String)
    meta_tag = Column(String)
    file_nonce = Column(String)
    file_tag = Column(String)
    cipher_algo = Column(String, default="chacha20-hmac-sha256")
    original_size = Column(Integer, default=0)
    encrypted_size = Column(Integer, default=0)
    content_type = Column(String, default="application/octet-stream")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True), nullable=True)
