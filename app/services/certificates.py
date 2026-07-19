import secrets
from datetime import datetime, timezone
from pathlib import Path

try:
    from reportlab.graphics import renderPDF
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
except ImportError:  # pragma: no cover - runtime dependency safety
    renderPDF = None
    QrCodeWidget = None
    Drawing = None
    colors = None
    A4 = None
    landscape = None
    canvas = None
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import Certificate, CertificateStatus, Course, Exam, ProviderProfile, Result, User
from app.services.media_storage import resolve_media_url, upload_file_to_cloud_storage


def _certificate_media_dir() -> Path:
    root = Path(get_settings().resolved_media_dir) / "certificates"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _certificate_logo_path() -> Path:
    assets_dir = Path(__file__).resolve().parent.parent / "web" / "assets"
    primary = assets_dir / "classagon_logo.png"
    if primary.exists():
        return primary
    return assets_dir / "certora_logo.png"


def _certificate_pdf_relpath(certificate_id: str) -> str:
    return f"/media/certificates/{certificate_id}.pdf"


def _ensure_pdf_engine() -> None:
    if not all((colors, A4, landscape, canvas)):
        raise RuntimeError("Certificate PDF engine unavailable. Install reportlab.")


def _absolute_url(path_or_url: str | None) -> str | None:
    if not path_or_url:
        return None
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        return path_or_url
    return f"{get_settings().app_base_url.rstrip('/')}{path_or_url}"


def certificate_verification_url(certificate: Certificate, *, base_url: str | None = None) -> str:
    base = (base_url or get_settings().app_base_url).rstrip("/")
    return f"{base}/certificates/verify/{certificate.certificate_id}?vt={certificate.verification_token}"


def safe_certificate_verification_url(certificate: Certificate, *, base_url: str | None = None) -> str | None:
    try:
        return certificate_verification_url(certificate, base_url=base_url)
    except Exception:
        return None


