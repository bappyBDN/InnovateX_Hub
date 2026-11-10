"""Step 1 of filling InovaRegistry from the AI Summit Excel: read the workbook, compress the business-card photos and
write one JSON bundle that the backend loads (step 2: `python -m app.registry_import <bundle.json>` in the backend).

    py scripts/registry_excel_to_json.py "all doc/AI_Summit_2026_Expo_Exhibitors.xlsx" registry_bundle.json

Needs openpyxl and Pillow (only on the machine that runs this step; the backend does not need them).

What it builds
- One record per row of "Expo Exhibitors" (company or university team).
- Each row of "Business Cards" is matched to its exhibitor (by website domain, then by name). A card company that is
  not an exhibitor becomes a record of its own.
- Card photos: WebP, ~20 KB for reading and a ~6 KB thumbnail, lightly sharpened so small text stays clear.
"""
import base64
import io
import json
import re
import sys
from urllib.parse import urlsplit

import openpyxl
from PIL import Image, ImageFilter

EVENT = "AI Business Summit 2026"
FULL_WIDTH, FULL_QUALITY = 640, 72
THUMB_WIDTH, THUMB_QUALITY = 300, 62

AI_CATEGORY_MAP = {          # the Excel's categories -> InovaRegistry's list
    "genai/llm": "Generative AI / LLM", "ai agents": "Agentic AI", "computer vision": "Computer Vision",
    "nlp/chatbot": "NLP / Speech", "voice/speech ai": "NLP / Speech",
    "predictive analytics/ml": "Predictive Analytics / ML", "data platform/bi": "Predictive Analytics / ML",
    "recommendation": "Recommendation", "robotics/drones/iot-ai": "Robotics / Automation",
}
INTENSITY_MAP = {"core ai": "High", "ai-enabled": "Medium", "minimal/none": "Low"}
DASHES = {"", "—", "–", "-", "�", "none", "n/a"}
FREE_MAIL = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com", "proton.me"}


def clean(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, float):
        v = str(int(v)) if v.is_integer() else str(v)
    s = str(v).replace("\r", "").strip()
    return None if s.lower() in DASHES else s


def phone(v) -> str | None:
    s = clean(v)
    if not s:
        return None
    if re.fullmatch(r"1\d{9}", s):          # Excel dropped the leading 0 of a Bangladeshi mobile number
        s = "0" + s
    return s[:40]


def first_line(s: str | None) -> str | None:
    return s.split("\n")[0].strip() if s else None


def url(s: str | None) -> str | None:
    s = first_line(clean(s))
    if not s or " " in s or "." not in s:
        return None
    return s if re.match(r"^https?://", s, re.I) else "https://" + s


def domain(s: str | None) -> str | None:
    u = url(s)
    if not u:
        return None
    host = (urlsplit(u).hostname or "").lower().removeprefix("www.")
    return host or None


def name_keys(name: str) -> set[str]:
    """'AQUALink (Aqualink Bangladesh Limited)' -> {'aqualink', 'aqualinkbangladesh'}"""
    parts = [name] + re.findall(r"\((.*?)\)", name)
    parts.append(re.sub(r"\(.*?\)", " ", name))
    keys = set()
    for p in parts:
        k = re.sub(r"\b(ltd|limited|plc|inc|pte|llc|co|company|bd|bangladesh)\b\.?", " ", p.lower())
        k = re.sub(r"[^a-z0-9]+", "", k)
        if len(k) >= 4:
            keys.add(k)
    return keys


def webp(data: bytes, width: int, quality: int) -> tuple[bytes, int, int]:
    pic = Image.open(io.BytesIO(data)).convert("RGB")
    if pic.width > width:
        pic = pic.resize((width, round(pic.height * width / pic.width)), Image.LANCZOS)
    pic = pic.filter(ImageFilter.UnsharpMask(radius=1, percent=45, threshold=2))
    limit = 32_000 if width >= FULL_WIDTH else 10_000
    while True:                       # busy photos: step the quality down until the file is small enough
        buf = io.BytesIO()
        pic.save(buf, "WEBP", quality=quality, method=6)
        if buf.tell() <= limit or quality <= 50:
            return buf.getvalue(), pic.width, pic.height
        quality -= 6


def contacts(text: str | None) -> list[tuple[str, str | None]]:
    """'Name - Title; Name2 - Title2' -> [(name, title), …]"""
    out = []
    for chunk in re.split(r";|\n", text or ""):
        chunk = chunk.strip()
        if not chunk:
            continue
        name, _, title = chunk.partition(" - ")
        out.append((name.strip(), title.strip() or None))
    return out


