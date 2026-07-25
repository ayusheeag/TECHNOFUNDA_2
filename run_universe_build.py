"""One-off: build the full US universe + fundamentals from Polygon (mktcap>$1B)."""
from src.ingest.fundamentals_polygon import rebuild_universe

if __name__ == "__main__":
    n_t, n_f = rebuild_universe(min_market_cap=1e9, years=2, throttle=13)
    print(f"DONE: {n_t} tickers, {n_f} fundamental rows")
