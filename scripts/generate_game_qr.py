"""Generate the public game-detail QR images and PDF download sheets.

Run from the project root:
  py -3 scripts/generate_game_qr.py

Set HACKATHON_PUBLIC_URL before running if the production domain changes.
Requires: qrcode, reportlab
"""

from __future__ import annotations

import os
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_M
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIRECTORY = PROJECT_ROOT / "public" / "images" / "game-qr"
PUBLIC_URL = os.environ.get(
    "HACKATHON_PUBLIC_URL",
    "https://hakertone-app.minjaelove58.workers.dev",
).rstrip("/")
TEAM_NUMBERS = range(1, 16)
KOREAN_FONT = "HYSMyeongJo-Medium"


def make_qr(team_number: int) -> None:
    target_url = f"{PUBLIC_URL}/game?team={team_number}"
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=12,
        border=4,
    )
    qr.add_data(target_url)
    qr.make(fit=True)
    image = qr.make_image(fill_color="#000000", back_color="#ffffff")
    image.save(OUTPUT_DIRECTORY / f"team-{team_number}.png")


def make_pdf(team_number: int) -> None:
    """Create a print-ready A4 sheet containing the team's QR code."""
    pdf_path = OUTPUT_DIRECTORY / f"team-{team_number}.pdf"
    qr_path = OUTPUT_DIRECTORY / f"team-{team_number}.png"
    target_url = f"{PUBLIC_URL}/game?team={team_number}"
    page_width, page_height = A4
    document = canvas.Canvas(str(pdf_path), pagesize=A4, pageCompression=1)

    document.setFillColor(HexColor("#F5F6F8"))
    document.rect(0, 0, page_width, page_height, fill=1, stroke=0)
    document.setFillColor(HexColor("#FFFFFF"))
    document.roundRect(24 * mm, 24 * mm, page_width - 48 * mm, page_height - 48 * mm, 7 * mm, fill=1, stroke=0)

    document.setFillColor(HexColor("#3556D8"))
    document.roundRect((page_width - 42 * mm) / 2, page_height - 55 * mm, 42 * mm, 7 * mm, 3.5 * mm, fill=1, stroke=0)
    document.setFillColor(HexColor("#171717"))
    document.setFont(KOREAN_FONT, 18)
    document.drawCentredString(page_width / 2, page_height - 72 * mm, "청소년 AI게임개발 헤커톤")
    document.setFont(KOREAN_FONT, 25)
    document.drawCentredString(page_width / 2, page_height - 87 * mm, f"{team_number}팀 게임 상세 페이지")

    qr_size = 108 * mm
    qr_x = (page_width - qr_size) / 2
    qr_y = page_height - 212 * mm
    document.drawImage(str(qr_path), qr_x, qr_y, qr_size, qr_size, mask="auto")

    document.setFont(KOREAN_FONT, 14)
    document.drawCentredString(page_width / 2, qr_y - 14 * mm, "QR 코드를 스캔해 게임을 플레이하고 투표해 주세요.")
    document.setFillColor(HexColor("#6B6B6B"))
    document.setFont("Helvetica", 8.5)
    document.drawCentredString(page_width / 2, qr_y - 23 * mm, target_url)
    document.setStrokeColor(HexColor("#E3E6EA"))
    document.line(42 * mm, 48 * mm, page_width - 42 * mm, 48 * mm)
    document.setFillColor(HexColor("#6B6B6B"))
    document.setFont(KOREAN_FONT, 9)
    document.drawCentredString(page_width / 2, 38 * mm, "안산케빈샘AI코딩학원")
    document.save()


def main() -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(UnicodeCIDFont(KOREAN_FONT))
    for team_number in TEAM_NUMBERS:
        make_qr(team_number)
        make_pdf(team_number)
    print(f"Generated {len(TEAM_NUMBERS)} QR images and PDF sheets in {OUTPUT_DIRECTORY}")


if __name__ == "__main__":
    main()
