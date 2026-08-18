#!/usr/bin/env python3
"""Build formations-current.json from Fantacalcio.it probable lineups.

The output is intentionally small and stable: the front-end merges these live
probabilities with the local Mantra role list, so a source layout change cannot
corrupt auction data.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

SOURCE_URL = "https://www.fantacalcio.it/probabili-formazioni-serie-a"
OUTPUT = Path(__file__).resolve().parents[1] / "formations-current.json"

TEAMS = {
    "ATA": ["Atalanta"],
    "BOL": ["Bologna"],
    "CAG": ["Cagliari"],
    "COM": ["Como"],
    "FIO": ["Fiorentina"],
    "FRO": ["Frosinone"],
    "GEN": ["Genoa"],
    "INT": ["Inter"],
    "JUV": ["Juventus"],
    "LAZ": ["Lazio"],
    "LEC": ["Lecce"],
    "MIL": ["Milan"],
    "MON": ["Monza"],
    "NAP": ["Napoli"],
    "PAR": ["Parma"],
    "ROM": ["Roma"],
    "SAS": ["Sassuolo"],
    "TOR": ["Torino"],
    "UDI": ["Udinese"],
    "VEN": ["Venezia"],
}
MODULE_RE = re.compile(r"^[1-5](?:-[1-5]){1,4}$")
PCT_RE = re.compile(r"^(100|[1-9]?\d)\s*%$")

NOISE = {
    "panchina", "allenatore", "probabile formazione", "probabili formazioni",
    "indisponibili", "squalificati", "diffidati", "ballottaggi", "rigoristi",
    "punizioni", "corner", "giornata", "serie a", "home", "menu",
}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def fetch_page() -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; AstaMantraFormationUpdater/1.45; +GitHubActions)",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.6",
        "Accept": "text/html,application/xhtml+xml",
    }
    r = requests.get(SOURCE_URL, headers=headers, timeout=30)
    r.raise_for_status()
    if len(r.text) < 20_000:
        raise RuntimeError(f"Risposta troppo corta ({len(r.text)} byte)")
    return r.text


def as_percent(tokens: list[str], i: int):
    m = PCT_RE.match(tokens[i])
    if m:
        return int(m.group(1)), 1
    if tokens[i].isdigit() and i + 1 < len(tokens) and tokens[i + 1] == "%":
        n = int(tokens[i])
        if 0 <= n <= 100:
            return n, 2
    return None, 0


def looks_like_name(s: str) -> bool:
    low = s.casefold()
    if low in NOISE or MODULE_RE.match(s) or PCT_RE.match(s):
        return False
    if len(s) < 2 or len(s) > 45:
        return False
    if s.startswith("http") or "cookie" in low or "privacy" in low:
        return False
    if sum(ch.isalpha() for ch in s) < 2:
        return False
    return True


def is_next_team(tokens: list[str], i: int) -> bool:
    token = tokens[i]
    aliases = {a.casefold() for names in TEAMS.values() for a in names}
    if token.casefold() not in aliases:
        return False
    return any(MODULE_RE.match(x) for x in tokens[i + 1 : i + 8])


def parse_candidate(tokens: list[str], start: int):
    module_idx = None
    for j in range(start + 1, min(len(tokens), start + 14)):
        if MODULE_RE.match(tokens[j]):
            module_idx = j
            break
    if module_idx is None:
        return None

    module = tokens[module_idx]
    starters, bench = [], []
    mode = "starters"
    pending = None
    i = module_idx + 1

    while i < len(tokens) and i < module_idx + 180:
        t = tokens[i]
        low = t.casefold()
        if low == "panchina":
            mode = "bench"
            pending = None
            i += 1
            continue
        if i > module_idx + 3 and is_next_team(tokens, i):
            break
        if low in {"indisponibili", "squalificati", "diffidati"} and mode == "bench":
            break

        pct, consumed = as_percent(tokens, i)
        if pct is not None:
            if pending:
                row = {"name": pending, "probability": pct}
                (starters if mode == "starters" else bench).append(row)
                pending = None
            i += consumed
            continue

        if looks_like_name(t):
            pending = t
        i += 1

    # The source presents the probable XI before the Panchina heading.
    if len(starters) < 11:
        return None
    starters = starters[:11]
    # Deduplicate bench entries while preserving the first/highest source order.
    seen = {x["name"].casefold() for x in starters}
    clean_bench = []
    for row in bench:
        key = row["name"].casefold()
        if key in seen:
            continue
        seen.add(key)
        clean_bench.append(row)
    return module, starters, clean_bench[:28]


def parse_team(tokens: list[str], aliases: list[str]):
    alias_cf = {a.casefold() for a in aliases}
    best = None
    for i, token in enumerate(tokens):
        if token.casefold() not in alias_cf:
            continue
        parsed = parse_candidate(tokens, i)
        if not parsed:
            continue
        module, starters, bench = parsed
        score = len(starters) * 100 + len(bench)
        if best is None or score > best[0]:
            best = (score, token, module, starters, bench)
    return best


def main() -> int:
    html = fetch_page()
    soup = BeautifulSoup(html, "html.parser")
    tokens = [norm(x) for x in soup.stripped_strings]
    tokens = [x for x in tokens if x]

    teams = []
    missing = []
    for club, aliases in TEAMS.items():
        parsed = parse_team(tokens, aliases)
        if not parsed:
            missing.append(club)
            continue
        _, source_name, module, starters, bench = parsed
        teams.append({
            "club": club,
            "team": aliases[0],
            "sourceTeam": source_name,
            "module": module,
            "starters": starters,
            "bench": bench,
        })

    # Never overwrite a good feed with a page blocked by a consent wall/layout change.
    if len(teams) < 15:
        raise RuntimeError(f"Parsing incompleto: {len(teams)}/20 squadre; mancanti: {', '.join(missing)}")

    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except Exception:
            previous = None
        if previous and previous.get("schema") == 1 and previous.get("teams") == teams and previous.get("missingClubs", []) == missing:
            print(f"UNCHANGED: {len(teams)}/20 squadre; feed già aggiornato")
            return 0

    payload = {
        "schema": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sourceName": "Fantacalcio.it",
        "sourceUrl": SOURCE_URL,
        "teams": teams,
        "missingClubs": missing,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK: {len(teams)}/20 squadre -> {OUTPUT}")
    if missing:
        print("Mancanti:", ", ".join(missing), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
