import os
import smtplib
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from routers.security import get_current_user

router = APIRouter(prefix="/email", tags=["email"])


class EmailSendRequest(BaseModel):
    to: list[EmailStr]
    subject: str
    body: str
    cc: list[EmailStr] = []
    bcc: list[EmailStr] = []


class EmailSendResponse(BaseModel):
    message: str
    recipients: list[str]


def _get_smtp_config():
    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USERNAME")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM") or username
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() in {"1", "true", "yes", "on"}
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() in {"1", "true", "yes", "on"}

    if not host or not username or not password or not sender:
        raise HTTPException(
            status_code=500,
            detail="SMTP 未設定，請在 .env 中設定 SMTP_HOST、SMTP_PORT、SMTP_USERNAME、SMTP_PASSWORD 與 SMTP_FROM。",
        )

    return {
        "host": host,
        "port": port,
        "username": username,
        "password": password,
        "sender": sender,
        "use_ssl": use_ssl,
        "use_tls": use_tls,
    }


def send_email(to: list[str], subject: str, body: str, cc: list[str] | None = None, bcc: list[str] | None = None):
    recipients = [email.strip() for email in to if email and email.strip()]
    carbon_copy = [email.strip() for email in (cc or []) if email and email.strip()]
    blind_copy = [email.strip() for email in (bcc or []) if email and email.strip()]

    if not recipients:
        raise HTTPException(status_code=400, detail="收件人列表不能為空")

    config = _get_smtp_config()
    all_recipients = recipients + carbon_copy + blind_copy

    message = EmailMessage()
    message["From"] = config["sender"]
    message["To"] = ", ".join(recipients)
    if carbon_copy:
        message["Cc"] = ", ".join(carbon_copy)
    if blind_copy:
        message["Bcc"] = ", ".join(blind_copy)
    message["Subject"] = subject
    message.set_content(body)

    try:
        smtp_cls = smtplib.SMTP_SSL if config["use_ssl"] else smtplib.SMTP
        with smtp_cls(config["host"], config["port"]) as smtp:
            if config["use_tls"] and not config["use_ssl"]:
                smtp.starttls()
            smtp.login(config["username"], config["password"])
            smtp.send_message(message, to_addrs=all_recipients)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"送信失敗: {str(exc)}") from exc

    return {"message": "email sent", "recipients": recipients}


@router.post("/send")
def send_email_route(data: EmailSendRequest, user=Depends(get_current_user)):
    if not user or not getattr(user, "email", None):
        raise HTTPException(status_code=401, detail="Unauthorized")

    result = send_email(
        to=list(data.to),
        subject=data.subject,
        body=data.body,
        cc=list(data.cc),
        bcc=list(data.bcc),
    )
    return result


@router.get("/health")
def email_health():
    return {"status": "ok", "smtp_configured": bool(os.getenv("SMTP_HOST"))}
