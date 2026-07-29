from __future__ import annotations

import base64
from datetime import datetime, timezone
from html import escape
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


_GREEN = colors.HexColor("#087F5B")
_INK = colors.HexColor("#17251F")
_MUTED = colors.HexColor("#5D6E66")
_LINE = colors.HexColor("#D9E2DE")
_PALE = colors.HexColor("#F3F7F5")


def public_offer_reference(reference: str) -> str:
    return reference.removeprefix("VAL-")


def _money(currency: str, value: float | int | None) -> str:
    return f"{currency} {float(value or 0):,.2f}"


def _line_items(items: list | None) -> list[dict]:
    cleaned: list[dict] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        amount = max(0.0, float(item.get("amount") or 0))
        if label and amount:
            cleaned.append(
                {
                    "label": label[:120],
                    "amount": round(amount, 2),
                    "description": str(item.get("description") or "").strip()[:500],
                },
            )
    return cleaned


def compensation_totals(
    *,
    base_compensation: float | None,
    variable_compensation: float,
    benefits_value: float,
    earnings: list | None,
    deductions: list | None,
) -> dict:
    additions = _line_items(earnings)
    deduction_items = _line_items(deductions)
    base = max(0.0, float(base_compensation or 0))
    variable = max(0.0, float(variable_compensation or 0))
    benefits = max(0.0, float(benefits_value or 0))
    additions_total = sum(item["amount"] for item in additions)
    deductions_total = sum(item["amount"] for item in deduction_items)
    gross_cash = base + variable + additions_total
    total_ctc = gross_cash + benefits
    return {
        "earnings": additions,
        "deductions": deduction_items,
        "additions_total": round(additions_total, 2),
        "deductions_total": round(deductions_total, 2),
        "gross_cash": round(gross_cash, 2),
        "estimated_net": round(max(0.0, gross_cash - deductions_total), 2),
        "total_ctc": round(total_ctc, 2),
    }


def _logo_flowable(logo_url: str):
    if not logo_url.startswith("data:image/"):
        return None
    try:
        header, encoded = logo_url.split(",", 1)
        if ";base64" not in header:
            return None
        image = Image(BytesIO(base64.b64decode(encoded)), width=42 * mm, height=16 * mm)
        image._restrictSize(42 * mm, 16 * mm)
        return image
    except (ValueError, TypeError):
        return None


