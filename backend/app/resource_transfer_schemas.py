from typing import Literal

from pydantic import BaseModel


class ResourceTransferInput(BaseModel):
    action: Literal["copy", "move"]
    target_organization_id: str
