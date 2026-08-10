from typing import Any

from pydantic import BaseModel, Field


class SuccessResponse[T](BaseModel):
    success: bool = True
    data: T
    message: str | None = None


class MessageResponse(BaseModel):
    success: bool = True
    message: str


class ErrorResponse(BaseModel):
    success: bool = False
    message: str
    details: list[Any] = Field(default_factory=list)
