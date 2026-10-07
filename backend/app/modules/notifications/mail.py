"""The look of every email: one branded layout with the Anwar Group logo.

The wording stays plain text (the admin edits it under Admin > Notifications, and it is what the delivery log keeps).
html_email() turns that text into the HTML version: "Label: value" lines become a details table, the link becomes a
button, and the event type picks the label, the button text and the colour.
"""
import re
from html import escape
from pathlib import Path

from app.core.config import settings

LOGO_PATH = Path(__file__).resolve().parents[2] / "assets" / "agl_logo.jpg"
LOGO_CID = "anwar-group-logo"

RED, GOLD, GREEN = "#D9272E", "#B7791F", "#15803D"
INK, MUTED, LINE, CANVAS = "#1F2933", "#6B7280", "#E5E7EB", "#F3F4F6"
FONT = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"

# event type -> (label above the heading, button text, accent colour)
STYLES = {
    "JUDGE_INVITED": ("Judge invitation", "Accept and create your account", RED),
    "USER_INVITED": ("Invitation", "Accept and create your account", RED),
    "USER_SIGNED_UP": ("Welcome", "Explore open challenges", RED),
    "JUDGE_CHOSEN": ("Judging", "Open My judging", RED),
    "ROLE_ASSIGNED": ("Your access", "Open InnovateX Hub", RED),
    "ENTRY_SHORTLISTED": ("Result and feedback", "Read your feedback and next steps", GREEN),
    "ENTRY_NOT_SHORTLISTED": ("Result and feedback", "Read your feedback", RED),
    "AWARD_PUBLISHED": ("Results", "See the results and your feedback", RED),
    "REVIEW_ASSIGNED": ("Review assigned", "Open the review", RED),
    "CLARIFICATION_REQUESTED": ("Action needed", "Reply to the panel", RED),
    "TEST": ("Test email", "Open InnovateX Hub", RED),
}
CHAMPION = ("Champion", "See the results and your feedback", GOLD)     # an award email that starts with "Congratulations"
DEFAULT_STYLE = ("Notification", "Open InnovateX Hub", RED)

# Wording for events that have no template of their own in Admin > Notifications.
DEFAULT_TEMPLATES = {
    "USER_SIGNED_UP": (
        "[InnovateX] Welcome to {{app_name}}",
        "Your account is ready. Welcome to {{app_name}}, the place where Anwar Group turns good ideas into results.\n\n"
        "Here is what you can do now:\n"
        "- Join an open challenge, alone or with a team.\n"
        "- Share an idea that saves time, cost or effort in your daily work.\n"
        "- Follow your entries and read the judges' feedback.\n\n"
        "Open: {{secure_link}}\n\n"
        "This is an automatic message from {{app_name}}. Details are shown only after you sign in."),
}

URL = re.compile(r"https?://[^\s<>\"]+")
FACT = re.compile(r"^([A-Z][A-Za-z0-9 /'&-]{1,28}):\s+(\S.*)$")


def style_for(event_type: str | None, subject: str = "") -> tuple[str, str, str]:
    if event_type == "AWARD_PUBLISHED" and "congratulations" in subject.lower():
        return CHAMPION
    return STYLES.get(event_type or "", DEFAULT_STYLE)


def _p(text: str, extra: str = "") -> str:
    return f'<p style="margin:0 0 16px;{FONT}font-size:15px;line-height:24px;color:{INK};{extra}">{text}</p>'


def _facts(rows: list[tuple[str, str]]) -> str:
    cells = "".join(
        f'<tr><td style="padding:10px 14px;{FONT}font-size:13px;line-height:20px;color:{MUTED};white-space:nowrap;'
        f'border-bottom:1px solid {LINE};" valign="top">{escape(k)}</td>'
        f'<td style="padding:10px 14px;{FONT}font-size:14px;line-height:20px;color:{INK};font-weight:600;'
        f'border-bottom:1px solid {LINE};" valign="top">{escape(v)}</td></tr>' for k, v in rows)
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            f'style="margin:4px 0 20px;border:1px solid {LINE};border-bottom:0;border-radius:6px;border-collapse:separate;">{cells}</table>')


def _list(items: list[str]) -> str:
    rows = "".join(f'<tr><td width="18" valign="top" style="{FONT}font-size:15px;line-height:24px;color:{RED};">&#8226;</td>'
                   f'<td style="{FONT}font-size:15px;line-height:24px;color:{INK};padding-bottom:6px;">{escape(i)}</td></tr>' for i in items)
    return f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">{rows}</table>'


