#!/usr/bin/env python3
"""_assemble.py — merge raw_companies.json + enrich-*.json into data/data.js

Pipeline (run with uv, never bare python):
    uv run python data/build_raw.py      # PDFs -> raw_companies.json  (facts, validated)
    # ... 9 research subagents write data/enrich-*.json ...
    uv run python data/_assemble.py       # raw + enrichment -> data/data.js

The raw skeleton is the source of truth for every FACT (id, name, 組別, 區域, stage,
award, city). Enrichment only adds industry / summary / overview / links, and is
validated + falls back to a factual derivation when a company was not verified.
Emits the window.* globals consumed by the composite app.js.
"""
import glob
import json
import os
import re
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2)


# ---- display metadata -----------------------------------------------------
CAT_META = {
    "frontier-tech": {"zh": "前瞻科技組", "en": "Frontier Tech"},
    "consumer-life": {"zh": "消費生活組", "en": "Consumer & Lifestyle"},
    "green-sustain": {"zh": "綠色永續組", "en": "Green & Sustainable"},
}
CAT_FALLBACK_INDUSTRY = {
    "frontier-tech": {"zh": "前瞻科技 / AI", "en": "Frontier Tech / AI"},
    "consumer-life": {"zh": "消費 / 生活", "en": "Consumer / Lifestyle"},
    "green-sustain": {"zh": "綠能 / 永續", "en": "Green / Sustainability"},
}
STAGE_META = {
    "winner": {"zh": "得獎企業", "en": "Award Winner"},
    "final": {"zh": "晉級決賽", "en": "Top 30 Finalist"},
    "semi": {"zh": "入選複賽", "en": "Top 100"},
}
TYPE_META = {
    "company": {"zh": "企業", "en": "Company"},
    "team": {"zh": "團隊", "en": "Team"},
}
REGION_META = {
    "metro": {"zh": "六都", "en": "Metro"},
    "non-metro": {"zh": "非六都", "en": "Non-metro"},
}
AWARD_META = {
    "president": {"zh": "總統獎", "en": "President's Award",
                  "prize": {"zh": "1,000 萬元", "en": "NT$10M"}},
    "premier": {"zh": "院長獎", "en": "Premier's Award",
                "prize": {"zh": "600 萬元", "en": "NT$6M"}},
}

# --- industry groups (a controlled vocabulary for the "產業" filter axis) ---
# Order = display order of the filter chips. "unknown" always shown last.
INDUSTRY_META = [
    ("biomed",       {"zh": "生醫・醫療",   "en": "Biomed & Health"}),
    ("semicon",      {"zh": "半導體・電子", "en": "Semiconductor"}),
    ("ai-soft",      {"zh": "AI・軟體",     "en": "AI & Software"}),
    ("energy",       {"zh": "綠能・能源",   "en": "Energy & Cleantech"}),
    ("food-agri",    {"zh": "食品・農漁",   "en": "Food & Agri"}),
    ("material-mfg", {"zh": "材料・製造",   "en": "Materials & Mfg"}),
    ("consumer",     {"zh": "消費・服務",   "en": "Consumer & Services"}),
    ("edu-media",    {"zh": "教育・媒體",   "en": "Edu & Media"}),
    ("unknown",      {"zh": "未分類／查無", "en": "Unclassified"}),
]
# Explicit, reviewed mapping for the 63 VERIFIED companies (id -> group).
# Inferred companies and teams are intentionally NOT mapped -> they become
# "unknown", so the industry filter never presents a guess as a fact.
INDUSTRY_MAP = {
    # biomed (生醫・醫療・保健)
    "A0972": "biomed", "A0856": "biomed", "A0131": "biomed", "A0565": "biomed",
    "A0076": "biomed", "A0219": "biomed", "A0622": "biomed", "A1192": "biomed",
    "A0398": "biomed", "A1047": "biomed", "A0020": "biomed", "A1284": "biomed",
    # semicon (半導體・電子・通訊)
    "A1464": "semicon", "A0260": "semicon", "A0528": "semicon", "A0586": "semicon",
    "A0508": "semicon",
    # ai-soft (AI・軟體・數位)
    "A0855": "ai-soft", "A0964": "ai-soft", "A1059": "ai-soft", "A0023": "ai-soft",
    "A0727": "ai-soft", "A0849": "ai-soft", "A1023": "ai-soft", "A0251": "ai-soft",
    "A1355": "ai-soft",
    # energy (綠能・能源・電動車)
    "A0059": "energy", "A0111": "energy", "A0330": "energy", "A0534": "energy",
    "A0667": "energy", "A1579": "energy", "A0653": "energy", "A1064": "energy",
    # food-agri (食品・農業・水產)
    "A0636": "food-agri", "A0217": "food-agri", "A1103": "food-agri", "A1326": "food-agri",
    "A0542": "food-agri", "A0635": "food-agri", "A0787": "food-agri", "A1012": "food-agri",
    "A1491": "food-agri", "A0259": "food-agri", "A0619": "food-agri", "A0686": "food-agri",
    "A0880": "food-agri", "A1018": "food-agri", "A1036": "food-agri", "A1077": "food-agri",
    # material-mfg (材料・製造・精密)
    "A0034": "material-mfg", "A0630": "material-mfg", "A0004": "material-mfg",
    # consumer (消費・生活服務)
    "A0745": "consumer", "A0359": "consumer", "A1043": "consumer", "A1187": "consumer",
    "A1277": "consumer", "A0451": "consumer",
    # edu-media (教育・文化・媒體)
    "A0078": "edu-media", "A0466": "edu-media", "A1104": "edu-media", "A1197": "edu-media",
}


