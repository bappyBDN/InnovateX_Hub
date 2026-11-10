"""InovaRegistry: industry solutions and university projects collected by employees (field visits, AI summits, …)
or pushed in by web scrapers. These people and institutions are outside the company, so they live in their own
tables and never mix with the staff `users` table."""
from sqlalchemy import LargeBinary, UniqueConstraint
from sqlalchemy.orm import mapped_column

from app.shared.models.base import Base, StdColumns, integer, json_col, ref, sc, text

SOURCE_TYPES = ("Web Scraped", "Manual Entry")
INSTITUTION_TYPES = ("University", "Company", "Research Lab", "Startup", "Government / NGO")
CREATOR_TYPES = ("Student", "Researcher", "Faculty", "Company Rep", "Founder", "Independent")
COLLECTED_AT = ("Industry Visit", "University Visit", "AI Summit", "Conference / Expo", "Hackathon",
                "Online Research", "Other")
# AI project tracking (all optional)
AI_CATEGORIES = ("Generative AI / LLM", "Agentic AI", "Computer Vision", "NLP / Speech", "Predictive Analytics / ML",
                 "Recommendation", "Robotics / Automation", "Other AI")
AI_INTENSITIES = ("Low", "Medium", "High")      # Low = AI helps a little; Medium = an important part; High = AI is the core


class RegistryUser(Base, StdColumns):
    """The 'Users' entity of the registry: the person who built the solution (a student, researcher, founder…)."""
    __tablename__ = "registry_users"
    full_name = sc(200)
    email = sc(200, nullable=True)
    user_type = sc(40, nullable=True)
    match_key = sc(300, unique=True, index=True)   # lower-cased email, or name, so the same person is stored once


class Institution(Base, StdColumns):
    __tablename__ = "registry_institutions"
    name = sc(200)
    institution_type = sc(40, index=True)
    website = sc(400, nullable=True)
    country = sc(80, nullable=True)
    match_key = sc(200, unique=True, index=True)   # lower-cased name without extra spaces


class RegistryUserInstitution(Base, StdColumns):
    """Which institution a creator belongs to, and where that fact came from."""
    __tablename__ = "registry_user_institutions"
    __table_args__ = (UniqueConstraint("user_id", "institution_id", name="uq_registry_user_institution"),)
    user_id = ref(False)
    institution_id = ref(False)
    source_type = sc(20)            # Web Scraped | Manual Entry
    source_url = sc(1000, nullable=True)


class Project(Base, StdColumns):
    __tablename__ = "registry_projects"
    code = sc(20, unique=True, index=True)          # IR-00001
    title = sc(300)
    summary = text()
    description = text()
    tech_stack = json_col(list)
    impact = text()
    collected_at = sc(60, nullable=True)            # where the employee found it: AI Summit, Industry Visit, …
    event_name = sc(200, nullable=True)             # e.g. "Bangladesh AI Summit 2026"
    contact_phone = sc(40, nullable=True)           # optional contact person details
    contact_address = text()
    ai_unique_point = text()                        # what makes the AI special
    ai_work = text()                                # what the AI actually does
    ai_category = sc(60, nullable=True, index=True)  # one of AI_CATEGORIES
    ai_intensity = sc(20, nullable=True, index=True)  # one of AI_INTENSITIES
    ai_tags = json_col(list)                        # every AI area named, free text, e.g. ["AI Agents", "GenAI/LLM"]
    tagline = sc(300, nullable=True)                # one line on what they do
    services = text()                               # services / what they offer
    projects_products = text()                      # projects, products & clients
    creator_id = ref()
    institution_id = ref()
    source_type = sc(20, index=True)                # Web Scraped | Manual Entry
    source_url = sc(1000, nullable=True)
    submitted_by_user_id = ref()                    # the employee who logged it (manual entries)
    submitted_by_label = sc(200, nullable=True)     # scraper name, or the employee's name
    dedup_key = sc(300, unique=True, index=True)    # normalised source URL, or title + institution
    extra = json_col()


class RegistryLike(Base, StdColumns):
    """One employee liking one registry record (at most once)."""
    __tablename__ = "registry_likes"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_registry_like"),)
    project_id = ref(False)
    user_id = ref(False)


class BusinessCard(Base, StdColumns):
    """A photo of a business card collected with a registry record, and the contact printed on it.
    Images are stored small (WebP): `image` ~20 KB for reading, `thumb` ~6 KB for the record card."""
    __tablename__ = "registry_business_cards"
    __table_args__ = (UniqueConstraint("project_id", "match_key", name="uq_registry_card"),)
    project_id = ref(False)
    contact_name = sc(200, nullable=True)
    designation = sc(200, nullable=True)
    phone = sc(80, nullable=True)
    email = sc(300, nullable=True)
    details = json_col()                            # other phones, WhatsApp, all emails, address, notes
    image = mapped_column(LargeBinary, nullable=True)
    thumb = mapped_column(LargeBinary, nullable=True)
    content_type = sc(40, default="image/webp")
    width = integer()
    height = integer()
    sort_order = integer(0)
    match_key = sc(300)                             # lower-cased contact name (or card number), so a re-import never duplicates