def creator_type(title: str | None, university: bool) -> str:
    t = (title or "").lower()
    if re.search(r"professor|lecturer|faculty|dean|chair", t):
        return "Faculty"
    if re.search(r"researcher|research", t):
        return "Researcher"
    if re.search(r"student|undergrad|graduate", t) or (university and not t):
        return "Student"
    if re.search(r"founder|ceo|owner|managing director", t):
        return "Founder"
    return "Student" if university else "Company Rep"


def emails(text: str | None) -> list[str]:
    return re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", text or "")


def exhibitor_record(r: tuple) -> dict:
    (sl, expo_id, company, zone, stall, overview, tagline, services, projects, unique, ai_work, ai_cats, intensity,
     contact_text, ph, other_ph, email_text, website, address) = [clean(v) for v in r[:19]]
    university = (zone or "").lower().startswith("university")
    people = contacts(contact_text)
    lead_name, lead_title = people[0] if people else (None, None)
    cats = [c.strip() for c in (ai_cats or "").split(",") if c.strip() and c.strip().lower() != "none"]
    mapped = next((AI_CATEGORY_MAP.get(c.lower(), "Other AI") for c in cats), None)

    desc = [overview]           # services, projects & products have their own fields now
    if people:
        desc.append("Contacts:\n" + "\n".join(f"• {n}" + (f" — {t}" if t else "") for n, t in people))
    lines = []
    if email_text:
        lines.append("Email: " + ", ".join(emails(email_text)) if emails(email_text) else "Email: " + email_text)
    if other_ph:
        lines.append("Other phones: " + other_ph)
    expo = " · ".join(x for x in (zone and f"Zone: {zone}", stall and f"Stall: {stall}", expo_id and f"Expo ID: {expo_id}") if x)
    if expo:
        lines.append(expo)
    if lines:
        desc.append("\n".join(lines))

    return {
        "title": company, "institution": company, "institution_type": "University" if university else "Company",
        "institution_website": url(website),
        "summary": tagline or (overview[:400] if overview else company),
        "description": "\n\n".join(d for d in desc if d),
        "tech_stack": [], "ai_tags": cats, "tagline": tagline, "services": services, "projects_products": projects,
        "creator": lead_name, "creator_email": (emails(email_text) or [None])[0],
        "creator_type": creator_type(lead_title, university), "contact_phone": phone(ph),
        "contact_address": address, "ai_unique_point": unique, "ai_work": ai_work, "ai_category": mapped,
        "ai_intensity": INTENSITY_MAP.get((intensity or "").lower()) if mapped else None,
        "source_url": url(website), "collected_at": "AI Summit", "event_name": EVENT,
        "extra": {"expo_id": expo_id, "zone": zone, "stall": stall, "tagline": tagline,
                  "contacts": [{"name": n, "title": t} for n, t in people], "emails": emails(email_text),
                  "other_phones": other_ph, "excel_sl": sl, "source": "AI_Summit_2026_Expo_Exhibitors.xlsx"},
        "cards": [],
        "_keys": name_keys(company or ""), "_domain": domain(website),
        "_mail_domains": {e.split("@")[1].lower() for e in emails(email_text)} - FREE_MAIL,
    }


def card_only_record(company: str, card: dict) -> dict:
    d = card["details"]
    who = card["contact_name"] if card["contact_name"] and not card["contact_name"].startswith("(") else None
    role = card["designation"]
    met = ", ".join(x for x in (who, role) if x)
    return {
        "title": company, "institution": company, "institution_type": "Company",
        "institution_website": card["_website"],
        "summary": f"Met at {EVENT}" + (f": {met}." if met else " (company business card)."),
        "description": "\n\n".join(x for x in (
            f"Business card collected by the Anwar Group team at {EVENT}.",
            met and f"Contact: {met}",
            d.get("address") and "Address: " + d["address"],
            card["_website"] and "Website: " + card["_website"]) if x),
        "tech_stack": [], "creator": card["contact_name"] if card["contact_name"] and not card["contact_name"].startswith("(") else None,
        "creator_email": (card["email"] or "").split("\n")[0] or None, "creator_type": "Company Rep",
        "contact_phone": card["phone"], "contact_address": d.get("address"),
        "ai_unique_point": None, "ai_work": None, "ai_category": None, "ai_intensity": None,
        "source_url": card["_website"], "collected_at": "AI Summit", "event_name": EVENT,
        "extra": {"source": "AI_Summit_2026_Expo_Exhibitors.xlsx (Business Cards)", "business_card_only": True},
        "cards": [],
    }