def _masked_name(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return text
    masked_chars: list[str] = []
    visible_idx = 0
    for ch in text:
        if ch.isalnum():
            masked_chars.append(ch if (visible_idx % 4) == 0 else "*")
            visible_idx += 1
        else:
            masked_chars.append(ch)
    return "".join(masked_chars)


CERTIFICATE_TEMPLATE_VERSION = "v14"


def _font_size_to_fit(
    c: canvas.Canvas,
    text: str,
    *,
    font_name: str,
    max_width: float,
    max_size: float,
    min_size: float,
) -> float:
    size = float(max_size)
    if not text:
        return size
    while size > float(min_size):
        if c.stringWidth(text, font_name, size) <= max_width:
            return size
        size -= 0.5
    return float(min_size)


def _trim_to_width(c: canvas.Canvas, text: str, *, font_name: str, font_size: float, max_width: float) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    if c.stringWidth(raw, font_name, font_size) <= max_width:
        return raw
    suffix = "..."
    out = raw
    while out and c.stringWidth(out + suffix, font_name, font_size) > max_width:
        out = out[:-1]
    return (out + suffix) if out else suffix


def _has_current_template_pdf(certificate: Certificate) -> bool:
    url = str(certificate.pdf_url or "")
    if not url:
        return False
    marker = f"/{CERTIFICATE_TEMPLATE_VERSION}/"
    return marker in url or f"{CERTIFICATE_TEMPLATE_VERSION}/" in url


def _load_certificate_context(db: Session, certificate: Certificate) -> dict:
    course = db.get(Course, certificate.course_id)
    provider = db.get(ProviderProfile, certificate.provider_id)
    student = db.get(User, certificate.student_id)
    result = db.get(Result, certificate.result_id)
    if not course or not provider or not student or not result:
        raise ValueError("Certificate context is incomplete")
    return {
        "course": course,
        "provider": provider,
        "student": student,
        "result": result,
    }


def render_certificate_pdf(db: Session, certificate: Certificate, *, verification_base_url: str | None = None) -> str:
    _ensure_pdf_engine()
    ctx = _load_certificate_context(db, certificate)
    course: Course = ctx["course"]
    provider: ProviderProfile = ctx["provider"]
    student: User = ctx["student"]
    result: Result = ctx["result"]

    out_path = _certificate_media_dir() / f"{certificate.certificate_id}.pdf"
    page_width, page_height = landscape(A4)
    c = canvas.Canvas(str(out_path), pagesize=(page_width, page_height))

    # Background
    c.setFillColor(colors.HexColor("#f7f2e7"))
    c.rect(0, 0, page_width, page_height, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#fffdf8"))
    c.roundRect(26, 26, page_width - 52, page_height - 52, 18, fill=1, stroke=0)

    # Dual border
    c.setStrokeColor(colors.HexColor("#b68a2e"))
    c.setLineWidth(3)
    c.roundRect(34, 34, page_width - 68, page_height - 68, 16, stroke=1, fill=0)
    c.setStrokeColor(colors.HexColor("#d6b35d"))
    c.setLineWidth(1)
    c.roundRect(48, 48, page_width - 96, page_height - 96, 14, stroke=1, fill=0)

    # Header branding (no top bar)
    logo_path = _certificate_logo_path()
    if logo_path.exists():
        logo_w = 340
        logo_h = 84
        logo_x = (page_width - logo_w) / 2
        logo_y = page_height - 132
        c.drawImage(
            str(logo_path),
            logo_x,
            logo_y,
            width=logo_w,
            height=logo_h,
            mask="auto",
            preserveAspectRatio=True,
            anchor="c",
        )

    # Main title
    c.setFillColor(colors.HexColor("#8a6a1f"))
    c.setFont("Times-Bold", 28)
    c.drawCentredString(page_width / 2, page_height - 172, "Certificate of Achievement")

    c.setFillColor(colors.HexColor("#475569"))
    c.setFont("Helvetica", 12)
    c.drawCentredString(page_width / 2, page_height - 198, "This certifies that")

    student_name = (student.full_name or "").strip()
    name_font = _font_size_to_fit(
        c,
        student_name,
        font_name="Times-Bold",
        max_width=page_width - 190,
        max_size=31,
        min_size=20,
    )
    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("Times-Bold", name_font)
    c.drawCentredString(page_width / 2, page_height - 232, student_name)

    c.setStrokeColor(colors.HexColor("#caa14d"))
    c.setLineWidth(1.2)
    c.line(page_width / 2 - 225, page_height - 246, page_width / 2 + 225, page_height - 246)

    c.setFillColor(colors.HexColor("#475569"))
    c.setFont("Helvetica", 12)
    c.drawCentredString(page_width / 2, page_height - 270, "has successfully completed the course and passed the final assessment")

    course_title = _trim_to_width(
        c,
        course.title or "",
        font_name="Helvetica-Bold",
        font_size=21,
        max_width=page_width - 200,
    )
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 21)
    c.drawCentredString(page_width / 2, page_height - 304, course_title)

    c.setFillColor(colors.HexColor("#334155"))
    c.setFont("Helvetica", 11.5)
    c.drawCentredString(page_width / 2, page_height - 332, f"Issued by {provider.display_name} through Classagon")

    # Pass/result block (aligned card)
    score_y = page_height - 380
    score_text = f"{float(result.percentage or 0):.2f}%"
    score_text_width = c.stringWidth(score_text, "Helvetica-Bold", 14)
    pass_text_width = c.stringWidth("PASS", "Helvetica-Bold", 9)
    card_width = max(104, score_text_width + 30, pass_text_width + 38)
    card_height = 34
    card_x = (page_width - card_width) / 2
    card_y = score_y - 10
    c.setFillColor(colors.HexColor("#f9f4e6"))
    c.roundRect(card_x, card_y, card_width, card_height, 8, fill=1, stroke=0)
    c.setStrokeColor(colors.HexColor("#d6b35d"))
    c.setLineWidth(1)
    c.roundRect(card_x, card_y, card_width, card_height, 8, fill=0, stroke=1)
    c.setFillColor(colors.HexColor("#9a6f19"))
    c.setFont("Helvetica-Bold", 8.2)
    c.drawCentredString(page_width / 2, score_y + 14, "PASS")
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(page_width / 2, score_y - 1, score_text)

    # Footer metadata (trimmed; details move under QR)
    # QR-only verification block
    verification_url = certificate_verification_url(certificate, base_url=verification_base_url)
    qr_size = 62
    qr_x = page_width - 176
    qr_y = 96
    c.setFillColor(colors.HexColor("#1f2937"))
    c.setFont("Helvetica-Bold", 9)
    c.drawString(qr_x - 10, qr_y + qr_size + 12, "For verification, scan QR")
    if QrCodeWidget and Drawing and renderPDF:
        qr_widget = QrCodeWidget(verification_url)
        bounds = qr_widget.getBounds()
        qr_w = bounds[2] - bounds[0]
        qr_h = bounds[3] - bounds[1]
        drawing = Drawing(qr_size, qr_size, transform=[qr_size / qr_w, 0, 0, qr_size / qr_h, 0, 0])
        drawing.add(qr_widget)
        renderPDF.draw(drawing, c, qr_x, qr_y)
    c.setStrokeColor(colors.HexColor("#cbd5e1"))
    c.setLineWidth(1)
    c.rect(qr_x - 6, qr_y - 6, qr_size + 12, qr_size + 12, stroke=1, fill=0)
    c.setFillColor(colors.HexColor("#475569"))
    c.setFont("Helvetica", 8)
    qr_text_width = 154
    c.drawString(
        qr_x - 10,
        qr_y - 15,
        _trim_to_width(c, certificate.certificate_id, font_name="Helvetica", font_size=8, max_width=qr_text_width),
    )

    # Signature (centered)
    sig_y = 92
    sig_label = "Classagon"
    sig_font_name = "Times-Italic"
    sig_font_size = 30
    sig_width = c.stringWidth(sig_label, sig_font_name, sig_font_size)
    pad = 20
    sig_x1 = (page_width - (sig_width + (pad * 2))) / 2
    sig_x2 = sig_x1 + sig_width + (pad * 2)
    c.setStrokeColor(colors.HexColor("#94a3b8"))
    c.setLineWidth(1)
    c.line(sig_x1, sig_y, sig_x2, sig_y)
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont(sig_font_name, sig_font_size)
    c.drawString((page_width - sig_width) / 2, sig_y + 6, sig_label)
    c.setFillColor(colors.HexColor("#475569"))
    c.setFont("Helvetica", 9)
    signatory_label = "Authorized Digital Signatory"
    c.drawString((page_width - c.stringWidth(signatory_label, "Helvetica", 9)) / 2, sig_y - 14, signatory_label)

    c.showPage()
    c.save()
    settings = get_settings()
    if settings.resolved_object_storage_backend == "local":
        raise RuntimeError("Certificate storage requires a cloud backend configuration (Bunny, S3, or Firebase).")
    course_segment = f"course-{int(certificate.course_id)}"
    return upload_file_to_cloud_storage(
        out_path,
        object_path=f"certificates/{course_segment}/{CERTIFICATE_TEMPLATE_VERSION}/{certificate.certificate_id}.pdf",
        content_type="application/pdf",
    )


def ensure_certificate_pdf(
    db: Session,
    certificate: Certificate,
    *,
    force_regenerate: bool = False,
    verification_base_url: str | None = None,
) -> Certificate:
    if certificate.pdf_url and not force_regenerate:
        if certificate.pdf_url.startswith("http://") or certificate.pdf_url.startswith("https://"):
            return certificate
        existing_path = Path(get_settings().resolved_media_dir) / certificate.pdf_url.replace("/media/", "", 1)
        if existing_path.exists():
            return certificate
    certificate.pdf_url = render_certificate_pdf(db, certificate, verification_base_url=verification_base_url)
    db.flush()
    return certificate


def issue_certificate(db: Session, result: Result, *, verification_base_url: str | None = None) -> Certificate:
    existing = db.scalar(select(Certificate).where(Certificate.result_id == result.id))
    if existing:
        try:
            return ensure_certificate_pdf(
                db,
                existing,
                force_regenerate=True,
                verification_base_url=verification_base_url,
            )
        except RuntimeError:
            # Keep existing certificate row usable even if PDF engine/storage is temporarily unavailable.
            return existing

    exam = db.get(Exam, result.exam_id)
    if not exam:
        raise ValueError("Exam not found for certificate generation")
    if not exam.certificate_enabled:
        raise ValueError("Certificates are disabled for this assessment")
    course = db.get(Course, exam.course_id)
    if not course:
        raise ValueError("Related course not found for certificate generation")

    provider = db.get(ProviderProfile, course.provider_id)
    if not provider:
        raise ValueError("Provider not found for certificate generation")

    cert = Certificate(
        result_id=result.id,
        student_id=result.student_id,
        course_id=course.id,
        provider_id=provider.id,
        certificate_id=secrets.token_hex(8).upper(),
        verification_token=secrets.token_hex(16),
        pdf_url=None,
        status=CertificateStatus.ACTIVE,
        issued_at=datetime.now(timezone.utc),
    )
    db.add(cert)
    db.flush()
    try:
        return ensure_certificate_pdf(db, cert, verification_base_url=verification_base_url)
    except RuntimeError:
        # Preserve issued certificate row; PDF can be generated lazily later.
        return cert


def certificate_payload(
    db: Session,
    certificate: Certificate,
    *,
    mask_identity: bool = False,
    verification_base_url: str | None = None,
) -> dict:
    if not _has_current_template_pdf(certificate):
        try:
            ensure_certificate_pdf(
                db,
                certificate,
                force_regenerate=True,
                verification_base_url=verification_base_url,
            )
            db.flush()
        except RuntimeError:
            # Return payload with existing file/link if regeneration is temporarily unavailable.
            pass
    course = db.get(Course, certificate.course_id)
    provider = db.get(ProviderProfile, certificate.provider_id)
    student = db.get(User, certificate.student_id)
    result = db.get(Result, certificate.result_id)
    pdf_url = resolve_media_url(certificate.pdf_url) or _absolute_url(certificate.pdf_url)
    verification_link = safe_certificate_verification_url(certificate, base_url=verification_base_url)
    return {
        "certificate_id": certificate.certificate_id,
        "result_id": certificate.result_id,
        "student_id": certificate.student_id,
        "student_name": (_masked_name(student.full_name) if (student and mask_identity) else (student.full_name if student else None)),
        "course_id": certificate.course_id,
        "course_name": course.title if course else None,
        "provider_id": certificate.provider_id,
        "provider_name": provider.display_name if provider else None,
        "score": result.score if result else None,
        "percentage": result.percentage if result else None,
        "status": certificate.status,
        "issued_at": certificate.issued_at,
        "pdf_url": pdf_url,
        "download_url": pdf_url,
        "verification_link": verification_link,
    }