def strip_infer_prefix(obj):
    """Remove a leading '（…推估）' / '(inferred…)' caveat from a {en,zh} object;
    the UI carries that caveat via a clear badge/banner instead."""
    out = {}
    for k, v in obj.items():
        s = str(v)
        s = re.sub(r"^（[^）]*推估[^）]*）\s*", "", s)
        s = re.sub(r"^\([^)]*inferred[^)]*\)\s*", "", s, flags=re.I)
        out[k] = s.strip()
    return out


def load_enrichment():
    """Load every enrich-*.json into {id: payload}, validating loosely."""
    enr = {}
    stats = {"files": 0, "verified": 0, "inferred": 0, "bad": 0}
    for fp in sorted(glob.glob(os.path.join(HERE, "enrich-*.json"))):
        stats["files"] += 1
        try:
            arr = json.load(open(fp, encoding="utf-8"))
        except Exception as e:  # malformed chunk -> skip, don't crash the build
            print(f"WARN  could not parse {os.path.basename(fp)}: {e}")
            continue
        if not isinstance(arr, list):
            print(f"WARN  {os.path.basename(fp)} is not a list; skipped")
            continue
        for row in arr:
            cid = (row or {}).get("id")
            if not cid:
                stats["bad"] += 1
                continue
            enr[cid] = row
            if row.get("verified"):
                stats["verified"] += 1
            else:
                stats["inferred"] += 1
    return enr, stats


def lang_obj(val, fallback):
    """Coerce an enrichment text field to a {en,zh} object, else fallback."""
    if isinstance(val, dict) and val.get("zh") and val.get("en"):
        return {"en": str(val["en"]).strip(), "zh": str(val["zh"]).strip()}
    return fallback


