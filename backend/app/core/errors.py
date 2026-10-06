"""Standard error shape: {"error": {"code", "message", "details"}}."""
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class DomainError(Exception):
    def __init__(self, code: str, message: str = "", status: int = 400, details: dict | None = None):
        self.code, self.message, self.status, self.details = code, message or code, status, details or {}


def not_found(what: str = "Record") -> DomainError:
    """Used for both 'does not exist' and 'you may not see it', so nothing is revealed."""
    return DomainError("NOT_FOUND", f"{what} not found.", 404)


def _body(code: str, message: str, details=None):
    return {"error": {"code": code, "message": message, "details": details or {}}}


def install_error_handlers(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_id(request: Request, call_next):
        rid = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        return response

    @app.exception_handler(DomainError)
    async def domain_error(_: Request, exc: DomainError):
        return JSONResponse(status_code=exc.status, content=_body(exc.code, exc.message, exc.details))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        code = {401: "UNAUTHENTICATED", 403: "NOT_FOUND", 404: "NOT_FOUND"}.get(exc.status_code, "HTTP_ERROR")
        return JSONResponse(status_code=exc.status_code, content=_body(code, str(exc.detail)))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        fields = {".".join(str(p) for p in e["loc"][1:]): e["msg"] for e in exc.errors()}
        return JSONResponse(status_code=422, content=_body("VALIDATION_ERROR", "Some fields need attention.", {"fields": fields}))
