#!/usr/bin/env python3
"""Convert docs/PORTAL_WALKTHROUGH.md to a print-ready HTML deck, then print it to PDF.

Deliberately handles only the markdown subset that document uses. Mermaid fences are
replaced with hand-built CSS flow strips so the output needs no network or JS.

Rebuild the PDF after editing the markdown or re-capturing screenshots:

    python3 scripts/build_walkthrough_pdf.py docs/PORTAL_WALKTHROUGH.md docs/_walkthrough.print.html
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \\
      --no-pdf-header-footer --print-to-pdf-no-header --virtual-time-budget=40000 \\
      --print-to-pdf="$PWD/docs/PORTAL_WALKTHROUGH.pdf" \\
      "file://$PWD/docs/_walkthrough.print.html"
    rm docs/_walkthrough.print.html

The intermediate HTML must live in docs/ so the relative screenshots/ paths resolve.
"""
import html
import re
import sys

SRC, OUT = sys.argv[1], sys.argv[2]

# ---------------------------------------------------------------- flow diagrams


def strip(node: str) -> str:
    return node.replace("<br/>", " ").replace("<i>", "").replace("</i>").strip() if False else \
        node.replace("<br/>", " ").replace("<i>", "").replace("</i>", "").replace("<b>", "").replace("</b>", "").strip()


def chain(steps, tone=None, vertical=False):
    tone = tone or {}
    cls = "flow flow-v" if vertical else "flow"
    parts = []
    for i, s in enumerate(steps):
        if i:
            parts.append('<span class="flow-arrow">%s</span>' % ("&#8595;" if vertical else "&#8594;"))
        k = tone.get(s, "")
        parts.append('<span class="flow-node %s">%s</span>' % (k, html.escape(s)))
    return '<div class="%s">%s</div>' % (cls, "".join(parts))


def note(text):
    return '<div class="flow-note">%s</div>' % text


DIAGRAMS = [
    # 0.1 — the pipeline
    chain([
        "Budget authored", "Budget approved (3 gates)", "Request raised", "Plant head approves",
        "Sourcing RFQ / auction", "Technical spec signed", "Vendor awarded", "Accounts: FA + PO",
        "Payments + trial", "Completed",
    ], tone={"Completed": "ok", "Budget approved (3 gates)": "gate", "Technical spec signed": "gate",
             "Plant head approves": "gate"}),

    # Part 2 — budget proposal states
    chain(["draft (blank)", "pending_plant_head", "pending_admin", "pending_accounts",
           "approved — published to master"],
          tone={"approved — published to master": "ok"})
    + note("Either of the first two approvers can <b>edit &amp; send back</b> &rarr; "
           "<span class=\"pill warn\">needs_correction</span> &rarr; the author resubmits, which restarts "
           "from the plant head with a rotated token. Any gate can "
           "<span class=\"pill bad\">reject</span>."),

    # Part 9 — fulfilment
    chain([
        "Sourcing awards + requests PI",
        "Vendor uploads Proforma Invoice",
        "✉ email → Plant Accounts",
        "Plant Accounts assign FA codes",
        "✉ email → Satish (Global Accounts)",
        "Satish uploads PO + issues to vendor",
        "Vendor downloads PO (may re-upload PI)",
        "Plant Accounts tick the advance",
        "Vendor uploads the item trial",
        "Sourcing approves the trial",
        "Remaining milestones → award completed",
    ], tone={"Remaining milestones → award completed": "ok",
             "✉ email → Plant Accounts": "mail",
             "✉ email → Satish (Global Accounts)": "mail"}, vertical=True),

    # 12.3 — request status flow
    chain(["draft", "submitted", "pending_head_approval", "sourcing", "pi_requested", "pi_submitted",
           "accounts_processing", "payment_in_progress", "completed"],
          tone={"completed": "ok", "pending_head_approval": "gate"})
    + note("<b>Green Field</b> skips the plant head and enters <span class=\"pill\">sourcing</span> "
           "directly. A <b>split award</b> keeps the request coarse — "
           "<span class=\"pill\">pi_requested</span> while awards are in flight, "
           "<span class=\"pill ok\">completed</span> once every award finishes — while each vendor runs "
           "<span class=\"pill\">awarded &rarr; pi_requested &rarr; pi_submitted &rarr; accounts_processing "
           "&rarr; payment_in_progress &rarr; completed</span> on its own. Any stage from "
           "<span class=\"pill\">pending_head_approval</span> onward can end in "
           "<span class=\"pill bad\">rejected</span>."),
]

