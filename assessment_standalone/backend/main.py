import json
import os
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Optional

import jwt
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


BASE_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = BASE_DIR / "frontend"
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("ASSESSMENT_DB_URL", f"sqlite:///{(DATA_DIR / 'assessment.db').as_posix()}")
JWT_SECRET = os.getenv("ASSESSMENT_JWT_SECRET", "change_this_in_production")
JWT_ALGO = "HS256"
TOKEN_TTL_HOURS = 24

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()


class Base(DeclarativeBase):
    pass


class Recruiter(Base):
    __tablename__ = "recruiters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    templates: Mapped[list["AssessmentTemplate"]] = relationship(back_populates="owner")
    issues: Mapped[list["IssuedAssessment"]] = relationship(back_populates="recruiter")


class AssessmentTemplate(Base):
    __tablename__ = "assessment_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30)
    pass_score_pct: Mapped[float] = mapped_column(Float, default=70.0)
    is_catalog: Mapped[bool] = mapped_column(Boolean, default=False)
    owner_recruiter_id: Mapped[Optional[int]] = mapped_column(ForeignKey("recruiters.id"), nullable=True)
    questions_json: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    owner: Mapped[Optional["Recruiter"]] = relationship(back_populates="templates")
    issued: Mapped[list["IssuedAssessment"]] = relationship(back_populates="template")


class IssuedAssessment(Base):
    __tablename__ = "issued_assessments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recruiter_id: Mapped[int] = mapped_column(ForeignKey("recruiters.id"))
    template_id: Mapped[int] = mapped_column(ForeignKey("assessment_templates.id"))
    candidate_name: Mapped[str] = mapped_column(String(140))
    candidate_email: Mapped[str] = mapped_column(String(255), index=True)
    candidate_username: Mapped[str] = mapped_column(String(140), unique=True, index=True)
    candidate_password_hash: Mapped[str] = mapped_column(String(255))
    credential_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(40), default="issued")
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    score_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    passed: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    result_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    recruiter: Mapped["Recruiter"] = relationship(back_populates="issues")
    template: Mapped["AssessmentTemplate"] = relationship(back_populates="issued")


engine = create_engine(DATABASE_URL, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return pwd_ctx.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_ctx.verify(password, hashed)


def create_token(subject: str, role: str, ref_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "role": role,
        "ref_id": ref_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=TOKEN_TTL_HOURS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def recruiter_guard(creds: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)) -> Recruiter:
    payload = decode_token(creds.credentials)
    if payload.get("role") != "recruiter":
        raise HTTPException(status_code=403, detail="Recruiter access required")
    recruiter = db.get(Recruiter, int(payload["ref_id"]))
    if not recruiter:
        raise HTTPException(status_code=401, detail="Recruiter not found")
    return recruiter


def candidate_guard(creds: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)) -> IssuedAssessment:
    payload = decode_token(creds.credentials)
    if payload.get("role") != "candidate":
        raise HTTPException(status_code=403, detail="Candidate access required")
    issued = db.get(IssuedAssessment, int(payload["ref_id"]))
    if not issued:
        raise HTTPException(status_code=401, detail="Candidate session not found")
    return issued


def send_credentials_email(candidate_email: str, candidate_name: str, username: str, password: str, assessment_title: str) -> bool:
    smtp_host = os.getenv("ASSESSMENT_SMTP_HOST", "").strip()
    smtp_port = int(os.getenv("ASSESSMENT_SMTP_PORT", "587"))
    smtp_user = os.getenv("ASSESSMENT_SMTP_USER", "").strip()
    smtp_pass = os.getenv("ASSESSMENT_SMTP_PASS", "").strip()
    sender = os.getenv("ASSESSMENT_FROM_EMAIL", "no-reply@valases.local")

    body = (
        f"Hi {candidate_name},\n\n"
        f"You have been issued an assessment: {assessment_title}\n\n"
        f"Login credentials:\n"
        f"Username: {username}\n"
        f"Password: {password}\n\n"
        f"Open the assessment portal and login to attempt.\n"
    )

    if smtp_host:
        msg = EmailMessage()
        msg["Subject"] = f"Assessment Credentials - {assessment_title}"
        msg["From"] = sender
        msg["To"] = candidate_email
        msg.set_content(body)
        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as smtp:
            smtp.starttls()
            if smtp_user:
                smtp.login(smtp_user, smtp_pass)
            smtp.send_message(msg)
        return True

    outbox = DATA_DIR / "outbox_emails.log"
    with outbox.open("a", encoding="utf-8") as f:
        f.write(f"\n--- {datetime.now(timezone.utc).isoformat()} ---\nTO: {candidate_email}\n{body}\n")
    return True


class RecruiterSignupIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=80)


class RecruiterLoginIn(BaseModel):
    email: EmailStr
    password: str