def main(xlsx: str, out_path: str) -> None:
    wb = openpyxl.load_workbook(xlsx)

    records = [exhibitor_record(r) for r in wb["Expo Exhibitors"].iter_rows(min_row=2, values_only=True) if clean(r[2])]

    ws = wb["Business Cards"]
    images: dict[int, bytes] = {}
    for im in ws._images:                       # first photo per row (a row can hold two copies of one card)
        row = im.anchor._from.row + 1
        if row not in images:
            images[row] = im._data()

    by_domain = {r["_domain"]: r for r in records if r["_domain"]}
    extra_records: dict[str, dict] = {}
    matched, unmatched, skipped = [], [], []
    for row_no, r in enumerate(ws.iter_rows(min_row=5, values_only=True), start=5):
        sl, company, site, person, title, ph, other, whatsapp, mail, address, notes = [clean(v) for v in r[:11]]
        if not company or not (person or ph or mail):
            if company:
                skipped.append(company)
            continue
        card = {"contact_name": person, "designation": title, "phone": phone(ph), "email": mail,
                "details": {k: v for k, v in (("other_phones", other), ("whatsapp", phone(whatsapp)), ("address", address),
                                              ("notes", notes), ("website", site), ("company_on_card", company)) if v},
                "sort_order": int(float(sl)) if sl and re.fullmatch(r"[\d.]+", sl) else 999,
                "match_key": (person or f"card-{row_no}").lower()[:300], "_website": url(site)}
        data = images.get(row_no)
        if data:
            full, w, h = webp(data, FULL_WIDTH, FULL_QUALITY)
            thumb, _, _ = webp(data, THUMB_WIDTH, THUMB_QUALITY)
            card.update(image=base64.b64encode(full).decode(), thumb=base64.b64encode(thumb).decode(), width=w, height=h)

        target = None
        site_domains = {domain(s) for s in (site or "").split("\n")} - {None}
        for dmn in site_domains:
            target = target or by_domain.get(dmn)
        if not target:      # the card's email domain is the exhibitor's website or email domain (Telzen -> Netro Systems)
            card_mail = {e.split("@")[1].lower() for e in emails(mail)} - FREE_MAIL
            target = next((rec for rec in records if card_mail & (rec["_mail_domains"] | {rec["_domain"]})), None)
        if not target:
            keys = name_keys(company)
            target = next((rec for rec in records if rec["_keys"] & keys), None)
            if not target:
                target = next((rec for rec in records for a in rec["_keys"] for b in keys
                               if min(len(a), len(b)) >= 6 and (a.startswith(b) or b.startswith(a))), None)
        if target:
            matched.append((company, target["title"]))
        else:
            keys = name_keys(company) or {company.lower()}
            target = next((rec for rec in extra_records.values() if rec["_keys"] & keys), None)
            if not target:
                target = extra_records[company] = card_only_record(company, card)
                target["_keys"] = keys
            unmatched.append(company)
        target["cards"].append(card)

    all_records = records + list(extra_records.values())
    for rec in all_records:
        rec.pop("_keys", None)
        rec.pop("_domain", None)
        rec.pop("_mail_domains", None)
        for c in rec["cards"]:
            c.pop("_website", None)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"event": EVENT, "records": all_records}, f, ensure_ascii=False)

    sizes = [len(base64.b64decode(c["image"])) for rec in all_records for c in rec["cards"] if c.get("image")]
    thumbs = [len(base64.b64decode(c["thumb"])) for rec in all_records for c in rec["cards"] if c.get("thumb")]
    print(f"exhibitor records: {len(records)}; card-only records: {len(extra_records)}; total: {len(all_records)}")
    print(f"cards: {sum(len(r['cards']) for r in all_records)} (matched to exhibitors: {len(matched)}, own record: {len(unmatched)}); "
          f"skipped empty rows: {skipped}")
    if sizes:
        print(f"card image size: avg {sum(sizes) // len(sizes) // 1024} KB, max {max(sizes) // 1024} KB; "
              f"thumb avg {sum(thumbs) // len(thumbs) // 1024} KB")
    print("\nmatched cards (card company -> exhibitor):")
    for a, b in matched:
        print(f"  {a}  ->  {b}")
    print("\ncard companies with their own record:", ", ".join(sorted(set(unmatched))))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
