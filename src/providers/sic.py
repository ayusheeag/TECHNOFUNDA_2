"""Map SIC codes -> a coarse sector (and industry label).

Polygon's financials feed tags each company with a 4-digit SIC code but no
sector/industry text. Rather than make a per-ticker details call for every
name (rate-limited), we classify from the SIC code with a range table. This is
approximate (SIC != GICS) but good enough for grouping and the industry filter.
Sector names match the keys in analysis.sectors.SECTOR_ETFS where possible.
"""
from __future__ import annotations

# (low, high, sector, industry_label). First match wins; order matters.
_RANGES: list[tuple[int, int, str, str]] = [
    (100, 999, "Consumer Staples", "Agriculture"),
    (1000, 1049, "Materials", "Metal Mining"),
    (1200, 1299, "Energy", "Coal Mining"),
    (1300, 1399, "Energy", "Oil & Gas"),
    (1400, 1499, "Materials", "Mining"),
    (1500, 1799, "Industrials", "Construction"),
    (2000, 2199, "Consumer Staples", "Food & Beverage"),
    (2200, 2399, "Consumer Discretionary", "Apparel & Textiles"),
    (2400, 2599, "Consumer Discretionary", "Furniture & Wood"),
    (2600, 2699, "Materials", "Paper"),
    (2700, 2799, "Communication Services", "Publishing"),
    (2830, 2836, "Health Care", "Pharma & Biotech"),
    (2800, 2829, "Materials", "Chemicals"),
    (2840, 2899, "Materials", "Specialty Chemicals"),
    (2900, 2999, "Energy", "Petroleum Refining"),
    (3000, 3199, "Consumer Discretionary", "Rubber & Leather"),
    (3200, 3399, "Materials", "Stone, Clay, Metals"),
    (3400, 3569, "Industrials", "Machinery & Metal Products"),
    (3570, 3579, "Technology", "Computer Hardware"),
    (3580, 3599, "Industrials", "Industrial Machinery"),
    (3600, 3629, "Technology", "Electrical Equipment"),
    (3630, 3659, "Consumer Discretionary", "Household Appliances"),
    (3660, 3669, "Technology", "Communications Equipment"),
    (3670, 3679, "Technology", "Semiconductors"),
    (3680, 3699, "Technology", "Computer & Electronics"),
    (3700, 3799, "Consumer Discretionary", "Autos & Transport Equip"),
    (3800, 3826, "Industrials", "Instruments"),
    (3827, 3851, "Health Care", "Medical Instruments"),
    (3852, 3999, "Consumer Discretionary", "Manufacturing"),
    (4000, 4499, "Industrials", "Transportation"),
    (4500, 4599, "Industrials", "Air Transport"),
    (4600, 4699, "Energy", "Pipelines"),
    (4700, 4799, "Industrials", "Transport Services"),
    (4800, 4899, "Communication Services", "Telecom"),
    (4900, 4999, "Utilities", "Utilities"),
    (5000, 5199, "Consumer Discretionary", "Wholesale"),
    (5200, 5399, "Consumer Discretionary", "Retail"),
    (5400, 5499, "Consumer Staples", "Food Retail"),
    (5500, 5799, "Consumer Discretionary", "Retail"),
    (5800, 5899, "Consumer Discretionary", "Restaurants"),
    (5900, 5999, "Consumer Discretionary", "Retail"),
    (6000, 6199, "Financial Services", "Banks"),
    (6200, 6299, "Financial Services", "Securities & Brokers"),
    (6300, 6499, "Financial Services", "Insurance"),
    (6500, 6599, "Real Estate", "Real Estate"),
    (6700, 6799, "Financial Services", "Investment Offices"),
    (7000, 7299, "Consumer Discretionary", "Consumer Services"),
    (7300, 7369, "Industrials", "Business Services"),
    (7370, 7379, "Technology", "Software & IT Services"),
    (7380, 7399, "Industrials", "Business Services"),
    (7400, 7799, "Consumer Discretionary", "Services"),
    (7800, 7999, "Communication Services", "Media & Entertainment"),
    (8000, 8099, "Health Care", "Health Services"),
    (8100, 8999, "Industrials", "Professional Services"),
]


def sic_to_sector(sic) -> tuple[str | None, str | None]:
    """Return (sector, industry_label) for a SIC code, or (None, None)."""
    if sic is None:
        return None, None
    try:
        s = int(sic)
    except (TypeError, ValueError):
        return None, None
    for lo, hi, sector, industry in _RANGES:
        if lo <= s <= hi:
            return sector, industry
    return None, None