def render_offer_pdf(
    offer,
    organization,
    *,
    company_logo_url: str = "",
    signed: bool = False,
) -> bytes:
    buffer = BytesIO()
    company_name = (organization.legal_name or organization.name).strip()
    reference = public_offer_reference(offer.offer_reference)
    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.3,
        leading=14,
        textColor=_INK,
        spaceAfter=7,
    )
    small = ParagraphStyle("Small", parent=body, fontSize=7.8, leading=11, textColor=_MUTED)
    heading = ParagraphStyle(
        "Heading",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=17,
        textColor=_INK,
        spaceBefore=12,
        spaceAfter=7,
    )
    title = ParagraphStyle(
        "Title",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=21,
        leading=25,
        textColor=_INK,
        spaceAfter=5,
    )
    right = ParagraphStyle("Right", parent=small, alignment=TA_RIGHT)
    center = ParagraphStyle("Center", parent=small, alignment=TA_CENTER)

    def footer(canvas, doc):
        canvas.saveState()
        if doc.page > 1:
            canvas.setFont("Helvetica-Bold", 9)
            canvas.setFillColor(_INK)
            canvas.drawString(18 * mm, A4[1] - 15 * mm, company_name[:80])
            canvas.setFont("Helvetica", 7)
            canvas.setFillColor(_MUTED)
            canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 15 * mm, f"PRIVATE & CONFIDENTIAL | {reference}")
            canvas.setStrokeColor(_LINE)
            canvas.line(18 * mm, A4[1] - 18 * mm, A4[0] - 18 * mm, A4[1] - 18 * mm)
        canvas.setStrokeColor(_LINE)
        canvas.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(_MUTED)
        canvas.drawString(18 * mm, 9 * mm, f"Private and confidential | {company_name}")
        canvas.drawRightString(A4[0] - 18 * mm, 9 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=27 * mm,
        bottomMargin=20 * mm,
        title=f"Offer of employment - {offer.candidate_name_snapshot}",
        author=company_name,
        subject=f"Employment offer for {offer.job_title_snapshot}",
    )
    def brand_header() -> Table:
        logo = _logo_flowable(company_logo_url)
        brand = logo or Paragraph(f"<b>{escape(company_name)}</b>", ParagraphStyle("Brand", parent=heading, fontSize=16))
        table = Table(
            [[brand, Paragraph(f"<b>PRIVATE &amp; CONFIDENTIAL</b><br/>{escape(reference)}", right)]],
            colWidths=[112 * mm, 47 * mm],
        )
        table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 12)]))
        return table

    issued = offer.released_at or datetime.now(timezone.utc)
    start_date = offer.start_date.strftime("%d %B %Y") if offer.start_date else "To be mutually agreed"
    expires = offer.expires_at.strftime("%d %B %Y") if offer.expires_at else "As communicated"
    totals = compensation_totals(
        base_compensation=offer.base_compensation,
        variable_compensation=offer.variable_compensation,
        benefits_value=offer.benefits_value,
        earnings=offer.earnings_json,
        deductions=offer.deductions_json,
    )
    story = [
        brand_header(),
        Paragraph(issued.strftime("%d %B %Y"), body),
        Spacer(1, 3 * mm),
        Paragraph(escape(offer.candidate_name_snapshot), body),
        Paragraph(f"<b>Subject: Offer of employment as {escape(offer.job_title_snapshot)}</b>", body),
        Spacer(1, 2 * mm),
        Paragraph(f"Dear {escape(offer.candidate_name_snapshot)},", body),
        Paragraph("<br/>".join(escape(offer.letter_body).splitlines()), body),
        Paragraph(
            f"We are pleased to appoint you as <b>{escape(offer.job_title_snapshot)}</b> on the terms set out in this letter and its compensation schedule. "
            "This document supersedes prior oral discussions concerning the matters recorded here.",
            body,
        ),
        Paragraph("1. Appointment details", heading),
    ]
    appointment_rows = [
        ["Employment type", offer.employment_type or "Full-time"],
        ["Proposed start date", start_date],
        ["Work location", offer.work_location or "As assigned by the company"],
        ["Reporting manager", offer.reporting_manager or "As notified by the company"],
        ["Probation", f"{int(offer.probation_months or 0)} months"],
        ["Notice period", f"{int(offer.notice_period_days or 0)} days"],
        ["Offer acceptance deadline", expires],
    ]
    story.append(_detail_table(appointment_rows, body))
    story.extend(
        [
            Paragraph("2. Compensation", heading),
            Paragraph(
                f"Your annual total cost to company is <b>{_money(offer.currency, totals['total_ctc'])}</b>. "
                "The detailed schedule in Annexure A forms an integral part of this offer. Payroll amounts are subject to attendance, eligibility, policy conditions, tax withholding, and statutory deductions.",
                body,
            ),
            Paragraph("3. Duties and performance", heading),
            Paragraph(
                "You will faithfully perform the responsibilities of your role, comply with reasonable instructions, maintain professional standards, and devote your working time and attention to the company. "
                "Your responsibilities, reporting line, title, or work arrangements may reasonably change to meet business requirements.",
                body,
            ),
            Paragraph("4. Probation and confirmation", heading),
            Paragraph(
                "During probation, performance, conduct, attendance, and role suitability will be reviewed. Confirmation is not automatic and will be communicated in writing. "
                "The company may extend probation where permitted by applicable law and policy.",
                body,
            ),
            Paragraph("5. Working arrangements, leave, and benefits", heading),
            Paragraph(
                "Working hours, weekly rest, holidays, leave, reimbursements, insurance, retirement benefits, and other benefits will be governed by applicable law and current company policy. "
                "Discretionary benefits and incentive plans may be amended or withdrawn in accordance with their governing terms.",
                body,
            ),
            Paragraph("6. Confidentiality and information security", heading),
            Paragraph(
                "During and after employment you must protect confidential information belonging to the company, its customers, candidates, suppliers, and employees. "
                "You must follow information-security, acceptable-use, records-retention, privacy, and access-control policies and immediately report suspected loss or unauthorized disclosure.",
                body,
            ),
            Paragraph("7. Intellectual property", heading),
            Paragraph(
                "To the extent permitted by law, work product, inventions, designs, software, documents, processes, and other materials created within the scope of employment or using company resources will belong to the company. "
                "You agree to execute documents reasonably required to confirm those rights.",
                body,
            ),
            Paragraph("8. Conflicts, outside interests, and company property", heading),
            Paragraph(
                "You must disclose actual or potential conflicts of interest and obtain required approval before outside employment or commercial activity. "
                "All company property, credentials, records, devices, and copies must be protected and returned promptly on request or separation.",
                body,
            ),
            Paragraph("9. Verification and continuing conditions", heading),
            Paragraph(
                "This offer is conditional upon satisfactory identity, education, employment, reference, right-to-work, compliance, and other lawful verification. "
                "Material misrepresentation or failure to meet a mandatory condition may result in withdrawal of the offer or appropriate action.",
                body,
            ),
            Paragraph("10. Separation and notice", heading),
            Paragraph(
                f"Employment may be ended by either party by giving {int(offer.notice_period_days or 0)} days' notice or payment in lieu where permitted. "
                "The company may take action without notice in circumstances recognized by law or policy. Final settlement remains subject to return of property, recoveries, taxes, and statutory requirements.",
                body,
            ),
            Paragraph("11. Policies, law, and complete agreement", heading),
            Paragraph("<br/>".join(escape(offer.terms_text).splitlines()), body),
            Paragraph(
                "Company policies, as updated from time to time, apply to your employment but do not override mandatory law. If one provision is unenforceable, the remaining provisions continue to apply. "
                "Any amendment to this offer must be recorded in writing by an authorized company representative.",
                body,
            ),
            Paragraph("12. Acceptance", heading),
            Paragraph(
                "Please review the complete document carefully. By accepting electronically, you confirm that you have read and understood this offer, had the opportunity to seek clarification, and agree to its terms.",
                body,
            ),
            Spacer(1, 10 * mm),
        ],
    )
    if signed:
        story.append(
            KeepTogether(
                [
                    Paragraph("<b>Accepted electronically</b>", heading),
                    _detail_table(
                        [
                            ["Candidate", offer.signature_name or offer.candidate_name_snapshot],
                            ["Accepted at", offer.signed_at.isoformat() if offer.signed_at else ""],
                            ["Document reference", reference],
                            ["Document hash", offer.signed_document_hash or "Recorded with signed copy"],
                        ],
                        body,
                    ),
                ],
            ),
        )
    else:
        story.extend(
            [
                Table(
                    [
                        ["For the company", "Candidate acceptance"],
                        ["Authorized signatory", offer.candidate_name_snapshot],
                        ["Date: ____________________", "Date: ____________________"],
                    ],
                    colWidths=[79 * mm, 79 * mm],
                    style=TableStyle(
                        [
                            ("BOX", (0, 0), (-1, -1), 0.5, _LINE),
                            ("INNERGRID", (0, 0), (-1, -1), 0.5, _LINE),
                            ("BACKGROUND", (0, 0), (-1, 0), _PALE),
                            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                            ("TEXTCOLOR", (0, 0), (-1, -1), _INK),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("PADDING", (0, 0), (-1, -1), 8),
                        ],
                    ),
                ),
            ],
        )

    story.extend([PageBreak(), Paragraph("Annexure A - Compensation schedule", title)])
    compensation_rows = [["Component", "Annual amount", "Monthly equivalent"]]
    compensation_rows.append(["Base compensation", _money(offer.currency, offer.base_compensation), _money(offer.currency, float(offer.base_compensation or 0) / 12)])
    if offer.variable_compensation:
        compensation_rows.append(["Variable / performance pay", _money(offer.currency, offer.variable_compensation), _money(offer.currency, float(offer.variable_compensation) / 12)])
    for item in totals["earnings"]:
        compensation_rows.append([item["label"], _money(offer.currency, item["amount"]), _money(offer.currency, item["amount"] / 12)])
    compensation_rows.append(["Gross cash compensation", _money(offer.currency, totals["gross_cash"]), _money(offer.currency, totals["gross_cash"] / 12)])
    if offer.benefits_value:
        compensation_rows.append(["Employer-paid benefits / contributions", _money(offer.currency, offer.benefits_value), _money(offer.currency, float(offer.benefits_value) / 12)])
    compensation_rows.append(["Total cost to company", _money(offer.currency, totals["total_ctc"]), _money(offer.currency, totals["total_ctc"] / 12)])
    story.append(_money_table(compensation_rows, body))
    story.append(Paragraph("Indicative deductions", heading))
    deduction_rows = [["Deduction", "Annual amount", "Monthly equivalent"]]
    for item in totals["deductions"]:
        deduction_rows.append([item["label"], _money(offer.currency, item["amount"]), _money(offer.currency, item["amount"] / 12)])
    if len(deduction_rows) == 1:
        deduction_rows.append(["Statutory and payroll deductions", "Calculated during payroll", "Calculated during payroll"])
    deduction_rows.append(["Total configured deductions", _money(offer.currency, totals["deductions_total"]), _money(offer.currency, totals["deductions_total"] / 12)])
    deduction_rows.append(["Estimated net cash compensation", _money(offer.currency, totals["estimated_net"]), _money(offer.currency, totals["estimated_net"] / 12)])
    story.append(_money_table(deduction_rows, body))
    story.extend(
        [
            Spacer(1, 4 * mm),
            Paragraph(
                "<b>Important payroll note:</b> Monthly equivalents are annual amounts divided by twelve for presentation only. "
                "Actual take-home pay may differ because of variable-pay eligibility, joining date, attendance, tax declarations, statutory ceilings, payroll timing, reimbursements, benefits, and changes in law or policy. "
                "This schedule is an employment compensation statement and not a payslip or tax computation.",
                small,
            ),
            Paragraph(
                "Where a component is described as variable, discretionary, reimbursable, retention-linked, or benefit-in-kind, it is payable only under the applicable plan or policy and may not form part of fixed wages.",
                small,
            ),
            Spacer(1, 8 * mm),
            Paragraph(f"<b>{escape(company_name)}</b>", body),
            Paragraph(f"Document reference: {escape(reference)}", center),
        ],
    )
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def _detail_table(rows: list[list[str]], body_style) -> Table:
    data = [[Paragraph(f"<b>{escape(str(label))}</b>", body_style), Paragraph(escape(str(value)), body_style)] for label, value in rows]
    table = Table(data, colWidths=[51 * mm, 108 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, _LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, _LINE),
                ("BACKGROUND", (0, 0), (0, -1), _PALE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("PADDING", (0, 0), (-1, -1), 7),
            ],
        ),
    )
    return table


def _money_table(rows: list[list[str]], body_style) -> Table:
    header_style = ParagraphStyle("MoneyHeader", parent=body_style, textColor=colors.white, fontName="Helvetica-Bold")
    data = [
        [Paragraph(escape(str(cell)), header_style if row_index == 0 else body_style) for cell in row]
        for row_index, row in enumerate(rows)
    ]
    table = Table(data, colWidths=[79 * mm, 40 * mm, 40 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.5, _LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, _LINE),
                ("BACKGROUND", (0, 0), (-1, 0), _GREEN),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("PADDING", (0, 0), (-1, -1), 7),
            ],
        ),
    )
    return table
