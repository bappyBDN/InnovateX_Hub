"""Check the email settings:  python -m app.send_test_email someone@anwargroup.net
Add --samples to send one of each main email (invitations, welcome, feedback, champion) to see how they look."""
import sys

from app.core.config import settings
from app.modules.notifications.service import send_sample_emails, send_test_email

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    samples = "--samples" in sys.argv
    to = args[0] if args else settings.mail_from
    print(f"Sending {'sample emails' if samples else 'a test email'} to {to} through {settings.smtp_host or '(no SMTP_HOST)'}:"
          f"{settings.smtp_port} as {settings.smtp_user or '(no sign-in)'} ...")
    try:
        if samples:
            for subject in send_sample_emails(to):
                print("  sent:", subject)
        else:
            send_test_email(to)
    except Exception as exc:
        sys.exit(f"Not sent: {exc}")
    print("Sent.")
