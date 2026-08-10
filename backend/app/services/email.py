from html import escape
from urllib.parse import quote

import httpx

from app.core.config import Settings
from app.core.errors import AppError


class GraphEmailService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def configured(self) -> bool:
        return all(
            (
                self.settings.ms_client_id,
                self.settings.ms_tenant_id,
                self.settings.ms_client_secret.get_secret_value(),
                self.settings.mail_sender_email,
            )
        )

    async def send_otp(self, recipient: str, first_name: str, code: str, purpose: str) -> bool:
        if not self.settings.otp_emails_enabled or not self.configured:
            if self.settings.is_production:
                raise AppError(503, "Email verification is temporarily unavailable")
            return False
        heading = "Verify your AT Connect sign-in" if purpose == "login" else "Reset your AT Connect password"
        intro = (
            "Use this one-time code to finish signing in."
            if purpose == "login"
            else "Use this one-time code to reset your password."
        )
        html = f"""
        <div style="font-family:Inter,Arial,sans-serif;background:#f5f7f9;padding:32px;color:#17213b">
          <div style="max-width:560px;margin:auto;background:#fff;border:1px solid #e5e9ef;border-radius:16px;padding:32px">
            <div style="font-weight:700;color:#187b72;margin-bottom:24px">AT Connect</div>
            <h1 style="font-size:22px;margin:0 0 12px">{escape(heading)}</h1>
            <p>Hello {escape(first_name)},</p><p>{escape(intro)}</p>
            <div style="font-size:32px;letter-spacing:8px;font-weight:700;background:#e8f5f3;color:#12645d;padding:18px;text-align:center;border-radius:10px">{escape(code)}</div>
            <p style="color:#7c8597;font-size:13px">This code expires in {self.settings.otp_expires_minutes} minutes. If you did not request it, you can ignore this email.</p>
          </div>
        </div>"""
        token_url = f"https://login.microsoftonline.com/{quote(self.settings.ms_tenant_id)}/oauth2/v2.0/token"
        async with httpx.AsyncClient(timeout=15) as client:
            token_response = await client.post(
                token_url,
                data={
                    "client_id": self.settings.ms_client_id,
                    "client_secret": self.settings.ms_client_secret.get_secret_value(),
                    "scope": "https://graph.microsoft.com/.default",
                    "grant_type": "client_credentials",
                },
            )
            if token_response.is_error:
                raise AppError(503, "Email verification is temporarily unavailable")
            access_token = token_response.json().get("access_token")
            endpoint = f"https://graph.microsoft.com/v1.0/users/{quote(self.settings.mail_sender_email)}/sendMail"
            send_response = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {access_token}"},
                json={
                    "message": {
                        "subject": heading,
                        "body": {"contentType": "HTML", "content": html},
                        "toRecipients": [{"emailAddress": {"address": recipient}}],
                        **(
                            {"replyTo": [{"emailAddress": {"address": self.settings.mail_reply_to}}]}
                            if self.settings.mail_reply_to
                            else {}
                        ),
                    },
                    "saveToSentItems": True,
                },
            )
            if send_response.status_code != 202:
                raise AppError(503, "Email verification is temporarily unavailable")
        return True