def build():
    raw = json.load(open(os.path.join(HERE, "raw_companies.json"), encoding="utf-8"))
    enr, estats = load_enrichment()

    items = []
    for c in raw:
        cid = c["id"]
        cat = c["category"]
        is_team = c["type"] == "team"
        e = enr.get(cid, {}) if not is_team else {}

        # title — company name in zh; en uses found English name if any
        name = c["name"]
        title_en = e.get("name_en") or name
        title = {"zh": name, "en": title_en}

        if is_team:
            industry = {"zh": "個人 / 團隊組", "en": "Individual / Team"}
            summary = {"zh": "以團隊（個人）身分入選之參賽者，名單依規定去識別化。",
                       "en": "Selected as an individual / team entry; the name is anonymized per the official list."}
            overview = {
                "zh": f"入選國發會「創業綻放計畫－創業大聯盟競賽」{CAT_META[cat]['zh']}（{REGION_META[c['region']]['zh']}賽區），以團隊／個人身分參賽。",
                "en": f"A team/individual entrant selected in the {CAT_META[cat]['en']} track ({REGION_META[c['region']]['en']}) of Taiwan's national 'Startup Grand Alliance' competition.",
            }
            verified = False
            links = []
        else:
            fb_ind = CAT_FALLBACK_INDUSTRY[cat]
            fb_sum = {
                "zh": f"{CAT_META[cat]['zh']}入選企業（{REGION_META[c['region']]['zh']}賽區）。",
                "en": f"A {CAT_META[cat]['en']} track finalist ({REGION_META[c['region']]['en']}).",
            }
            fb_ovr = {
                "zh": f"入選國發會「創業綻放計畫－創業大聯盟競賽」{CAT_META[cat]['zh']}，{REGION_META[c['region']]['zh']}賽區。詳細營業項目以公司官方資訊為準。",
                "en": f"Selected in the {CAT_META[cat]['en']} track ({REGION_META[c['region']]['en']}) of Taiwan's national 'Startup Grand Alliance' competition. Refer to official sources for the company's exact line of business.",
            }
            industry = lang_obj(e.get("industry"), fb_ind)
            summary = lang_obj(e.get("summary"), fb_sum)
            overview = lang_obj(e.get("overview"), fb_ovr)
            verified = bool(e.get("verified"))
            links = []
            for l in (e.get("links") or []):
                url = (l or {}).get("url", "")
                if isinstance(url, str) and url.startswith("http"):
                    links.append({"title": str(l.get("title") or url), "url": url})

            # inferred company: strip the inline "（…推估）" caveat from the text;
            # the UI flags it via a clear badge + dialog warning instead, and the
            # card hides the guess entirely (shows "查無公開資料").
            if not verified:
                summary = strip_infer_prefix(summary)
                overview = strip_infer_prefix(overview)

        # industry group for the "產業" filter axis. Only VERIFIED companies get a
        # real group; inferred companies + teams -> "unknown" (查無/未分類) so the
        # filter never presents a guess as a fact.
        if (not is_team) and verified:
            industry_group = INDUSTRY_MAP.get(cid)
            assert industry_group, f"verified company not mapped to industry: {cid} {name}"
        else:
            industry_group = "unknown"

        # search tags (language-neutral-ish): id + industry words
        tags = [cid]

        item = {
            "slug": c["slug"],
            "id": cid,
            "category": cat,
            "type": c["type"],
            "region": c["region"],
            "stage": c["stage"],
            "industry_group": industry_group,
            "title": title,
            "industry": industry,
            "summary": summary,
            "overview": overview,
            "verified": verified,
            "links": links,
            "tags": tags,
        }
        if "award" in c:
            item["award"] = c["award"]
            item["city"] = c["city"]
        items.append(item)

    # ---- sort: winners first (president > premier), then final, then semi;
    #            within a tier by category order then id ----
    cat_order = {"frontier-tech": 0, "consumer-life": 1, "green-sustain": 2}
    stage_order = {"winner": 0, "final": 1, "semi": 2}
    award_order = {"president": 0, "premier": 1}

    def sort_key(it):
        return (
            stage_order[it["stage"]],
            award_order.get(it.get("award"), 9),
            cat_order[it["category"]],
            it["id"],
        )
    items.sort(key=sort_key)

    # ---- derived stats ----
    by_cat = Counter(i["category"] for i in items)
    by_type = Counter(i["type"] for i in items)
    by_industry = Counter(i["industry_group"] for i in items)
    # industry filter options: only groups with >=1 member, in defined order
    industries = [{"key": k, "en": v["en"], "zh": v["zh"]}
                  for k, v in INDUSTRY_META if by_industry.get(k)]

    # ---- winners (for the awards podium section) ----
    winners = [i for i in items if i["stage"] == "winner"]
    win_groups = []
    for aw in ("president", "premier"):
        grp = [w for w in winners if w.get("award") == aw]
        # within group, keep category order then id (already sorted)
        win_groups.append({
            "award": aw,
            "label": {"zh": AWARD_META[aw]["zh"], "en": AWARD_META[aw]["en"]},
            "prize": AWARD_META[aw]["prize"],
            "count": len(grp),
            "winners": [{
                "slug": w["slug"], "id": w["id"],
                "name": w["title"],
                "category": w["category"],
                "city": w.get("city", ""),
            } for w in grp],
        })

    # =====================================================================
    #  Compose the page
    # =====================================================================
    meta = {
        "title": {"zh": "創業綻放・創業大聯盟競賽", "en": "Startup Blossom · Grand Alliance"},
        "subtitle": {"zh": "100 強入選企業・30 強決賽・總統獎與院長獎得主一覽",
                     "en": "The Top 100 finalists, Top 30, and national award winners"},
    }

    categories = [{"key": k, "en": v["en"], "zh": v["zh"]} for k, v in CAT_META.items()]

    sections = [
        {
            "type": "hero", "id": "hero",
            "title": {"zh": "臺灣新創的最高榮譽", "en": "Taiwan's Highest Startup Honor"},
            "subtitle": {
                "zh": "國發會「創業綻放計畫－創業大聯盟競賽」全台最大規模國家級創業賽事。近 3,000 組參賽隊伍，最終遴選出 100 強、30 強決賽，以及問鼎千萬與百萬級榮譽的 9 組得主。",
                "en": "The 'Startup Blossom · Grand Alliance' — Taiwan's largest national startup competition by the National Development Council. From nearly 3,000 teams, 100 finalists, 30 grand-finalists, and 9 top award winners emerged.",
            },
            "stats": [
                {"label": {"zh": "報名隊伍", "en": "Teams entered"}, "value": 3000, "approx": True},
                {"label": {"zh": "複賽 100 強", "en": "Top 100"}, "value": 100},
                {"label": {"zh": "決賽 30 強", "en": "Top 30"}, "value": 30},
                {"label": {"zh": "總統獎・院長獎", "en": "Award winners"}, "value": 9},
            ],
        },
        {
            "type": "awards", "id": "awards",
            "title": {"zh": "總統獎・院長獎得主", "en": "President's & Premier's Award Winners"},
            "subtitle": {"zh": "決賽脫穎而出的 9 組最高榮譽得主，依公司名稱筆畫排序，與評審分數無關。",
                         "en": "The 9 highest-honor winners from the grand final — ordered by name strokes, unrelated to scores."},
            "groups": win_groups,
        },
        {
            "type": "funnel", "id": "funnel",
            "title": {"zh": "賽事漏斗：從 3,000 到 9", "en": "The Funnel: from 3,000 to 9"},
            "subtitle": {"zh": "層層篩選，由 80 位評審團審慎評選。", "en": "Selected stage by stage by a panel of 80 judges."},
            "steps": [
                {"label": {"zh": "報名參賽", "en": "Entered"}, "value": 3000, "note": {"zh": "近 3,000 組", "en": "~3,000 teams"}},
                {"label": {"zh": "複賽 100 強", "en": "Top 100"}, "value": 100, "note": {"zh": "每組 ≥ 300 萬元支持金", "en": "≥ NT$3M each"}},
                {"label": {"zh": "決賽 30 強", "en": "Top 30"}, "value": 30, "note": {"zh": "角逐千萬級榮譽", "en": "Compete for the top prizes"}},
                {"label": {"zh": "獲獎 9 組", "en": "9 Winners"}, "value": 9, "note": {"zh": "總統獎 3・院長獎 6", "en": "3 President's · 6 Premier's"}},
            ],
        },
        {
            "type": "gallery", "id": "companies",
            "title": {"zh": "100 強入選企業", "en": "The Top 100"},
            "subtitle": {"zh": "全部 100 組入選名單。可依組別、產業、企業／團隊、賽區、晉級階段篩選，或直接搜尋。",
                         "en": "All 100 selected entries. Filter by track, industry, type, region, or stage — or search."},
            "items": items,
        },
        {
            "type": "charts", "id": "stats",
            "title": {"zh": "入選結構分析", "en": "Selection Breakdown"},
            "subtitle": {"zh": "100 強的報名類別與企業／團隊組成。", "en": "Track and entrant-type composition of the Top 100."},
            "donuts": [
                {
                    "title": {"zh": "報名類別", "en": "By track"},
                    "slices": [
                        {"label": CAT_META["frontier-tech"], "value": by_cat["frontier-tech"], "key": "frontier-tech"},
                        {"label": CAT_META["consumer-life"], "value": by_cat["consumer-life"], "key": "consumer-life"},
                        {"label": CAT_META["green-sustain"], "value": by_cat["green-sustain"], "key": "green-sustain"},
                    ],
                },
                {
                    "title": {"zh": "企業 / 團隊", "en": "Company / Team"},
                    "slices": [
                        {"label": TYPE_META["company"], "value": by_type["company"], "key": "company"},
                        {"label": TYPE_META["team"], "value": by_type["team"], "key": "team"},
                    ],
                },
            ],
        },
        {
            "type": "prose", "id": "about",
            "title": {"zh": "關於這場賽事", "en": "About the Competition"},
            "subtitle": {"zh": "資料來源與聲明", "en": "Data sources & disclaimer"},
            "blocks": [
                {"type": "p", "text": {
                    "zh": "「創業綻放計畫－創業大聯盟競賽」由國家發展委員會（國發會）主辦，是全台最大規模的國家級創業賽事，匯聚數位轉型、綠能永續、生醫科技及智慧製造等多元領域的創業者。本站整理自官方公布的複賽 100 強、決賽 30 強，以及總統獎／院長獎得獎名單。",
                    "en": "The 'Startup Blossom · Grand Alliance' is organized by Taiwan's National Development Council (NDC) — the country's largest national startup competition, spanning digital transformation, green energy, biomedical and smart-manufacturing ventures. This site compiles the officially published Top 100, Top 30, and President's/Premier's award lists."}},
                {"type": "h3", "text": {"zh": "資料來源", "en": "Data sources"}},
                {"type": "ul", "items": {
                    "zh": ["官方名單 PDF：複賽入選 100 組、決賽入選 30 組、總統獎及院長獎名單。",
                           "官方網站：startup.asvda.org.tw",
                           "各公司產業與簡介為公開網路資料整理，已盡力查證；標示「已查證」者附來源連結。"],
                    "en": ["Official PDF lists: Top 100, Top 30, and the President's/Premier's award roster.",
                           "Official site: startup.asvda.org.tw",
                           "Company industry/intro fields are compiled from public web sources; entries marked 'verified' include source links."]}},
                {"type": "h3", "text": {"zh": "聲明", "en": "Disclaimer"}},
                {"type": "p", "text": {
                    "zh": "本站為非官方的資料整理與視覺化專案，僅供瀏覽參考。名單排序依官方規則（公司名稱筆畫／團隊編號），與評審分數無關。團隊組參賽者姓名依官方名單去識別化處理。如有出入，請以主辦單位官方公告為準。",
                    "en": "This is an unofficial data-visualization project for reference only. Ordering follows official rules (name strokes / entry number) and is unrelated to judging scores. Team entrants' names are anonymized per the official list. For authoritative information, refer to the organizer's announcements."}},
            ],
        },
        {
            "type": "cta", "id": "cta",
            "title": {"zh": "查看官方完整資訊", "en": "Visit the Official Site"},
            "text": {"zh": "更多賽事資訊、活動與後續報導，請前往創業大聯盟官方網站。",
                     "en": "For full competition details, events, and follow-ups, visit the official Startup Grand Alliance site."},
            "link": {"label": {"zh": "前往 startup.asvda.org.tw", "en": "Go to startup.asvda.org.tw"},
                     "url": "https://startup.asvda.org.tw/"},
        },
    ]

    out = os.path.join(HERE, "data.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("/* GENERATED by data/_assemble.py — do not edit by hand.\n")
        f.write("   Re-run: uv run python data/build_raw.py && uv run python data/_assemble.py */\n\n")
        f.write("window.SITE_META = " + dump(meta) + ";\n\n")
        f.write("window.SITE_CATEGORIES = " + dump(categories) + ";\n\n")
        f.write("window.SITE_INDUSTRIES = " + dump(industries) + ";\n\n")
        f.write("window.SITE_SECTIONS = " + dump(sections) + ";\n")

    verified = sum(1 for i in items if i["verified"])
    print(f"OK  wrote data.js — {len(items)} companies "
          f"({verified} verified, {len(items)-verified} inferred/team)")
    print(f"    enrichment files merged: {estats['files']} "
          f"(verified={estats['verified']}, inferred={estats['inferred']}, bad={estats['bad']})")
    print(f"    by track: {dict(by_cat)} | by type: {dict(by_type)}")
    print(f"    by industry: {dict(by_industry)}")


if __name__ == "__main__":
    build()