# ---------------------------------------------------------------- inline markdown

def inline(t: str) -> str:
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', t)
    return t


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9 ]+", "", text.lower()).strip().replace(" ", "-")
    return s or "section"


# ---------------------------------------------------------------- block parser

lines = open(SRC, encoding="utf-8").read().split("\n")
body, toc = [], []
i, mermaid_n = 0, 0
first_h1 = True

while i < len(lines):
    ln = lines[i]

    # mermaid fence
    if ln.strip().startswith("```mermaid"):
        i += 1
        while i < len(lines) and not lines[i].strip().startswith("```"):
            i += 1
        i += 1
        body.append(DIAGRAMS[mermaid_n] if mermaid_n < len(DIAGRAMS) else "")
        mermaid_n += 1
        continue

    # horizontal rule
    if ln.strip() == "---":
        body.append('<hr class="rule">')
        i += 1
        continue

    # headings
    m = re.match(r"^(#{1,4})\s+(.*)$", ln)
    if m:
        lvl, text = len(m.group(1)), m.group(2).strip()
        a = slug(text)
        if lvl == 1:
            cls = "part first-part" if first_h1 else "part"
            first_h1 = False
            toc.append((1, text, a))
        else:
            cls = "slide" if lvl == 2 else ""
            if lvl == 2:
                toc.append((2, text, a))
        body.append('<h%d id="%s" class="%s">%s</h%d>' % (lvl, a, cls, inline(text), lvl))
        i += 1
        continue

    # standalone image
    m = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)\s*$", ln.strip())
    if m:
        body.append('<figure><img src="%s" alt="%s"></figure>' % (m.group(2), html.escape(m.group(1))))
        i += 1
        continue

    # table
    if ln.strip().startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|\s*$", lines[i + 1]):
        def cells(row):
            return [c.strip() for c in row.strip().strip("|").split("|")]

        head = cells(ln)
        i += 2
        rows = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            rows.append(cells(lines[i]))
            i += 1
        t = ["<table><thead><tr>"]
        t += ["<th>%s</th>" % inline(c) for c in head]
        t.append("</tr></thead><tbody>")
        for r in rows:
            t.append("<tr>" + "".join("<td>%s</td>" % inline(c) for c in r) + "</tr>")
        t.append("</tbody></table>")
        body.append("".join(t))
        continue

    # blockquote
    if ln.startswith(">"):
        buf = []
        while i < len(lines) and lines[i].startswith(">"):
            buf.append(lines[i].lstrip(">").strip())
            i += 1
        body.append("<blockquote>%s</blockquote>" % inline(" ".join(buf).strip()))
        continue

    # lists
    if re.match(r"^\s*(?:[-*]|\d+\.)\s+", ln):
        ordered = bool(re.match(r"^\s*\d+\.\s+", ln))
        items = []
        while i < len(lines):
            cur = lines[i]
            m2 = re.match(r"^\s*(?:[-*]|\d+\.)\s+(.*)$", cur)
            if m2:
                items.append(m2.group(1))
                i += 1
            elif cur.startswith("  ") and cur.strip() and items:
                items[-1] += " " + cur.strip()
                i += 1
            else:
                break
        tag = "ol" if ordered else "ul"
        body.append("<%s>%s</%s>" % (tag, "".join("<li>%s</li>" % inline(x) for x in items), tag))
        continue

    # blank
    if not ln.strip():
        i += 1
        continue

    # paragraph
    buf = []
    while i < len(lines) and lines[i].strip() and not re.match(
            r"^(#{1,4}\s|\||>|\s*(?:[-*]|\d+\.)\s|```|!\[)", lines[i]) and lines[i].strip() != "---":
        buf.append(lines[i].strip())
        i += 1
    if buf:
        body.append("<p>%s</p>" % inline(" ".join(buf)))