def _content(body: str) -> tuple[str, str | None, str, str]:
    """The plain-text body as HTML blocks. Returns (html, link, small print, first sentence)."""
    parts, link, small, first = [], None, [], ""
    para: list[str] = []
    facts: list[tuple[str, str]] = []
    items: list[str] = []

    def flush():
        nonlocal para, facts, items, first
        if para:
            first = first or " ".join(para)
            parts.append(_p("<br>".join(escape(x) for x in para)))
        if facts:
            parts.append(_facts(facts))
        if items:
            parts.append(_list(items))
        para, facts, items = [], [], []

    for raw in (body or "").replace("\r\n", "\n").split("\n"):
        line = raw.strip()
        found = URL.search(line)
        if found:                               # the link becomes the button; words around it stay as text
            link = link or found.group(0).rstrip(".,)")
            line = URL.sub("", line).strip()
            if line.lower().rstrip(":") in ("open", ""):
                continue
        if not line:
            flush()
            continue
        if line.lower().startswith("this is an automatic message"):
            flush()
            small.append(line)
            continue
        fact = FACT.match(line)
        if fact and not found:
            if para or items:
                flush()
            facts.append((fact.group(1), fact.group(2)))
        elif line.startswith(("- ", "• ")):
            if para or facts:
                flush()
            items.append(line[2:].strip())
        else:
            if facts or items:
                flush()
            para.append(line)
    flush()
    return "".join(parts), link, " ".join(small), first


def html_email(subject: str, body: str, event_type: str | None = None) -> str:
    """The branded HTML version of a plain-text email. The logo is referenced as cid:LOGO_CID."""
    label, button, accent = style_for(event_type, subject)
    heading = re.sub(r"^\[[^\]]+\]\s*", "", subject or "").strip() or settings.app_name
    content, link, small, first = _content(body)
    app = escape(settings.app_name)
    action = ""
    if link:
        href = escape(link, quote=True)
        action = (
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>'
            f'<td bgcolor="{accent}" style="border-radius:6px;">'
            f'<a href="{href}" target="_blank" style="display:inline-block;padding:13px 26px;{FONT}font-size:15px;line-height:20px;'
            f'font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px;">{escape(button)}</a></td></tr></table>'
            f'<p style="margin:0 0 4px;{FONT}font-size:12px;line-height:18px;color:{MUTED};">If the button does not work, copy this link into your browser:</p>'
            f'<p style="margin:0 0 8px;{FONT}font-size:12px;line-height:18px;word-break:break-all;">'
            f'<a href="{href}" target="_blank" style="color:{MUTED};text-decoration:underline;">{escape(link)}</a></p>')
    small = escape(small or f"This is an automatic message from {settings.app_name}. Please do not reply to it.")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>{escape(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:{CANVAS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{CANVAS};">{escape(first[:140])}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{CANVAS}" style="background-color:{CANVAS};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
  <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-radius:10px 10px 0 0;padding:22px 32px 14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" valign="middle"><img src="cid:{LOGO_CID}" width="96" alt="Anwar Group" style="display:block;border:0;width:96px;height:auto;"></td>
      <td align="right" valign="middle" style="{FONT}font-size:16px;line-height:22px;font-weight:700;color:{INK};">{app}
        <br><span style="font-size:12px;font-weight:400;color:{MUTED};">Anwar Group of Industries</span></td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="{accent}" height="4" style="background-color:{accent};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;padding:30px 32px 24px;">
    <p style="margin:0 0 8px;{FONT}font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:{accent};">{escape(label)}</p>
    <h1 style="margin:0 0 20px;{FONT}font-size:22px;line-height:30px;font-weight:700;color:{INK};">{escape(heading)}</h1>
    {content}
    {action}
  </td></tr>
  <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-top:1px solid {LINE};border-radius:0 0 10px 10px;padding:18px 32px 22px;">
    <p style="margin:0 0 6px;{FONT}font-size:12px;line-height:18px;color:{MUTED};">{small}</p>
    <p style="margin:0;{FONT}font-size:12px;line-height:18px;color:{MUTED};">{app} &middot; Anwar Group of Industries</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def logo_bytes() -> bytes | None:
    try:
        return LOGO_PATH.read_bytes()
    except OSError:
        return None
