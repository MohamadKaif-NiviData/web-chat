from pydantic import BaseModel, EmailStr, ConfigDict

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    display_name: str

class UserResponse(BaseModel):
    id:int
    email:EmailStr
    display_name: str
    model_config = ConfigDict(from_attributes=True)