# ---------------------------------------------------------------- assemble

toc_html, part_open = ["<ol class='toc'>"], False
for lvl, text, a in toc:
    label = html.escape(re.sub(r"[*`]", "", text))
    if lvl == 1:
        if part_open:
            toc_html.append("</ul></li>")
        toc_html.append('<li class="toc-part"><a href="#%s">%s</a><ul>' % (a, label))
        part_open = True
    else:
        toc_html.append('<li><a href="#%s">%s</a></li>' % (a, label))
if part_open:
    toc_html.append("</ul></li>")
toc_html.append("</ol>")
toc_str = "".join(toc_html).replace("<ul></ul>", "")

CSS = """
@page { size: A4; margin: 14mm 13mm 14mm 13mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font: 10.5pt/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
       color: #171717; margin: 0; }
h1, h2, h3, h4 { line-height: 1.25; margin: 0; }
h1.part { font-size: 21pt; letter-spacing: -.01em; padding: 0 0 6pt; margin: 0 0 12pt;
          border-bottom: 2.5pt solid #171717; page-break-before: always; page-break-after: avoid; }
h1.first-part { page-break-before: avoid; }
h2.slide { font-size: 13.5pt; margin: 16pt 0 7pt; padding-left: 8pt;
           border-left: 3pt solid #2563EB; page-break-after: avoid; }
h3 { font-size: 11.5pt; margin: 13pt 0 5pt; page-break-after: avoid; }
p { margin: 0 0 8pt; orphans: 3; widows: 3; }
strong { font-weight: 650; }
code { font: 9pt/1.4 ui-monospace, Menlo, Consolas, monospace;
       background: #F4F4F5; padding: .5pt 3pt; border-radius: 3px; }
a { color: #2563EB; text-decoration: none; }
hr.rule { border: 0; border-top: .6pt solid #E4E4E7; margin: 14pt 0; }
ul, ol { margin: 0 0 9pt; padding-left: 18pt; }
li { margin: 0 0 4pt; }
blockquote { margin: 0 0 10pt; padding: 8pt 11pt; background: #F8FAFC;
             border-left: 3pt solid #94A3B8; font-style: italic; page-break-inside: avoid; }
figure { margin: 0 0 12pt; page-break-inside: avoid; }
figure img { display: block; width: 100%; border: .6pt solid #D4D4D8; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; margin: 0 0 11pt; font-size: 9pt;
        page-break-inside: avoid; }
th { background: #171717; color: #fff; text-align: left; font-weight: 600;
     padding: 5pt 7pt; font-size: 8.5pt; }
td { padding: 4.5pt 7pt; border-bottom: .5pt solid #E4E4E7; vertical-align: top; }
tbody tr:nth-child(even) td { background: #FAFAFA; }

/* flow strips (replacing mermaid) */
.flow { display: flex; flex-wrap: wrap; align-items: center; gap: 5pt;
        margin: 0 0 11pt; page-break-inside: avoid; }
.flow-v { flex-direction: column; align-items: flex-start; gap: 3pt; }
.flow-node { display: inline-block; padding: 4.5pt 8pt; border: .8pt solid #A1A1AA;
             border-radius: 5px; background: #fff; font-size: 8.8pt; font-weight: 550; }
.flow-node.ok { border-color: #059669; background: #ECFDF5; color: #065F46; }
.flow-node.gate { border-color: #2563EB; background: #EFF6FF; color: #1E40AF; }
.flow-node.mail { border-color: #D97706; background: #FFFBEB; color: #92400E; }
.flow-arrow { color: #71717A; font-size: 10pt; }
.flow-v .flow-arrow { padding-left: 12pt; }
.flow-note { font-size: 9pt; color: #3F3F46; background: #FAFAFA; border: .5pt solid #E4E4E7;
             border-radius: 5px; padding: 7pt 9pt; margin: 0 0 11pt; page-break-inside: avoid; }
.pill { display: inline-block; padding: .5pt 4pt; border-radius: 3px; background: #F4F4F5;
        border: .5pt solid #D4D4D8; font-size: 8pt;
        font-family: ui-monospace, Menlo, monospace; }
.pill.ok { background: #ECFDF5; border-color: #6EE7B7; color: #065F46; }
.pill.warn { background: #FFFBEB; border-color: #FCD34D; color: #92400E; }
.pill.bad { background: #FEF2F2; border-color: #FCA5A5; color: #991B1B; }

/* cover + contents */
.cover { height: 252mm; display: flex; flex-direction: column; justify-content: center;
         page-break-after: always; }
.cover .kicker { font-size: 9pt; letter-spacing: .18em; text-transform: uppercase;
                 color: #2563EB; font-weight: 700; margin-bottom: 10pt; }
.cover h1 { font-size: 40pt; letter-spacing: -.025em; line-height: 1.03; border: 0;
            padding: 0; margin: 0 0 14pt; page-break-before: avoid; }
.cover .sub { font-size: 13pt; color: #3F3F46; max-width: 145mm; line-height: 1.45; }
.cover .meta { margin-top: 26pt; border-top: 1.5pt solid #171717; padding-top: 12pt;
               display: flex; flex-wrap: wrap; gap: 6pt 30pt; font-size: 9.5pt; }
.cover .meta b { display: block; font-size: 7.5pt; letter-spacing: .12em;
                 text-transform: uppercase; color: #71717A; margin-bottom: 2pt; }
.toc-page { page-break-after: always; }
.toc-page h1 { font-size: 20pt; border-bottom: 2.5pt solid #171717; padding-bottom: 6pt;
               margin-bottom: 14pt; page-break-before: avoid; }
ol.toc { list-style: none; padding: 0; margin: 0; column-count: 3; column-gap: 7mm;
         font-size: 7.4pt; line-height: 1.35; }
ol.toc > li.toc-part { break-inside: avoid; margin-bottom: 6pt; }
ol.toc > li.toc-part > a { font-weight: 700; font-size: 8.2pt; color: #171717; }
ol.toc ul { list-style: none; padding: 0 0 0 6pt; margin: 2pt 0 0; }
ol.toc ul li { margin: 0 0 .8pt; }
ol.toc ul a { color: #52525B; }
"""