class QuestionIn(BaseModel):
    text: str = Field(min_length=3, max_length=500)
    options: list[str] = Field(min_length=2, max_length=6)
    correct_index: int = Field(ge=0)


class TemplateCreateIn(BaseModel):
    title: str = Field(min_length=3, max_length=180)
    description: str = Field(default="", max_length=4000)
    duration_minutes: int = Field(ge=5, le=180)
    pass_score_pct: float = Field(ge=70, le=100)
    questions: list[QuestionIn] = Field(min_length=1, max_length=100)


class IssueIn(BaseModel):
    template_id: int
    candidate_name: str = Field(min_length=2, max_length=140)
    candidate_email: EmailStr


class CandidateLoginIn(BaseModel):
    username: str
    password: str


class CandidateSubmitIn(BaseModel):
    answers: dict[str, int]


app = FastAPI(title="Assessment Standalone")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def web_index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/health")
def health():
    return {"status": "ok", "service": "assessment-standalone"}


@app.post("/api/recruiters/signup")
def recruiter_signup(payload: RecruiterSignupIn, db: Session = Depends(get_db)):
    exists = db.scalar(select(Recruiter).where(Recruiter.email == payload.email.lower()))
    if exists:
        raise HTTPException(status_code=409, detail="Recruiter email already exists")
    r = Recruiter(name=payload.name.strip(), email=payload.email.lower(), password_hash=hash_password(payload.password))
    db.add(r)
    db.commit()
    db.refresh(r)
    token = create_token(r.email, "recruiter", r.id)
    return {"token": token, "recruiter": {"id": r.id, "name": r.name, "email": r.email}}


