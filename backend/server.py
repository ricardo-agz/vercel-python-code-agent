import os
import logging
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from src.api.agent import router as agent_router
from src.api.sandbox import router as sandbox_router
from src.api.models import router as models_router
from src.api.auth import router as auth_router


load_dotenv()


logger = logging.getLogger("ide_agent.server")
if not logger.handlers:
    logger.setLevel(logging.INFO)

app = FastAPI()

is_prod = (
    os.getenv("NODE_ENV") or os.getenv("ENV") or "development"
).lower() == "production"

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"^https://.*\.labs\.vercel\.dev(:\d+)?$" if is_prod else r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(models_router)
app.include_router(auth_router)
app.include_router(agent_router)
app.include_router(sandbox_router)


@app.get("/")
def read_root():
    return {"Hello": "IDE Agent"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8081, factory=False)