COVER = """
<section class="cover">
  <div class="kicker">Product walkthrough &middot; Amber Enterprises India Ltd</div>
  <h1>Amber CAPEX<br>Portal</h1>
  <div class="sub">A slide-by-slide tour of the whole product &mdash; budget authoring, three-gate
  approval, requests, RFQ negotiation, the technical-spec gate, split awards, reverse auctions and
  fulfilment down to the last rupee &mdash; captured from a single real end-to-end run.</div>
  <div class="meta">
    <div><b>Captured</b>30 July 2026, from the running application</div>
    <div><b>Screens</b>87</div>
    <div><b>Scope</b>Jhajjar Plant 1 &middot; FY 2026-27 &middot; 2 requests &middot; 2 vendors &middot; 2 awards</div>
    <div><b>Source</b>docs/PORTAL_WALKTHROUGH.md</div>
  </div>
</section>
<section class="toc-page"><h1>Contents</h1>__TOC__</section>
"""

open(OUT, "w", encoding="utf-8").write(
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<title>Amber CAPEX Portal — Walkthrough</title><style>%s</style></head><body>%s%s</body></html>"
    % (CSS, COVER.replace("__TOC__", toc_str), "\n".join(body))
)
print("html written:", OUT, "| mermaid blocks replaced:", mermaid_n, "| toc entries:", len(toc))
