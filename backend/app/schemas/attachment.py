from pydantic import BaseModel


class AttachmentResponse(BaseModel):
    id: int
    download_url: str
    original_filename: str
    mime_type: str
    size_bytes: int

class PresignUploadRequest(BaseModel):
    filename: str
    content_type: str
    size_bytes: int

class PresignUploadResponse(BaseModel):
    upload_url: str
    object_key: str

