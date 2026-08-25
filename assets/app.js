/* =========================================================================
   創業綻放・創業大聯盟競賽 — composite app.js
   Vanilla JS · no build · no chart lib.

   A single long page assembled from an ordered list of typed section-blocks
   (window.SITE_SECTIONS), rendered in the active language.

   SECTION-TYPE REGISTRY (RENDERERS): one function per `type` returns the inner
   HTML of a <section>. Custom types for this dataset:
     hero · awards · funnel · gallery · charts · prose · cta
   The gallery is a self-contained explorer with 4 independent filter axes
   (track × company/team × region × stage) + search + a detail dialog.

   render()      -> full-page repaint (used on load + language switch)
   applyGallery()-> light repaint of just the 100-card grid + live count
   ========================================================================= */
(function () {
  "use strict";

  /* ---------- data ---------- */
  var META = window.SITE_META || { title: {}, subtitle: {} };
  var SECTIONS = Array.isArray(window.SITE_SECTIONS) ? window.SITE_SECTIONS : [];
  var CATEGORIES = Array.isArray(window.SITE_CATEGORIES) ? window.SITE_CATEGORIES : [];

  var INDUSTRIES = Array.isArray(window.SITE_INDUSTRIES) ? window.SITE_INDUSTRIES : [];

  /* category key -> {en,zh} */
  var CAT_LABEL = {};
  CATEGORIES.forEach(function (c) { CAT_LABEL[c.key] = { en: c.en, zh: c.zh }; });
  var IND_LABEL = {};
  INDUSTRIES.forEach(function (c) { IND_LABEL[c.key] = { en: c.en, zh: c.zh }; });

  /* fixed enum labels (mirror data/_assemble.py) */
  var LABELS = {
    stage: {
      winner: { zh: "得獎", en: "Winner" },
      final:  { zh: "決賽 30", en: "Top 30" },
      semi:   { zh: "複賽 100", en: "Top 100" }
    },
    type: {
      company: { zh: "企業", en: "Company" },
      team:    { zh: "團隊", en: "Team" }
    },
    region: {
      metro:       { zh: "六都", en: "Metro" },
      "non-metro": { zh: "非六都", en: "Non-metro" }
    },
    award: {
      president: { zh: "總統獎", en: "President's Award" },
      premier:   { zh: "院長獎", en: "Premier's Award" }
    },
    prize: {
      president: { zh: "1,000 萬元創業金", en: "NT$10M grant" },
      premier:   { zh: "600 萬元創業金", en: "NT$6M grant" }
    }
  };

  /* ---------- i18n strings (UI chrome only) ---------- */
  var I18N = {
    en: {
      footer: "Unofficial data-visualization · static site, no build step.",
      close: "Close", menu: "On this page",
      searchPlaceholder: "Search name, industry, or keyword…",
      all: "All",
      axisCategory: "Track", axisStage: "Stage", axisType: "Type", axisRegion: "Region",
      axisIndustry: "Industry",
      analysis: "Analysis",
      verified: "Verified", inferred: "Estimated", sources: "Sources",
      noData: "No public data", unverified: "Unverified",
      noDataDesc: "No reliable public information found — open for a name-based estimate.",
      inferWarn: "No reliable public information was found for this company. The industry and description below are estimated from the company name and competition track — for reference only and may be inaccurate.",
      idLabel: "Entry", cityLabel: "Region", noResults: "No matching entries.",
      clear: "Clear",
      count: function (n) { return n + (n === 1 ? " entry" : " entries"); }
    },
    zh: {
      footer: "非官方資料整理與視覺化 · 純靜態網站，無建置流程。",
      close: "關閉", menu: "本頁導覽",
      searchPlaceholder: "搜尋公司名稱、產業或關鍵字…",
      all: "全部",
      axisCategory: "組別", axisStage: "階段", axisType: "性質", axisRegion: "賽區",
      axisIndustry: "產業",
      analysis: "深度分析",
      verified: "已查證", inferred: "推估", sources: "來源",
      noData: "查無公開資料", unverified: "未查證",
      noDataDesc: "目前查無公開可靠資料，點開可查看依名稱與組別所做的推估。",
      inferWarn: "查無此公司公開可靠資料。以下產業與簡介係依公司名稱與參賽組別推估，僅供參考、未必正確。",
      idLabel: "參賽編號", cityLabel: "地區", noResults: "找不到符合條件的入選名單。",
      clear: "清除",
      count: function (n) { return "共 " + n + " 組"; }
    }
  };

  /* ---------- safe localStorage ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- state ---------- */
  /* The URL decides the language: each language has its own page, and that page
     declares which one it is in <html lang>. Never read the language back from
     storage — a visitor landing on /en/ must get English even if they once
     picked 中文, and crawlers have no storage at all. */
  var pageLang = (document.documentElement.getAttribute("lang") || "en")
    .toLowerCase().indexOf("zh") === 0 ? "zh" : "en";

  var state = {
    lang:  pageLang,
    theme: lsGet("theme") || "dark"          // dark = ceremony default
  };
  /* gallery filter axes (each independent, ANDed) */
  var gstate = { q: "", category: "all", industry: "all", stage: "all", type: "all", region: "all" };

  /* ---------- dom refs ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var sectionsEl = $("sections");
  var navInner   = $("sectionNavInner");
  var dialog     = $("dialog");
  var dialogBody = $("dialogBody");

  /* ---------- helpers ---------- */
  function t(obj) {
    if (obj == null) return "";
    if (typeof obj === "string") return obj;
    return obj[state.lang] || obj.en || obj.zh || "";
  }
  function ui(key) { return (I18N[state.lang] || I18N.en)[key]; }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function r(n) { return Math.round(n * 100) / 100; }
  function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function catLabel(key) { return t(CAT_LABEL[key] || { en: key, zh: key }); }
  function bothLang(o) { return o ? [o.en || "", o.zh || ""] : []; }

  function sectionHead(sec) {
    var sub = t(sec.subtitle)
      ? '<p class="section-head__sub">' + escapeHtml(t(sec.subtitle)) + "</p>"
      : "";
    return '<header class="section-head">' +
      '<h2 id="' + escapeHtml(sec.id) + '-heading">' + escapeHtml(t(sec.title)) + "</h2>" +
      sub + "</header>";
  }

  /* the global gallery item index (slug -> item), built once */
  var ITEM_INDEX = {};
  SECTIONS.forEach(function (sec) {
    if (sec.type === "gallery" && Array.isArray(sec.items)) {
      sec.items.forEach(function (it) { ITEM_INDEX[it.slug] = it; });
    }
  });

  /* =======================================================================
     SECTION-TYPE REGISTRY
     ===================================================================== */
  var RENDERERS = {

    /* ---- hero: lead-in + animated stat counters ---- */
    hero: function (sec) {
      var stats = (sec.stats || []).map(function (s) {
        var pre = s.approx ? (state.lang === "zh" ? "近 " : "~") : "";
        return '<div class="hero__stat" data-item>' +
          '<b class="hero__stat-value" data-count="' + escapeHtml(String(s.value)) + '" ' +
              'data-prefix="' + escapeHtml(pre) + '">' + escapeHtml(pre) + "0</b>" +
          '<span class="hero__stat-label">' + escapeHtml(t(s.label)) + "</span>" +
        "</div>";
      }).join("");
      return sectionHead(sec) +
        (stats ? '<div class="hero__stats">' + stats + "</div>" : "");
    },

    /* ---- awards: 總統獎 / 院長獎 podium ---- */
    awards: function (sec) {
      var groups = (sec.groups || []).map(function (g) {
        var aw = g.award;
        var winners = (g.winners || []).map(function (w) {
          var cat = '<span class="mchip chip--cat cat--' + escapeHtml(w.category) + '">' +
                      escapeHtml(catLabel(w.category)) + "</span>";
          var city = w.city
            ? '<span class="award-card__city"><span class="material-symbols-rounded" aria-hidden="true">location_on</span>' +
              escapeHtml(w.city) + "</span>" : "";
          return '<article class="award-card" tabindex="0" role="button" data-item ' +
              'data-slug="' + escapeHtml(w.slug) + '" ' +
              'aria-label="' + escapeHtml(t(w.name)) + '">' +
            '<span class="award-card__id">' + escapeHtml(w.id) + "</span>" +
            '<h4 class="award-card__name">' + escapeHtml(t(w.name)) + "</h4>" +
            '<div class="award-card__meta">' + cat + city + "</div>" +
          "</article>";
        }).join("");
        return '<div class="award-group award-group--' + escapeHtml(aw) + '">' +
          '<div class="award-group__head">' +
            '<span class="material-symbols-rounded award-group__crown" aria-hidden="true">' +
              (aw === "president" ? "workspace_premium" : "military_tech") + "</span>" +
            '<div class="award-group__heads">' +
              '<h3 class="award-group__title">' + escapeHtml(t(g.label)) + "</h3>" +
              '<span class="award-group__prize">' + escapeHtml(t(g.prize)) +
                " · " + g.count + (state.lang === "zh" ? " 組" : "") + "</span>" +
            "</div>" +
          "</div>" +
          '<div class="award-group__grid">' + winners + "</div>" +
        "</div>";
      }).join("");
      return sectionHead(sec) + '<div class="awards">' + groups + "</div>";
    },

    /* ---- funnel: 3,000 -> 100 -> 30 -> 9 (decorative taper + real numbers) ---- */
    funnel: function (sec) {
      var steps = sec.steps || [];
      var widths = [100, 76, 54, 36];
      var rows = steps.map(function (s, i) {
        var w = widths[Math.min(i, widths.length - 1)];
        return '<li class="funnel__row" data-item style="--w:' + w + '%">' +
          '<div class="funnel__bar">' +
            '<b class="funnel__value">' + escapeHtml(commas(s.value)) + "</b>" +
            '<span class="funnel__label">' + escapeHtml(t(s.label)) + "</span>" +
          "</div>" +
          (t(s.note) ? '<span class="funnel__note">' + escapeHtml(t(s.note)) + "</span>" : "") +
        "</li>";
      }).join("");
      return sectionHead(sec) + '<ol class="funnel">' + rows + "</ol>";
    },

    /* ---- gallery: the 100 companies, 4-axis filter + search + dialog ---- */
    gallery: function (sec) {
      var axes = [
        { key: "category", label: ui("axisCategory"),
          opts: CATEGORIES.map(function (c) { return { v: c.key, label: t({ en: c.en, zh: c.zh }), cls: "cat--" + c.key }; }) },
        { key: "industry", label: ui("axisIndustry"),
          opts: INDUSTRIES.map(function (c) { return { v: c.key, label: t({ en: c.en, zh: c.zh }), cls: "ind--" + c.key }; }) },
        { key: "stage", label: ui("axisStage"),
          opts: ["winner", "final", "semi"].map(function (v) { return { v: v, label: t(LABELS.stage[v]), cls: "stage--" + v }; }) },
        { key: "type", label: ui("axisType"),
          opts: ["company", "team"].map(function (v) { return { v: v, label: t(LABELS.type[v]) }; }) },
        { key: "region", label: ui("axisRegion"),
          opts: ["metro", "non-metro"].map(function (v) { return { v: v, label: t(LABELS.region[v]) }; }) }
      ];

      var axesHtml = axes.map(function (ax) {
        var chips = [{ v: "all", label: ui("all"), cls: "" }].concat(ax.opts).map(function (o) {
          var active = gstate[ax.key] === o.v;
          return '<button class="chip filter-chip ' + (o.cls || "") + (active ? " is-active" : "") +
            '" type="button" data-axis="' + ax.key + '" data-val="' + escapeHtml(o.v) + '" ' +
            'aria-pressed="' + active + '">' + escapeHtml(o.label) + "</button>";
        }).join("");
        return '<div class="filter-axis">' +
          '<span class="filter-axis__label">' + escapeHtml(ax.label) + "</span>" +
          '<div class="filter-axis__chips">' + chips + "</div>" +
        "</div>";
      }).join("");

      return sectionHead(sec) +
        '<div class="gallery-controls">' +
          '<div class="search"><span class="material-symbols-rounded" aria-hidden="true">search</span>' +
            '<input id="gallerySearch" type="search" autocomplete="off" ' +
              'value="' + escapeHtml(gstate.q) + '" placeholder="' + escapeHtml(ui("searchPlaceholder")) + '" ' +
              'aria-label="' + escapeHtml(ui("searchPlaceholder")) + '">' +
            '<button class="search__clear" id="galleryClear" type="button" aria-label="' + escapeHtml(ui("clear")) + '">' +
              '<span class="material-symbols-rounded">close</span></button>' +
          "</div>" +
          '<div class="filters">' + axesHtml + "</div>" +
          '<p class="result-count" id="resultCount" aria-live="polite"></p>' +
        "</div>" +
        '<div class="grid" id="galleryGrid"></div>' +
        '<p class="empty" id="galleryEmpty" hidden>' + escapeHtml(ui("noResults")) + "</p>";
    },

    /* ---- charts: donut breakdowns (inline SVG) ---- */
    charts: function (sec) {
      var donuts = (sec.donuts || []).map(function (d) { return donutHtml(d); }).join("");
      return sectionHead(sec) + '<div class="charts">' + donuts + "</div>";
    },

    /* ---- prose: ordered rich-text blocks ---- */
    prose: function (sec) {
      var body = (sec.blocks || []).map(function (b) {
        if (b.type === "h3") return "<h3>" + escapeHtml(t(b.text)) + "</h3>";
        if (b.type === "ul") {
          var arr = (b.items && (b.items[state.lang] || b.items.en || b.items.zh)) || [];
          return "<ul>" + arr.map(function (li) { return "<li>" + escapeHtml(li) + "</li>"; }).join("") + "</ul>";
        }
        return "<p>" + escapeHtml(t(b.text)) + "</p>";
      }).join("");
      return sectionHead(sec) + '<div class="prose" data-item>' + body + "</div>";
    },

    /* ---- cta ---- */
    cta: function (sec) {
      var link = "";
      if (sec.link && sec.link.url) {
        link = '<a class="cta-btn" href="' + escapeHtml(sec.link.url) + '" target="_blank" rel="noopener">' +
          '<span>' + escapeHtml(t(sec.link.label)) + "</span>" +
          '<span class="cta-btn__ico"><span class="material-symbols-rounded" aria-hidden="true">arrow_outward</span></span></a>';
      }
      return '<div class="cta-card" data-item>' +
        "<h2>" + escapeHtml(t(sec.title)) + "</h2>" +
        (t(sec.text) ? "<p>" + escapeHtml(t(sec.text)) + "</p>" : "") + link +
      "</div>";
    }
  };

  /* ---- donut SVG generator ---- */
  function donutHtml(d) {
    var slices = d.slices || [];
    var total = slices.reduce(function (a, s) { return a + (s.value || 0); }, 0) || 1;
    var R = 62, C = 90, SW = 28, circ = 2 * Math.PI * R;
    var offset = 0;
    var segs = slices.map(function (s, i) {
      var frac = (s.value || 0) / total;
      var len = frac * circ;
      var seg = '<circle class="donut-seg" cx="' + C + '" cy="' + C + '" r="' + R +
        '" fill="none" stroke-width="' + SW + '" stroke-dasharray="' + r(len) + " " + r(circ - len) +
        '" stroke-dashoffset="' + r(-offset) + '" stroke="' + sliceColor(s, i) + '">' +
        "<title>" + escapeHtml(t(s.label)) + ": " + s.value + "</title></circle>";
      offset += len;
      return seg;
    }).join("");
    var legend = slices.map(function (s, i) {
      var pct = Math.round(((s.value || 0) / total) * 100);
      return '<li class="legend__item">' +
        '<span class="legend__dot" style="background:' + sliceColor(s, i) + '"></span>' +
        '<span class="legend__label">' + escapeHtml(t(s.label)) + "</span>" +
        '<span class="legend__val">' + s.value + " · " + pct + "%</span>" +
      "</li>";
    }).join("");
    return '<figure class="donut-card" data-item>' +
      '<figcaption class="donut-card__title">' + escapeHtml(t(d.title)) + "</figcaption>" +
      '<div class="donut-card__body">' +
        '<svg class="donut" viewBox="0 0 180 180" role="img" aria-label="' + escapeHtml(t(d.title)) + '">' +
          '<g transform="rotate(-90 90 90)">' + segs + "</g>" +
          '<text class="donut__total" x="90" y="90" text-anchor="middle" dominant-baseline="central">' + total + "</text>" +
        "</svg>" +
        '<ul class="legend">' + legend + "</ul>" +
      "</div>" +
    "</figure>";
  }
  var TYPE_COLORS = { company: "var(--accent)", team: "var(--gold-soft)" };
  function sliceColor(s, i) {
    if (s.key && CAT_LABEL[s.key]) return "var(--cat-" + s.key + ")";
    if (s.key && TYPE_COLORS[s.key]) return TYPE_COLORS[s.key];
    var pal = ["var(--accent)", "var(--gold)", "var(--gold-soft)"];
    return pal[i % pal.length];
  }

  /* nav pill icon per section type */
  var NAV_ICONS = {
    hero: "auto_awesome", awards: "emoji_events", funnel: "filter_alt",
    gallery: "grid_view", charts: "donut_large", prose: "article", cta: "north_east"
  };

  /* =======================================================================
     GALLERY filter logic
     ===================================================================== */
  function gallerySection() {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i].type === "gallery") return SECTIONS[i];
    return null;
  }
  function matches(item) {
    if (gstate.category !== "all" && item.category !== gstate.category) return false;
    if (gstate.industry !== "all" && item.industry_group !== gstate.industry) return false;
    if (gstate.stage !== "all" && item.stage !== gstate.stage) return false;
    if (gstate.type !== "all" && item.type !== gstate.type) return false;
    if (gstate.region !== "all" && item.region !== gstate.region) return false;
    if (!gstate.q) return true;
    return searchHay(item).indexOf(gstate.q.toLowerCase()) !== -1;
  }

  /* Build the searchable text for an item, in BOTH languages.
     Factual fields are always indexed. Free-text content (industry / summary /
     overview) is indexed for verified companies + teams only — never for an
     inferred company, so a hidden name-based guess can't resurface via search. */
  function searchHay(item) {
    var parts = bothLang(item.title)
      .concat([item.id, item.city || ""])
      .concat(bothLang(CAT_LABEL[item.category]))
      .concat(bothLang(LABELS.type[item.type]))
      .concat(bothLang(LABELS.region[item.region]))
      .concat(bothLang(LABELS.stage[item.stage]))
      .concat(item.tags || []);
    if (item.industry_group) parts = parts.concat(bothLang(IND_LABEL[item.industry_group]));
    if (item.award) parts = parts.concat(bothLang(LABELS.award[item.award]));
    if (!isInferred(item)) {
      parts = parts.concat(bothLang(item.industry))
                   .concat(bothLang(item.summary))
                   .concat(bothLang(item.overview));
    }
    return parts.join(" ").toLowerCase();
  }

  /* an inferred company = no public data found; only verified companies show
     their real industry/summary. Teams are a separate (factual) case. */
  function isInferred(item) { return item.type === "company" && !item.verified; }

  function galleryCard(item) {
    var inferred = isInferred(item);
    var stageBadge = '<span class="stage-badge stage--' + escapeHtml(item.stage) + '">' +
      (item.stage === "winner"
        ? '<span class="material-symbols-rounded" aria-hidden="true">emoji_events</span>' : "") +
      escapeHtml(t(LABELS.stage[item.stage])) + "</span>";
    var awardRibbon = item.award
      ? '<span class="ccard__ribbon ribbon--' + escapeHtml(item.award) + '">' +
        escapeHtml(t(LABELS.award[item.award])) + "</span>" : "";
    var vbadge = item.verified
      ? '<span class="ccard__verified" title="' + escapeHtml(ui("verified")) + '">' +
        '<span class="material-symbols-rounded" aria-hidden="true">verified</span></span>' : "";
    // industry + summary: verified -> real; inferred -> "查無公開資料"; team -> factual
    var industryLine = inferred
      ? '<p class="ccard__industry ccard__industry--nodata">' +
          '<span class="material-symbols-rounded" aria-hidden="true">help</span>' +
          escapeHtml(ui("noData")) + "</p>"
      : '<p class="ccard__industry">' + escapeHtml(t(item.industry)) + "</p>";
    var summaryLine = '<p class="ccard__summary' + (inferred ? " ccard__summary--muted" : "") + '">' +
      escapeHtml(inferred ? ui("noDataDesc") : t(item.summary)) + "</p>";
    var chips =
      '<span class="mchip chip--cat cat--' + escapeHtml(item.category) + '">' + escapeHtml(catLabel(item.category)) + "</span>" +
      '<span class="mchip">' + escapeHtml(t(LABELS.type[item.type])) + "</span>" +
      '<span class="mchip">' + escapeHtml(t(LABELS.region[item.region])) + "</span>" +
      (inferred ? '<span class="mchip mchip--est">' + escapeHtml(ui("unverified")) + "</span>" : "");
    return '<article class="ccard card stage--' + escapeHtml(item.stage) + '" tabindex="0" role="button" data-item ' +
        'data-slug="' + escapeHtml(item.slug) + '" aria-label="' + escapeHtml(t(item.title)) + '">' +
      awardRibbon +
      '<div class="ccard__top"><span class="ccard__id">' + escapeHtml(item.id) + "</span>" + stageBadge + "</div>" +
      '<h3 class="ccard__name">' + escapeHtml(t(item.title)) + vbadge + "</h3>" +
      industryLine + summaryLine +
      '<div class="ccard__chips">' + chips + "</div>" +
    "</article>";
  }

  function applyGallery() {
    var sec = gallerySection();
    if (!sec) return;
    var grid = $("galleryGrid"), empty = $("galleryEmpty"), count = $("resultCount");
    if (!grid) return;
    var visible = (sec.items || []).filter(matches);
    grid.innerHTML = visible.map(galleryCard).join("");
    if (empty) empty.hidden = visible.length !== 0;
    if (count) count.textContent = ui("count")(visible.length);
    wireCards(grid);
  }

  function wireGallery() {
    var search = $("gallerySearch"), clear = $("galleryClear");
    if (search) {
      search.addEventListener("input", function () {
        gstate.q = search.value; toggleClear(); applyGallery();
      });
    }
    if (clear) clear.addEventListener("click", function () {
      gstate.q = ""; if (search) { search.value = ""; search.focus(); }
      toggleClear(); applyGallery();
    });
    toggleClear();
    [].forEach.call(document.querySelectorAll(".filter-chip"), function (btn) {
      btn.addEventListener("click", function () {
        var axis = btn.dataset.axis, val = btn.dataset.val;
        gstate[axis] = val;
        [].forEach.call(document.querySelectorAll('.filter-chip[data-axis="' + axis + '"]'), function (b) {
          var on = b.dataset.val === val;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-pressed", String(on));
        });
        applyGallery();
      });
    });
    applyGallery();
  }
  function toggleClear() {
    var clear = $("galleryClear");
    if (clear) clear.style.display = gstate.q ? "inline-flex" : "none";
  }

  /* =======================================================================
     RENDER
     ===================================================================== */
  function paintSections() {
    sectionsEl.innerHTML = "";
    SECTIONS.forEach(function (sec) {
      var fn = RENDERERS[sec.type];
      if (!fn) return;
      var el = document.createElement("section");
      el.className = "section section--" + sec.type;
      el.id = sec.id;
      if (sec.type !== "cta") el.setAttribute("aria-labelledby", sec.id + "-heading");
      el.innerHTML = fn(sec, state.lang);
      sectionsEl.appendChild(el);
    });
    wireGallery();
    [].forEach.call(document.querySelectorAll(".award-card[data-slug]"), function (c) {
      bindOpen(c, c.dataset.slug);
    });
  }

  function paintNav() {
    navInner.innerHTML = "";
    SECTIONS.forEach(function (sec) {
      var a = document.createElement("a");
      a.className = "navpill";
      a.href = "#" + sec.id;
      a.dataset.target = sec.id;
      a.innerHTML =
        '<span class="material-symbols-rounded" aria-hidden="true">' + (NAV_ICONS[sec.type] || "label") + "</span>" +
        "<span>" + escapeHtml(t(sec.title)) + "</span>";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var target = document.getElementById(sec.id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#" + sec.id);
      });
      navInner.appendChild(a);
    });
  }

  function paintChrome() {
    var titleStr = t(META.title), subStr = t(META.subtitle);
    document.title = subStr ? titleStr + " · " + subStr : titleStr;
    var brand = $("brandName"); if (brand) brand.textContent = titleStr;
    var al = $("analysisLabel"); if (al) al.textContent = ui("analysis");
    var foot = $("footerText"); if (foot) foot.textContent = ui("footer");
    var nav = $("sectionNav"); if (nav) nav.setAttribute("aria-label", ui("menu"));
    var dc = $("dialogClose"); if (dc) dc.setAttribute("aria-label", ui("close"));
  }

  function render() {
    paintChrome();
    paintNav();
    paintSections();
    setupScrollSpy();
    animateCounters();
  }

  /* =======================================================================
     HERO COUNT-UP
     ===================================================================== */
  function animateCounters() {
    var els = [].slice.call(document.querySelectorAll(".hero__stat-value[data-count]"));
    if (!els.length) return;
    function run(el) {
      if (el.dataset.done === "1") return;
      el.dataset.done = "1";
      var target = parseFloat(el.dataset.count) || 0, pre = el.dataset.prefix || "";
      var dur = 1200, start = null;
      function step(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = pre + commas(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = pre + commas(target);
      }
      requestAnimationFrame(step);
    }
    if (!("IntersectionObserver" in window)) { els.forEach(run); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { run(en.target); io.unobserve(en.target); } });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* =======================================================================
     SCROLLSPY
     ===================================================================== */
  var spyObserver = null;
  function setupScrollSpy() {
    if (spyObserver) { spyObserver.disconnect(); spyObserver = null; }
    if (!("IntersectionObserver" in window)) return;
    var pills = {};
    [].forEach.call(navInner.children, function (a) { pills[a.dataset.target] = a; });
    spyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var pill = pills[en.target.id];
        if (!pill) return;
        if (en.isIntersecting) {
          [].forEach.call(navInner.children, function (p) {
            p.classList.remove("navpill--active"); p.removeAttribute("aria-current");
          });
          pill.classList.add("navpill--active");
          pill.setAttribute("aria-current", "true");
          if (pill.scrollIntoView) pill.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    SECTIONS.forEach(function (sec) {
      var el = document.getElementById(sec.id); if (el) spyObserver.observe(el);
    });
  }

  /* =======================================================================
     DIALOG — company detail with #slug deep links
     ===================================================================== */
  function openDialog(slug) {
    var item = ITEM_INDEX[slug];
    if (!item) return;

    var inferred = isInferred(item);
    // status flag: verified company -> 已查證 ; inferred company -> 推估 ;
    // team -> no flag (its anonymized status is shown via the Type fact, not a guess)
    var statusFlag = item.verified
      ? '<span class="d-flag d-flag--ok"><span class="material-symbols-rounded" aria-hidden="true">verified</span>' + escapeHtml(ui("verified")) + "</span>"
      : (inferred
        ? '<span class="d-flag d-flag--inf"><span class="material-symbols-rounded" aria-hidden="true">help</span>' + escapeHtml(ui("inferred")) + "</span>"
        : "");
    var badges =
      '<span class="stage-badge stage--' + escapeHtml(item.stage) + '">' +
        (item.stage === "winner" ? '<span class="material-symbols-rounded" aria-hidden="true">emoji_events</span>' : "") +
        escapeHtml(t(LABELS.stage[item.stage])) + "</span>" + statusFlag;

    // inferred company: a prominent warning that the industry/desc below is a guess
    var warnBanner = inferred
      ? '<div class="d-warn"><span class="material-symbols-rounded" aria-hidden="true">warning</span>' +
        '<span>' + escapeHtml(ui("inferWarn")) + "</span></div>"
      : "";

    var awardBlock = item.award
      ? '<div class="d-award ribbon--' + escapeHtml(item.award) + '">' +
          '<span class="material-symbols-rounded" aria-hidden="true">' +
            (item.award === "president" ? "workspace_premium" : "military_tech") + "</span>" +
          "<div><b>" + escapeHtml(t(LABELS.award[item.award])) + "</b>" +
          "<span>" + escapeHtml(t(LABELS.prize[item.award])) +
            (item.city ? " · " + escapeHtml(item.city) : "") + "</span></div>" +
        "</div>" : "";

    var rows =
      '<dl class="d-facts">' +
        fact(ui("idLabel"), item.id) +
        fact(ui("axisCategory"), catLabel(item.category)) +
        fact(ui("axisType"), t(LABELS.type[item.type])) +
        fact(ui("axisRegion"), t(LABELS.region[item.region])) +
        (item.city ? fact(ui("cityLabel"), item.city) : "") +
      "</dl>";

    var links = (item.links || []).map(function (l) {
      return '<li><a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener">' +
        '<span class="material-symbols-rounded" aria-hidden="true">open_in_new</span>' +
        escapeHtml(l.title || l.url) + "</a></li>";
    }).join("");
    var linkBlock = links
      ? '<div class="d-sources"><h4>' + escapeHtml(ui("sources")) + "</h4><ul>" + links + "</ul></div>" : "";

    dialogBody.innerHTML =
      awardBlock +
      '<div class="d-badges">' + badges + "</div>" +
      '<h2 id="dialogTitle">' + escapeHtml(t(item.title)) + "</h2>" +
      warnBanner +
      '<p class="d-industry">' + escapeHtml(t(item.industry)) + "</p>" +
      '<p class="d-overview">' + escapeHtml(t(item.overview) || t(item.summary)) + "</p>" +
      rows + linkBlock;

    if (!dialog.open) dialog.showModal();
    if (location.hash.slice(1) !== slug) history.replaceState(null, "", "#" + slug);
  }
  function fact(label, val) {
    return "<div><dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(val) + "</dd></div>";
  }
  function closeDialog() {
    if (dialog.open) dialog.close();
    if (isSlugHash()) history.replaceState(null, "", location.pathname + location.search);
  }
  function isSlugHash() {
    var h = location.hash.slice(1);
    return !!h && !!ITEM_INDEX[h];
  }
  function bindOpen(el, slug) {
    el.addEventListener("click", function () { openDialog(slug); });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDialog(slug); }
    });
  }
  function wireCards(scope) {
    [].forEach.call((scope || document).querySelectorAll(".ccard[data-slug]"), function (card) {
      bindOpen(card, card.dataset.slug);
    });
  }

  /* =======================================================================
     THEME + LANG
     ===================================================================== */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
    var icon = $("themeIcon");
    if (icon) icon.textContent = state.theme === "dark" ? "light_mode" : "dark_mode";
    lsSet("theme", state.theme);
  }
  function wire() {
    $("themeToggle").addEventListener("click", function () {
      state.theme = state.theme === "dark" ? "light" : "dark";
      applyTheme();
    });
    $("dialogClose").addEventListener("click", closeDialog);
    dialog.addEventListener("click", function (e) { if (e.target === dialog) closeDialog(); });
    dialog.addEventListener("close", function () {
      if (isSlugHash()) history.replaceState(null, "", location.pathname + location.search);
    });
    window.addEventListener("hashchange", syncFromHash);
  }

  function syncFromHash() {
    var slug = location.hash.slice(1);
    if (slug && ITEM_INDEX[slug]) openDialog(slug);
    else if (!slug && dialog.open) dialog.close();
  }

  /* ---------- init ---------- */
  function init() {
    applyTheme();
    render();
    wire();
    syncFromHash();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
