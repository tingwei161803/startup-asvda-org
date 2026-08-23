/* =========================================================================
   創業大聯盟 100 強・深度分析 — analysis/app.js
   Vanilla JS · no build. Reuses the main site's MD3 ink+gold tokens
   (../assets/styles.css) plus analysis.css.

   Consumes globals from data/data.js:
     SITE_META, A_HERO, A_THEMES, A_LENSES, A_PICKS, A_QUOTES, A_METHOD
   Renders a fixed ordered set of sections; the lens cards open a detail
   dialog (deep-linkable via #<lensSlug>); spotlight/pick companies link
   back into the main 名錄 at ../#<id>.
   ========================================================================= */
(function () {
  "use strict";

  var META   = window.SITE_META || { title: {}, subtitle: {} };
  var HERO   = window.A_HERO || {};
  var THEMES = window.A_THEMES || [];
  var LENSES = window.A_LENSES || [];
  var PICKS  = window.A_PICKS || [];
  var QUOTES = window.A_QUOTES || [];
  var METHOD = window.A_METHOD || { blocks: [] };

  var I18N = {
    en: {
      footer: "Unofficial analysis & visualization · multi-agent draft, human-reviewed · static site.",
      close: "Close", menu: "On this page", back: "Directory",
      report: "Full report", picks: "Companies to watch", methods: "Methods/Frameworks",
      spotlight: "Spotlight", viewInDir: "View in directory",
      navOverview: "Overview", navThemes: "Cross-cutting Themes", navLenses: "Analytical Lenses",
      navPicks: "Companies to Watch", navVoices: "Key Takes", navMethod: "Method & Disclaimer",
      headThemes: "Cross-cutting Themes", subThemes: "Patterns that recur across every analytical lens.",
      headLenses: "Analytical Lenses", subLenses: "The same 100 startups, read through many professional lenses. Tap a lens for its findings.",
      headPicks: "Companies to Watch", subPicks: "Standout verified companies surfaced across the analyses (links open the main directory).",
      headVoices: "Key Takes", subVoices: "One sharp line from each lens.",
      headMethod: "Method & Disclaimer", subMethod: "How this was produced, and what to trust."
    },
    zh: {
      footer: "非官方分析與視覺化 · 多代理人產出、人工審閱 · 純靜態網站。",
      close: "關閉", menu: "本頁導覽", back: "入選名錄",
      report: "完整報告", picks: "值得關注的公司", methods: "分析方法／框架",
      spotlight: "焦點公司", viewInDir: "到名錄查看",
      navOverview: "總覽", navThemes: "跨視角主題", navLenses: "分析視角",
      navPicks: "值得關注", navVoices: "重點金句", navMethod: "方法與聲明",
      headThemes: "跨視角主題", subThemes: "在所有分析視角中反覆出現的模式。",
      headLenses: "分析視角", subLenses: "同樣的 100 家新創，用多種專業視角解讀。點一張卡看該視角的發現。",
      headPicks: "值得關注的公司", subPicks: "各視角中最突出的「已查證」公司（點擊可回名錄查看）。",
      headVoices: "重點金句", subVoices: "每個視角最有力的一句話。",
      headMethod: "方法與聲明", subMethod: "這份分析怎麼產出、哪些可信。"
    }
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  /* The URL decides the language: each language has its own page, and that page
     declares which one it is in <html lang>. Never read the language back from
     storage — a visitor landing on /en/ must get English even if they once
     picked 中文, and crawlers have no storage at all. */
  var pageLang = (document.documentElement.getAttribute("lang") || "en")
    .toLowerCase().indexOf("zh") === 0 ? "zh" : "en";

  var state = { lang: pageLang, theme: lsGet("theme") || "dark" };

  var $ = function (id) { return document.getElementById(id); };
  var sectionsEl = $("sections"), navInner = $("sectionNavInner"),
      dialog = $("dialog"), dialogBody = $("dialogBody");

  function t(o) { if (o == null) return ""; if (typeof o === "string") return o; return o[state.lang] || o.en || o.zh || ""; }
  function ui(k) { return (I18N[state.lang] || I18N.en)[k]; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]; }); }
  function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function dirLink(id) { return "../#" + String(id || "").toLowerCase(); }

  /* lens index for the dialog */
  var LENS_INDEX = {};
  LENSES.forEach(function (l) { LENS_INDEX[l.slug] = l; });

  function head(titleKey, subKey) {
    return '<header class="section-head"><h2 id="' + titleKey + '-heading">' + esc(ui(titleKey)) + "</h2>" +
      '<p class="section-head__sub">' + esc(ui(subKey)) + "</p></header>";
  }

  /* ---- sections ---- */
  var SECTIONS = [
    { id: "overview", nav: "navOverview", icon: "summarize", render: renderOverview },
    { id: "themes",   nav: "navThemes",   icon: "hub",        render: renderThemes },
    { id: "lenses",   nav: "navLenses",   icon: "stylus_note", render: renderLenses },
    { id: "picks",    nav: "navPicks",    icon: "star",       render: renderPicks },
    { id: "voices",   nav: "navVoices",   icon: "format_quote", render: renderVoices },
    { id: "method",   nav: "navMethod",   icon: "policy",     render: renderMethod }
  ];

  function renderOverview() {
    var stats = (HERO.stats || []).map(function (s) {
      // count-up ONLY for a clean integer (optionally ~/≈ prefixed, comma-grouped, '+' suffix);
      // composite values like "63 / 100" or "84% vs 42%" render verbatim as text.
      var num = /^[~≈]?[\d,]+\+?$/.test(String(s.value).trim());
      return '<div class="hero__stat" data-item>' +
        '<b class="hero__stat-value' + (num ? "" : " hero__stat-value--text") + '"' +
          (num ? ' data-count="' + esc(String(s.value)) + '"' : "") + '>' + esc(String(s.value)) + "</b>" +
        '<span class="hero__stat-label">' + esc(t(s.label)) + "</span></div>";
    }).join("");
    return '<header class="section-head"><span class="a-eyebrow">VC × 顧問 · 多視角分析</span>' +
      '<h2 id="overview-heading">' + esc(t(HERO.headline)) + "</h2>" +
      (t(HERO.thesis) ? '<p class="a-thesis">' + esc(t(HERO.thesis)) + "</p>" : "") +
      "</header>" + (stats ? '<div class="hero__stats">' + stats + "</div>" : "");
  }

  function renderThemes() {
    var cards = THEMES.map(function (th, i) {
      return '<article class="theme-card" data-item>' +
        '<span class="theme-card__no">' + (i + 1 < 10 ? "0" : "") + (i + 1) + "</span>" +
        '<h3 class="theme-card__title">' + esc(t(th.title)) + "</h3>" +
        '<p class="theme-card__detail">' + esc(t(th.detail)) + "</p></article>";
    }).join("");
    return head("headThemes", "subThemes") + '<div class="theme-grid">' + cards + "</div>";
  }

  function renderLenses() {
    var cards = LENSES.map(function (l) {
      var n = (l.keyFindings || []).length;
      return '<article class="lens-card card" tabindex="0" role="button" data-item data-lens="' + esc(l.slug) + '" ' +
          'aria-label="' + esc(t(l.title)) + '">' +
        '<span class="lens-card__icon material-symbols-rounded" aria-hidden="true">' + esc(l.icon || "insights") + "</span>" +
        '<span class="lens-card__role">' + esc(t(l.role)) + "</span>" +
        '<h3 class="lens-card__title">' + esc(t(l.title)) + "</h3>" +
        '<p class="lens-card__tagline">' + esc(t(l.tagline)) + "</p>" +
        '<span class="lens-card__more">' + n + ' ' + (state.lang === "zh" ? "項發現" : "findings") +
          ' <span class="material-symbols-rounded" aria-hidden="true">arrow_forward</span></span>' +
      "</article>";
    }).join("");
    return head("headLenses", "subLenses") + '<div class="lens-grid">' + cards + "</div>";
  }

  function renderPicks() {
    var cards = PICKS.map(function (p) {
      return '<a class="pick-card" data-item href="' + esc(dirLink(p.id)) + '">' +
        '<span class="pick-card__id">' + esc(p.id) + "</span>" +
        '<h3 class="pick-card__name">' + esc(p.name) + "</h3>" +
        '<p class="pick-card__angle">' + esc(t(p.angle)) + "</p>" +
        '<span class="pick-card__cta">' + esc(ui("viewInDir")) +
          ' <span class="material-symbols-rounded" aria-hidden="true">north_east</span></span></a>';
    }).join("");
    return head("headPicks", "subPicks") + '<div class="pick-grid">' + cards + "</div>";
  }

  function renderVoices() {
    var cards = QUOTES.map(function (q) {
      return '<figure class="quote-card" data-item>' +
        '<span class="material-symbols-rounded quote-mark" aria-hidden="true">format_quote</span>' +
        "<blockquote>" + esc(t(q.text)) + "</blockquote>" +
        (q.by ? '<figcaption class="quote-by">— ' + esc(t(q.by)) + "</figcaption>" : "") + "</figure>";
    }).join("");
    return head("headVoices", "subVoices") + '<div class="quotes-grid">' + cards + "</div>";
  }

  function renderMethod() {
    var body = (METHOD.blocks || []).map(function (b) {
      if (b.type === "h3") return "<h3>" + esc(t(b.text)) + "</h3>";
      if (b.type === "ul") {
        var arr = (b.items && (b.items[state.lang] || b.items.en || b.items.zh)) || [];
        return "<ul>" + arr.map(function (li) { return "<li>" + esc(li) + "</li>"; }).join("") + "</ul>";
      }
      return "<p>" + esc(t(b.text)) + "</p>";
    }).join("");
    return head("headMethod", "subMethod") + '<div class="prose" data-item>' + body + "</div>";
  }

  /* ---- paint ---- */
  function paintSections() {
    sectionsEl.innerHTML = "";
    SECTIONS.forEach(function (sec) {
      var el = document.createElement("section");
      el.className = "section section--" + sec.id;
      el.id = sec.id;
      el.setAttribute("aria-labelledby", (sec.id === "overview" ? "overview" : ui2head(sec)) + "-heading");
      el.innerHTML = sec.render();
      sectionsEl.appendChild(el);
    });
    wireLenses();
  }
  function ui2head(sec) { return { themes: "headThemes", lenses: "headLenses", picks: "headPicks", voices: "headVoices", method: "headMethod" }[sec.id] || sec.id; }

  function paintNav() {
    navInner.innerHTML = "";
    SECTIONS.forEach(function (sec) {
      var a = document.createElement("a");
      a.className = "navpill"; a.href = "#" + sec.id; a.dataset.target = sec.id;
      a.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">' + sec.icon + "</span><span>" + esc(ui(sec.nav)) + "</span>";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var tg = document.getElementById(sec.id);
        if (tg) tg.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#" + sec.id);
      });
      navInner.appendChild(a);
    });
  }

  function paintChrome() {
    var tt = t(META.title), sub = t(META.subtitle);
    document.title = sub ? tt + " · " + sub : tt;
    var b = $("brandName"); if (b) b.textContent = tt;
    var f = $("footerText"); if (f) f.textContent = ui("footer");
    var bl = $("backLabel"); if (bl) bl.textContent = ui("back");
    var dc = $("dialogClose"); if (dc) dc.setAttribute("aria-label", ui("close"));
    var nv = $("sectionNav"); if (nv) nv.setAttribute("aria-label", ui("menu"));
  }

  function render() { paintChrome(); paintNav(); paintSections(); setupScrollSpy(); animateCounters(); }

  /* ---- lens dialog (deep-linkable) ---- */
  function openLens(slug) {
    var l = LENS_INDEX[slug];
    if (!l) return;
    var findings = (l.keyFindings || []).map(function (f) {
      return '<li class="d-finding"><b>' + esc(t(f.title)) + "</b><span>" + esc(t(f.detail)) + "</span></li>";
    }).join("");
    var spot = (l.spotlight || []).map(function (s) {
      return '<a class="d-spot" href="' + esc(dirLink(s.id)) + '"><b>' + esc(s.name) +
        ' <span class="d-spot__id">' + esc(s.id) + "</span></b><span>" + esc(t(s.why)) + "</span></a>";
    }).join("");
    var report = l.reportUrl
      ? '<a class="d-report" href="' + esc(l.reportUrl) + '" target="_blank" rel="noopener">' +
        '<span class="material-symbols-rounded" aria-hidden="true">description</span>' + esc(ui("report")) +
        ' <span class="material-symbols-rounded" aria-hidden="true">open_in_new</span></a>' : "";
    dialogBody.innerHTML =
      '<span class="d-lens-role"><span class="material-symbols-rounded" aria-hidden="true">' + esc(l.icon || "insights") + "</span>" + esc(t(l.role)) + "</span>" +
      '<h2 id="dialogTitle">' + esc(t(l.title)) + "</h2>" +
      (t(l.tagline) ? '<p class="d-tagline">' + esc(t(l.tagline)) + "</p>" : "") +
      '<ul class="d-findings">' + findings + "</ul>" +
      (spot ? '<h4 class="d-h4">' + esc(ui("spotlight")) + '</h4><div class="d-spots">' + spot + "</div>" : "") +
      (t(l.methods) ? '<h4 class="d-h4">' + esc(ui("methods")) + '</h4><p class="d-methods">' + esc(t(l.methods)) + "</p>" : "") +
      (t(l.pullQuote) ? '<blockquote class="d-quote">' + esc(t(l.pullQuote)) + "</blockquote>" : "") +
      report;
    if (!dialog.open) dialog.showModal();
    if (location.hash.slice(1) !== slug) history.replaceState(null, "", "#" + slug);
  }
  function closeDialog() {
    if (dialog.open) dialog.close();
    if (isLensHash()) history.replaceState(null, "", location.pathname + location.search);
  }
  function isLensHash() { var h = location.hash.slice(1); return !!h && !!LENS_INDEX[h]; }
  function wireLenses() {
    [].forEach.call(document.querySelectorAll(".lens-card[data-lens]"), function (c) {
      var slug = c.dataset.lens;
      c.addEventListener("click", function () { openLens(slug); });
      c.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLens(slug); } });
    });
  }

  /* ---- count-up ---- */
  function animateCounters() {
    var els = [].slice.call(document.querySelectorAll(".hero__stat-value[data-count]"));
    if (!els.length) return;
    function run(el) {
      if (el.dataset.done === "1") return; el.dataset.done = "1";
      var raw = el.dataset.count, pre = (raw.match(/^[~≈]/) || [""])[0];
      var target = parseFloat(raw.replace(/[^\d.]/g, "")) || 0, start = null;
      function step(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / 1200), e = 1 - Math.pow(1 - p, 3);
        el.textContent = pre + commas(Math.round(target * e));
        if (p < 1) requestAnimationFrame(step); else el.textContent = pre + commas(target);
      }
      requestAnimationFrame(step);
    }
    if (!("IntersectionObserver" in window)) { els.forEach(run); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { run(en.target); io.unobserve(en.target); } }); }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---- scrollspy ---- */
  var spy = null;
  function setupScrollSpy() {
    if (spy) { spy.disconnect(); spy = null; }
    if (!("IntersectionObserver" in window)) return;
    var pills = {};
    [].forEach.call(navInner.children, function (a) { pills[a.dataset.target] = a; });
    spy = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        var p = pills[en.target.id]; if (!p) return;
        if (en.isIntersecting) {
          [].forEach.call(navInner.children, function (x) { x.classList.remove("navpill--active"); x.removeAttribute("aria-current"); });
          p.classList.add("navpill--active"); p.setAttribute("aria-current", "true");
          if (p.scrollIntoView) p.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    SECTIONS.forEach(function (s) { var el = document.getElementById(s.id); if (el) spy.observe(el); });
  }

  /* ---- theme/lang ---- */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme);
    var i = $("themeIcon"); if (i) i.textContent = state.theme === "dark" ? "light_mode" : "dark_mode";
    lsSet("theme", state.theme);
  }
  function wire() {
    $("themeToggle").addEventListener("click", function () { state.theme = state.theme === "dark" ? "light" : "dark"; applyTheme(); });
    $("dialogClose").addEventListener("click", closeDialog);
    dialog.addEventListener("click", function (e) { if (e.target === dialog) closeDialog(); });
    dialog.addEventListener("close", function () { if (isLensHash()) history.replaceState(null, "", location.pathname + location.search); });
    window.addEventListener("hashchange", syncFromHash);
  }
  function syncFromHash() { var s = location.hash.slice(1); if (s && LENS_INDEX[s]) openLens(s); else if (!s && dialog.open) dialog.close(); }

  function init() { applyTheme(); render(); wire(); syncFromHash(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