@app.post("/api/recruiters/login")
def recruiter_login(payload: RecruiterLoginIn, db: Session = Depends(get_db)):
    r = db.scalar(select(Recruiter).where(Recruiter.email == payload.email.lower()))
    if not r or not verify_password(payload.password, r.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(r.email, "recruiter", r.id)
    return {"token": token, "recruiter": {"id": r.id, "name": r.name, "email": r.email}}


@app.get("/api/catalog-assessments")
def catalog_assessments(db: Session = Depends(get_db)):
    items = db.scalars(select(AssessmentTemplate).where(AssessmentTemplate.is_catalog.is_(True)).order_by(AssessmentTemplate.id.desc())).all()
    return [
        {
            "id": t.id,
            "title": t.title,
            "description": t.description,
            "duration_minutes": t.duration_minutes,
            "pass_score_pct": t.pass_score_pct,
            "question_count": len(t.questions_json or []),
            "type": "catalog",
        }
        for t in items
    ]


@app.post("/api/recruiter/templates")
def create_template(payload: TemplateCreateIn, recruiter: Recruiter = Depends(recruiter_guard), db: Session = Depends(get_db)):
    questions = [q.model_dump() for q in payload.questions]
    for q in questions:
        if q["correct_index"] >= len(q["options"]):
            raise HTTPException(status_code=400, detail="correct_index out of options range")
    t = AssessmentTemplate(
        title=payload.title.strip(),
        description=payload.description.strip(),
        duration_minutes=payload.duration_minutes,
        pass_score_pct=float(payload.pass_score_pct),
        is_catalog=False,
        owner_recruiter_id=recruiter.id,
        questions_json=questions,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id}


@app.get("/api/recruiter/templates")
def list_templates(recruiter: Recruiter = Depends(recruiter_guard), db: Session = Depends(get_db)):
    own = db.scalars(select(AssessmentTemplate).where(AssessmentTemplate.owner_recruiter_id == recruiter.id).order_by(AssessmentTemplate.id.desc())).all()
    cat = db.scalars(select(AssessmentTemplate).where(AssessmentTemplate.is_catalog.is_(True)).order_by(AssessmentTemplate.id.desc())).all()
    items = own + cat
    return [
        {
            "id": t.id,
            "title": t.title,
            "description": t.description,
            "duration_minutes": t.duration_minutes,
            "pass_score_pct": t.pass_score_pct,
            "question_count": len(t.questions_json or []),
            "type": "catalog" if t.is_catalog else "custom",
        }
        for t in items
    ]


@app.post("/api/recruiter/issues")
def issue_assessment(payload: IssueIn, recruiter: Recruiter = Depends(recruiter_guard), db: Session = Depends(get_db)):
    t = db.get(AssessmentTemplate, payload.template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Assessment template not found")
    if not t.is_catalog and t.owner_recruiter_id != recruiter.id:
        raise HTTPException(status_code=403, detail="Not allowed to issue this template")

    username = f"cand{secrets.token_hex(4)}"
    password = secrets.token_urlsafe(8)
    issue = IssuedAssessment(
        recruiter_id=recruiter.id,
        template_id=t.id,
        candidate_name=payload.candidate_name.strip(),
        candidate_email=payload.candidate_email.lower(),
        candidate_username=username,
        candidate_password_hash=hash_password(password),
        status="issued",
    )
    db.add(issue)
    db.flush()
    sent = send_credentials_email(
        candidate_email=issue.candidate_email,
        candidate_name=issue.candidate_name,
        username=username,
        password=password,
        assessment_title=t.title,
    )
    issue.credential_sent = bool(sent)
    db.commit()
    db.refresh(issue)
    return {"issued_id": issue.id, "credential_sent": issue.credential_sent}


@app.get("/api/recruiter/issues")
def recruiter_issues(recruiter: Recruiter = Depends(recruiter_guard), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(IssuedAssessment).where(IssuedAssessment.recruiter_id == recruiter.id).order_by(IssuedAssessment.id.desc())
    ).all()
    return [
        {
            "issued_id": row.id,
            "candidate_name": row.candidate_name,
            "candidate_email": row.candidate_email,
            "assessment_title": row.template.title,
            "status": row.status,
            "issued_at": row.issued_at.isoformat(),
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
            "score_pct": row.score_pct,
            "passed": row.passed,
            "credential_sent": row.credential_sent,
        }
        for row in rows
    ]


@app.post("/api/candidate/login")
def candidate_login(payload: CandidateLoginIn, db: Session = Depends(get_db)):
    issued = db.scalar(select(IssuedAssessment).where(IssuedAssessment.candidate_username == payload.username))
    if not issued or not verify_password(payload.password, issued.candidate_password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(issued.candidate_username, "candidate", issued.id)
    return {"token": token}


@app.get("/api/candidate/assessment")
def candidate_assessment(issued: IssuedAssessment = Depends(candidate_guard)):
    if issued.status == "completed":
        return {"status": "completed", "score_pct": issued.score_pct, "passed": issued.passed}
    t = issued.template
    questions = []
    for i, q in enumerate(t.questions_json or []):
        questions.append({"qid": str(i), "text": q["text"], "options": q["options"]})
    return {
        "status": "issued",
        "assessment_title": t.title,
        "description": t.description,
        "duration_minutes": t.duration_minutes,
        "pass_score_pct": t.pass_score_pct,
        "candidate_name": issued.candidate_name,
        "questions": questions,
    }


@app.post("/api/candidate/submit")
def candidate_submit(payload: CandidateSubmitIn, issued: IssuedAssessment = Depends(candidate_guard), db: Session = Depends(get_db)):
    if issued.status == "completed":
        raise HTTPException(status_code=409, detail="Assessment already submitted")
    questions = issued.template.questions_json or []
    if not questions:
        raise HTTPException(status_code=400, detail="Assessment has no questions")
    total = len(questions)
    correct = 0
    for i, q in enumerate(questions):
        chosen = payload.answers.get(str(i))
        if isinstance(chosen, int) and chosen == int(q["correct_index"]):
            correct += 1
    score = round((correct / total) * 100.0, 2)
    passed = score >= float(issued.template.pass_score_pct)
    issued.status = "completed"
    issued.completed_at = datetime.now(timezone.utc)
    issued.score_pct = score
    issued.passed = passed
    issued.result_json = {"correct": correct, "total": total}
    db.add(issued)
    db.commit()
    return {"score_pct": score, "passed": passed, "correct": correct, "total": total}


def seed_catalog(db: Session):
    has_catalog = db.scalar(select(AssessmentTemplate).where(AssessmentTemplate.is_catalog.is_(True)).limit(1))
    if has_catalog:
        return
    catalog_items = [
        AssessmentTemplate(
            title="General Aptitude - Beginner",
            description="Basic aptitude screening assessment.",
            duration_minutes=30,
            pass_score_pct=70.0,
            is_catalog=True,
            questions_json=[
                {"text": "2 + 2 = ?", "options": ["3", "4", "5", "6"], "correct_index": 1},
                {"text": "Synonym of 'Rapid'?", "options": ["Slow", "Fast", "Late", "Silent"], "correct_index": 1},
                {"text": "Find odd one out: Apple, Banana, Carrot, Mango", "options": ["Apple", "Banana", "Carrot", "Mango"], "correct_index": 2},
            ],
        ),
        AssessmentTemplate(
            title="Tax Fundamentals Screening",
            description="Entry-level tax concepts for candidate filtering.",
            duration_minutes=35,
            pass_score_pct=70.0,
            is_catalog=True,
            questions_json=[
                {"text": "W-2 is primarily used for?", "options": ["Wages reporting", "Student visa", "Vehicle tax", "Property survey"], "correct_index": 0},
                {"text": "W-4 helps employer with?", "options": ["Vacation policy", "Withholding setup", "Audit filing", "Insurance claim"], "correct_index": 1},
                {"text": "1099 generally reports?", "options": ["Independent income", "School grades", "Medical license", "Passport details"], "correct_index": 0},
            ],
        ),
    ]
    db.add_all(catalog_items)
    db.commit()


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_catalog(db)
