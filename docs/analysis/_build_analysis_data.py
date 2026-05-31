#!/usr/bin/env python3
"""Build analysis/data/data.js from the workflow result file.

The multi-agent workflow (startup-alliance-vc-analysis) returns
{reports:[...], synthesis:{...}} and writes full reports to docs/analysis/*.md.
This script turns the structured highlights into the window.A_* globals the
analysis page consumes. Run:
    uv run python docs/analysis/_build_analysis_data.py <workflow-output.json>
"""
import json
import os
import sys

ROOT = "/Users/tw/Coding/side-project/startup-asvda-org"
REPO_BLOB = "https://github.com/tingwei161803/startup-asvda-org/blob/main/docs/analysis"


def dump(o):
    return json.dumps(o, ensure_ascii=False, indent=2)


def main():
    out_path = sys.argv[1]
    payload = json.load(open(out_path, encoding="utf-8"))
    # accept either the workflow wrapper {result:{...}} or the bare result {reports,synthesis}
    res = payload.get("result", payload)
    reports = res.get("reports", [])
    synth = res.get("synthesis", {}) or {}

    meta = {
        "title": {"zh": "創業大聯盟 100 強・深度分析", "en": "Top 100 · Deep Analysis"},
        "subtitle": {"zh": "VC × 顧問 × 產業專家的多視角剖析",
                     "en": "Read through VC, consulting & sector lenses"},
    }

    hero = {
        "headline": synth.get("headline", {"zh": "100 強的厲害之處", "en": "What makes the Top 100 strong"}),
        "thesis": synth.get("thesis", {"zh": "", "en": ""}),
        "stats": [{"value": s.get("value", ""), "label": s.get("label", {"zh": "", "en": ""})}
                  for s in synth.get("stats", [])],
    }

    themes = [{"title": th.get("title", {}), "detail": th.get("detail", {})}
              for th in synth.get("themes", [])]

    lenses = []
    quotes = []
    for r in reports:
        slug = r.get("slug")
        lenses.append({
            "slug": slug,
            "icon": r.get("icon", "insights"),
            "title": r.get("title", {}),
            "role": r.get("role", {}),
            "tagline": r.get("tagline", {}),
            "keyFindings": r.get("keyFindings", []),
            "spotlight": r.get("spotlight", []),
            "pullQuote": r.get("pullQuote", {}),
            "methods": r.get("methods", {}),
            "reportUrl": f"{REPO_BLOB}/{slug}.md",
        })
        pq = r.get("pullQuote")
        if pq and (pq.get("zh") or pq.get("en")):
            quotes.append({"text": pq, "by": r.get("role", {})})

    picks = [{"id": p.get("id", ""), "name": p.get("name", ""), "angle": p.get("angle", {})}
             for p in synth.get("topPicks", [])]

    method = {"blocks": [
        {"type": "p", "text": {
            "zh": "這份分析由 13 個專業視角的 AI 分析代理人並行產出（創投、策略顧問、技術護城河、市場/TAM、國家戰略、風險、得獎者剖析、獨角獸潛力，以及五大產業深探），再經一次彙整與人工審閱。每個視角都有一份完整報告存於 docs/analysis/。",
            "en": "This analysis was produced by 13 specialized AI analyst agents working in parallel (VC, strategy consulting, deep-tech moat, market/TAM, national strategy, risk, winners deep-dive, unicorn potential, and five sector deep-dives), then synthesized and human-reviewed. Each lens has a full report under docs/analysis/."}},
        {"type": "h3", "text": {"zh": "分析方法", "en": "Methods"}},
        {"type": "ul", "items": {
            "zh": ["可投資性四維評分（市場/護城河/規模化/退出）、組合吸引力矩陣",
                   "技術護城河與學研技轉、國家戰略對齊、風險與紅旗盡調視角",
                   "依產業群（生醫/半導體/綠能/食農漁/AI消費）的次領域深探",
                   "跨視角彙整出共同主題與最值得關注的公司"],
            "en": ["Four-axis investability scoring (market/moat/scaling/exit) and a portfolio attractiveness matrix",
                   "Deep-tech moat & academic spin-off, national-strategy alignment, and risk/red-flag diligence lenses",
                   "Sector deep-dives by industry group (biomed/semiconductor/energy/food-agri/AI-consumer)",
                   "Cross-lens synthesis of recurring themes and companies to watch"]}},
        {"type": "h3", "text": {"zh": "誠實與限制", "en": "Honesty & limitations"}},
        {"type": "p", "text": {
            "zh": "所有公司層級的具體評價只針對 63 家「可查證」企業；18 家查無公開資料的企業與 19 組去識別化團隊不予實質評價。任何市場規模等屬「估計」者皆已標明。本站為非官方分析，屬分析觀點而非投資建議；事實請以官方名單與各公司官方資訊為準。各報告中引用的網路來源附於原始 Markdown 檔。",
            "en": "All company-level judgments apply only to the 63 verified companies; the 18 companies with no reliable public data and the 19 de-identified teams are not substantively assessed. Any market-size figures are flagged as estimates. This is an unofficial analysis — an analytical viewpoint, not investment advice; for facts, defer to the official lists and each company's official information. Web sources cited in each report are in the source Markdown files."}},
    ]}

    js = (
        "/* GENERATED from the startup-alliance-vc-analysis workflow result.\n"
        "   Rebuild: uv run python docs/analysis/_build_analysis_data.py <workflow-output.json> */\n\n"
        + "window.SITE_META = " + dump(meta) + ";\n\n"
        + "window.A_HERO = " + dump(hero) + ";\n\n"
        + "window.A_THEMES = " + dump(themes) + ";\n\n"
        + "window.A_LENSES = " + dump(lenses) + ";\n\n"
        + "window.A_PICKS = " + dump(picks) + ";\n\n"
        + "window.A_QUOTES = " + dump(quotes) + ";\n\n"
        + "window.A_METHOD = " + dump(method) + ";\n"
    )
    dest = os.path.join(ROOT, "analysis", "data", "data.js")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, "w", encoding="utf-8").write(js)
    print(f"OK  wrote {dest}")
    print(f"    lenses: {len(lenses)} | themes: {len(themes)} | picks: {len(picks)} | quotes: {len(quotes)} | hero stats: {len(hero['stats'])}")
    # sanity: warn if any lens missing required content
    for l in lenses:
        if not l["title"].get("zh") or not l["keyFindings"]:
            print(f"    WARN incomplete lens: {l['slug']}")
    # warn if any pick id not in dataset
    ds = {r["id"] for r in json.load(open(os.path.join(ROOT, "docs/analysis/_dataset.json"), encoding="utf-8"))}
    for p in picks:
        if p["id"] and p["id"] not in ds:
            print(f"    WARN pick id not in dataset: {p['id']} {p['name']}")
    for l in lenses:
        for s in l["spotlight"]:
            if s.get("id") and s["id"] not in ds:
                print(f"    WARN spotlight id not in dataset: {s['id']} ({l['slug']})")


if __name__ == "__main__":
    main()
