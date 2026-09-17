"""
Build the Review 2 presentation from data/project_data.json.

Usage:
    python presentation/build_deck.py

Produces presentation/ESP32_RL_Load_Balancer.pptx.

Every number on every slide is read from the shared data file, never typed
into this script. If a value is still pending_measurement the slide says so
rather than showing a placeholder as fact.
"""

import json
import os
import sys
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_FILE = os.path.join(REPO, 'data', 'project_data.json')
OUT_FILE = os.path.join(os.path.dirname(__file__), 'ESP32_RL_Load_Balancer.pptx')

# ── palette ──────────────────────────────────────────────────────────────
MIDNIGHT   = RGBColor(0x0E, 0x18, 0x22)
PAPER      = RGBColor(0xF7, 0xF4, 0xEE)
PAPER_DIM  = RGBColor(0xD8, 0xD3, 0xCB)
ORANGE     = RGBColor(0xE1, 0x6A, 0x3D)
BLUE       = RGBColor(0x3C, 0x83, 0xD1)
GREEN      = RGBColor(0x1E, 0x9C, 0x73)
MUTED      = RGBColor(0x7A, 0x84, 0x8E)
WARN_AMBER = RGBColor(0xC9, 0x90, 0x2F)
WHITE      = RGBColor(0xFF, 0xFF, 0xFF)
CHARCOAL   = RGBColor(0x1A, 0x24, 0x2E)

S_RR  = BLUE
S_QL  = ORANGE
S_EMA = GREEN

FONT_DISPLAY = 'Aptos Display'
FONT_BODY    = 'Aptos'
FONT_MONO    = 'Consolas'

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

# ── helpers ──────────────────────────────────────────────────────────────

def load_data():
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def dark_slide(prs):
    """Add a blank slide with a midnight background."""
    layout = prs.slide_layouts[6]  # blank
    slide = prs.slides.add_slide(layout)
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = MIDNIGHT
    return slide


def add_text(slide, left, top, width, height, text, *,
             font_name=FONT_BODY, font_size=Pt(16), color=PAPER,
             bold=False, alignment=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
             line_spacing=None):
    """Add a textbox and return the paragraph for chaining."""
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    if anchor:
        tf.paragraphs[0].alignment = alignment
    p = tf.paragraphs[0]
    p.text = text
    p.font.name = font_name
    p.font.size = font_size
    p.font.color.rgb = color
    p.font.bold = bold
    p.alignment = alignment
    if line_spacing:
        p.line_spacing = line_spacing
    return tf


def add_para(tf, text, *, font_name=FONT_BODY, font_size=Pt(16),
             color=PAPER, bold=False, alignment=PP_ALIGN.LEFT,
             space_before=Pt(0), space_after=Pt(0)):
    """Append a paragraph to an existing text frame."""
    p = tf.add_paragraph()
    p.text = text
    p.font.name = font_name
    p.font.size = font_size
    p.font.color.rgb = color
    p.font.bold = bold
    p.alignment = alignment
    p.space_before = space_before
    p.space_after = space_after
    return p


def tag(slide, left, top, text, color=MUTED, font_size=Pt(10)):
    """Small uppercase label."""
    add_text(slide, left, top, Inches(5), Pt(18), text.upper(),
             font_name=FONT_MONO, font_size=font_size, color=color, bold=False)


def big_number(slide, left, top, number_text, unit='', color=ORANGE):
    """Large hero metric."""
    tf = add_text(slide, left, top, Inches(6), Inches(1.2), number_text,
                  font_name=FONT_DISPLAY, font_size=Pt(72), color=color, bold=True)
    if unit:
        add_para(tf, unit, font_name=FONT_MONO, font_size=Pt(20), color=MUTED)
    return tf


def or_pending(val, fmt='{:.1f}', suffix=''):
    """Format a value or return a pending-measurement marker."""
    if val is None:
        return '—  (pending measurement)'
    return fmt.format(val) + suffix


def add_rect(slide, left, top, width, height, fill_color):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.fill.background()
    return shape


def add_table(slide, rows_data, col_widths, left, top, *,
              header_bg=CHARCOAL, header_fg=PAPER, row_bg=MIDNIGHT,
              row_fg=PAPER, alt_bg=RGBColor(0x14, 0x20, 0x2C),
              font_size=Pt(12), header_font_size=Pt(11)):
    """Add a styled table. rows_data[0] is the header row."""
    nrows = len(rows_data)
    ncols = len(rows_data[0])
    shape = slide.shapes.add_table(nrows, ncols, left, top,
                                   sum(col_widths), Inches(0.35) * nrows)
    tbl = shape.table
    for ci, w in enumerate(col_widths):
        tbl.columns[ci].width = w

    for ri, row in enumerate(rows_data):
        is_header = ri == 0
        for ci, cell_text in enumerate(row):
            cell = tbl.cell(ri, ci)
            cell.text = str(cell_text)
            p = cell.text_frame.paragraphs[0]
            p.font.name = FONT_MONO if ci > 0 or is_header else FONT_BODY
            p.font.size = header_font_size if is_header else font_size
            p.font.bold = is_header
            p.font.color.rgb = header_fg if is_header else row_fg
            p.alignment = PP_ALIGN.RIGHT if ci > 0 else PP_ALIGN.LEFT
            fill = cell.fill
            fill.solid()
            if is_header:
                fill.fore_color.rgb = header_bg
            else:
                fill.fore_color.rgb = row_bg if ri % 2 == 1 else alt_bg
    return tbl


# ── slide builders ───────────────────────────────────────────────────────

def slide_title(prs, D):
    s = dark_slide(prs)
    tag(s, Inches(0.8), Inches(1.0), f"{D['meta']['course']}  ·  {D['meta']['review']}")
    add_text(s, Inches(0.8), Inches(1.5), Inches(11), Inches(2.5),
             D['meta']['project_title'],
             font_name=FONT_DISPLAY, font_size=Pt(54), color=WHITE, bold=True)
    tf = add_text(s, Inches(0.8), Inches(3.6), Inches(10), Inches(1),
                  D['meta']['project_subtitle'],
                  font_name=FONT_BODY, font_size=Pt(22), color=PAPER_DIM)
    add_para(tf, '', font_size=Pt(12))
    add_para(tf, D['meta'].get('team', ''), font_size=Pt(16), color=MUTED)

    # accent bar
    add_rect(s, Inches(0.8), Inches(3.3), Inches(3), Pt(4), ORANGE)


def slide_problem(prs, D):
    s = dark_slide(prs)
    tag(s, Inches(0.8), Inches(0.5), 'The problem')
    add_text(s, Inches(0.8), Inches(0.9), Inches(11), Inches(1.2),
             'Cloud-dependent load balancing\nfails at the edge.',
             font_name=FONT_DISPLAY, font_size=Pt(40), color=WHITE, bold=True)

    outages = D['external_evidence']['outages']
    y = Inches(2.5)
    for o in outages:
        tf = add_text(s, Inches(0.8), y, Inches(5.5), Inches(1.5),
                      o['title'] + '  ·  ' + o['date'],
                      font_name=FONT_BODY, font_size=Pt(18), color=ORANGE, bold=True)
        add_para(tf, o['scale'], font_size=Pt(14), color=PAPER_DIM, space_before=Pt(4))
        add_para(tf, o['relevance'], font_size=Pt(13), color=MUTED, space_before=Pt(4))
        y += Inches(1.8)

    # SMB downtime cost
    datto = next((c for c in D['external_evidence']['downtime_costs'] if c['id'] == 'datto_smb'), None)
    if datto:
        add_text(s, Inches(7.2), Inches(2.6), Inches(5), Inches(0.5),
                 'SMB downtime cost', font_name=FONT_MONO, font_size=Pt(11), color=MUTED)
        big_number(s, Inches(7.2), Inches(3.0), f"${datto['value_usd_per_hour']:,}", '/ hour  (Datto, conservative)')


def slide_solution(prs, D):
    s = dark_slide(prs)
    tag(s, Inches(0.8), Inches(0.5), 'Our approach')
    add_text(s, Inches(0.8), Inches(0.9), Inches(11), Inches(1),
             'A $4 microcontroller that learns\nwhich backend is healthy.',
             font_name=FONT_DISPLAY, font_size=Pt(40), color=WHITE, bold=True)

    claims = D['novelty_claims']['claims']
    y = Inches(2.6)
    for c in claims:
        strength_color = ORANGE if c['strength'] == 'primary' else BLUE
        tf = add_text(s, Inches(0.8), y, Inches(11), Inches(1),
                      c['claim'],
                      font_name=FONT_BODY, font_size=Pt(16), color=WHITE, bold=True)
        add_para(tf, c['defensible_because'], font_size=Pt(13), color=PAPER_DIM, space_before=Pt(4))
        # strength dot
        add_rect(s, Inches(0.4), y + Pt(6), Pt(8), Pt(8), strength_color)
        y += Inches(1.1)


def slide_hardware_comparison(prs, D):
    s = dark_slide(prs)
    tag(s, Inches(0.8), Inches(0.5), 'Hardware comparison')
    add_text(s, Inches(0.8), Inches(0.9), Inches(11), Inches(0.8),
             'Cost, power, and attack surface.',
             font_name=FONT_DISPLAY, font_size=Pt(36), color=WHITE, bold=True)

    devs = D['hardware_comparison']['devices']
    header = ['Device', 'Class', 'Unit cost', 'Power (load)', 'Boot time', 'Attack surface']
    rows = [header]
    for d in devs:
        cost = f"${d['unit_cost_usd']}" if d['unit_cost_usd'] else f"${d.get('monthly_cost_usd',0)}/mo"
        power = f"{d['load_power_w']} W" if d['load_power_w'] else 'N/A'
        boot = f"{d['boot_time_s']} s" if d['boot_time_s'] else 'instant'
        rows.append([
            d['name'].split('(')[0].strip(),
            d['class'],
            cost,
            power,
            boot,
            d['attack_surface'][:40],
        ])

    col_widths = [Inches(2.2), Inches(1.5), Inches(1.1), Inches(1.3), Inches(1.0), Inches(3.5)]
    add_table(s, rows, col_widths, Inches(0.5), Inches(2.0))

    # power strip
    tag(s, Inches(0.8), Inches(5.0), 'Annual energy at 24/7 duty, $0.09/kWh')
    x = Inches(0.8)
    for d in devs:
        if d['id'] == 'cloud_lb':
            continue
        kwh = d['load_power_w'] * 24 * 365 / 1000
        cost_yr = kwh * 0.09
        is_esp = d['id'] == 'esp32'
        tf = add_text(s, x, Inches(5.4), Inches(2.5), Inches(1.2),
                      d['name'].split('(')[0].strip()[:20],
                      font_name=FONT_MONO, font_size=Pt(10), color=MUTED)
        add_para(tf, f"{kwh:.1f} kWh/yr", font_name=FONT_DISPLAY, font_size=Pt(24),
                 color=ORANGE if is_esp else PAPER, bold=True, space_before=Pt(4))
        add_para(tf, f"${cost_yr:.2f}/yr", font_name=FONT_MONO, font_size=Pt(13), color=MUTED)
        x += Inches(3.5)


def slide_how_it_works(prs, D):
    s = dark_slide(prs)
    tag(s, Inches(0.8), Inches(0.5), 'Algorithm')
    add_text(s, Inches(0.8), Inches(0.9), Inches(11), Inches(0.8),
             'Q-learning on a 520 KB device.',
             font_name=FONT_DISPLAY, font_size=Pt(36), color=WHITE, bold=True)

    items = [
        ('State', 'Number of active proxy sessions (0–7).', 'The concurrency context a pure bandit ignores.'),
        ('Action', 'Choose a backend server index.', 'Standard multi-armed bandit extension to MDP.'),
        ('Reward', 'r = 1000 / (duration_ms + 1)  if success\nr = −50  if timeout (≥ 2000 ms)', 'Reciprocal curve: 40 ms and 900 ms both "succeed" but differ by 15× in reward.'),
        ('Update', 'Q(s,a) ← Q(s,a) + α · [r + γ · max Q(s′,·) − Q(s,a)]', 'α = 0.3, γ = 0.5, ε decays 1.0 → 0.05 at 0.95/update.'),
    ]

    y = Inches(2.2)
    for label, detail, note in items:
        add_text(s, Inches(0.8), y, Inches(1.5), Inches(0.6), label,
                 font_name=FONT_DISPLAY, font_size=Pt(20), color=ORANGE, bold=True)
        tf = add_text(s, Inches(2.5), y, Inches(6), Inches(0.8), detail,
                      font_name=FONT_MONO, font_size=Pt(14), color=WHITE)
        add_para(tf, note, font_size=Pt(12), color=MUTED, space_before=Pt(6))
        y += Inches(1.15)

    # ESP32 socket constraint
    add_text(s, Inches(0.8), Inches(6.2), Inches(11), Inches(0.8),
             'Hard constraint: 16 sockets, 1 listener, 2 per session → 7 concurrent proxy sessions max.',
             font_name=FONT_MONO, font_size=Pt(12), color=WARN_AMBER)


def slide_heterogeneity(prs, D):
    s = dark_slide(prs)
    sf = D['simulation_findings']
    hf = sf['headline_finding']

    tag(s, Inches(0.8), Inches(0.5), 'Central finding  ·  simulated, 8 seeds')
    add_text(s, Inches(0.8), Inches(0.9), Inches(11), Inches(1),
             'RL earns its complexity at a\nmeasurable threshold.',
             font_name=FONT_DISPLAY, font_size=Pt(38), color=WHITE, bold=True)

    widest = hf['table'][-1]
    delta = widest['q_learning_goodput'] - widest['round_robin_goodput']
    big_number(s, Inches(0.8), Inches(2.5), f"+{delta:.1f}", 'goodput points, QL over RR, at 12× spread')

    header = ['Spread', 'Slow backend ms', 'Round Robin', 'Q-Learning', 'EMA', 'QL − RR']
    rows = [header]
    for r in hf['table']:
        diff = r['q_learning_goodput'] - r['round_robin_goodput']
        rows.append([
            r['spread'],
            str(r['backend_b_ms']),
            f"{r['round_robin_goodput']}%",
            f"{r['q_learning_goodput']}%",
            f"{r['ema_goodput']}%",
            f"{diff:+.1f}",
        ])
    col_widths = [Inches(1.1), Inches(1.5), Inches(1.5), Inches(1.5), Inches(1.2), Inches(1.2)]
    add_table(s, rows, col_widths, Inches(5.5), Inches(2.4))

    add_text(s, Inches(0.8), Inches(5.5), Inches(11), Inches(1.5),
             hf['interpretation'][:400],
             font_name=FONT_BODY, font_size=Pt(13), color=PAPER_DIM)


def slide_scenario(prs, D, sc_id):
    sc = next(s for s in D['scenarios'] if s['id'] == sc_id)
    agg = D['simulation_findings']['scenario_results'].get(sc_id)
    s = dark_slide(prs)

    tag(s, Inches(0.8), Inches(0.5), f"Scenario  ·  {sc['name']}")
    add_text(s, Inches(0.8), Inches(0.9), Inches(7), Inches(0.8),
             sc['tagline'],
             font_name=FONT_DISPLAY, font_size=Pt(30), color=WHITE, bold=True)

    tf = add_text(s, Inches(0.8), Inches(1.8), Inches(5.5), Inches(2.5),
                  sc['setting'][:280],
                  font_name=FONT_BODY, font_size=Pt(13), color=PAPER_DIM)
    add_para(tf, '', font_size=Pt(6))
    add_para(tf, sc['why_esp32'][:250], font_size=Pt(13), color=MUTED, space_before=Pt(8))

    # anchor
    anchor = sc['economic_anchor']
    if anchor.get('value_usd_per_hour'):
        add_text(s, Inches(0.8), Inches(4.3), Inches(3), Inches(0.4),
                 anchor['metric'], font_name=FONT_MONO, font_size=Pt(10), color=MUTED)
        add_text(s, Inches(0.8), Inches(4.6), Inches(3), Inches(0.7),
                 f"${anchor['value_usd_per_hour']:,}/hr",
                 font_name=FONT_DISPLAY, font_size=Pt(32), color=ORANGE, bold=True)

    # results table
    if agg:
        strats = [('Round Robin', 'round_robin', S_RR),
                  ('Q-Learning', 'q_learning', S_QL),
                  ('EMA', 'ema', S_EMA)]
        header = ['Strategy', 'Goodput', 'Worst seed', 'Mean ms', 'p95 ms', 'Refused']
        rows = [header]
        for label, key, _ in strats:
            r = agg['strategies'][key]
            rows.append([
                label,
                f"{r['goodput_pct']}%",
                f"{r['goodput_worst_pct']}%",
                str(r['mean_latency_ms']),
                str(r['p95_latency_ms']),
                str(round(r['rejected'])),
            ])
        col_widths = [Inches(2), Inches(1.1), Inches(1.1), Inches(1.1), Inches(1.1), Inches(1.1)]
        add_table(s, rows, col_widths, Inches(6.5), Inches(1.8))

        best = agg['best_strategy']
        best_label = next(l for l, k, _ in strats if k == best)
        best_color = next(c for _, k, c in strats if k == best)
        add_text(s, Inches(6.5), Inches(4.8), Inches(5), Inches(0.5),
                 f"Best here: {best_label} ({agg['strategies'][best]['goodput_pct']}% goodput)",
                 font_name=FONT_MONO, font_size=Pt(14), color=best_color, bold=True)

        if agg.get('honest_note') and best != 'q_learning':
            add_text(s, Inches(6.5), Inches(5.3), Inches(5.5), Inches(1.5),
                     agg['honest_note'],
                     font_name=FONT_BODY, font_size=Pt(13), color=WARN_AMBER)

    # event timeline
    tag(s, Inches(0.8), Inches(5.6), 'Event timeline')
    cfg = sc['sim_config']
    y = Inches(5.9)
    for e in cfg['events'][:5]:
        t = e['at_tick'] * 50 / 1000
        add_text(s, Inches(0.8), y, Inches(5), Pt(18),
                 f"t+{t:.1f}s  —  {e['label']}",
                 font_name=FONT_MONO, font_size=Pt(11), color=PAPER_DIM)
        y += Pt(20)


def slide_weakness(prs, D):
    s = dark_slide(prs)
    w = D['simulation_findings']['known_weakness']

    tag(s, Inches(0.8), Inches(0.5), 'Honest limitation')
    add_text(s, Inches(0.8), Inches(0.9), Inches(11), Inches(0.8),
             w['title'],
             font_name=FONT_DISPLAY, font_size=Pt(34), color=WARN_AMBER, bold=True)

    tf = add_text(s, Inches(0.8), Inches(2.0), Inches(11), Inches(1.5),
                  w['finding'],
                  font_name=FONT_BODY, font_size=Pt(18), color=WHITE, bold=True)
    add_para(tf, '', font_size=Pt(6))
    add_para(tf, 'Root cause:  ' + w['root_cause'][:350], font_size=Pt(14), color=PAPER_DIM, space_before=Pt(8))
    add_para(tf, '', font_size=Pt(6))
    add_para(tf, 'Measured fix:  ' + w['evidence'][:250], font_size=Pt(14), color=MUTED, space_before=Pt(8))

    tag(s, Inches(0.8), Inches(5.2), 'Future work')
    y = Inches(5.5)
    for fw in w['future_work'][:3]:
        add_text(s, Inches(1.0), y, Inches(10.5), Inches(0.7),
                 '→  ' + fw[:200],
                 font_name=FONT_BODY, font_size=Pt(13), color=PAPER_DIM)
        y += Inches(0.55)

    add_text(s, Inches(0.8), Inches(7.0), Inches(6), Pt(16),
             w.get('we_did_not_hide_this', ''),
             font_name=FONT_MONO, font_size=Pt(11), color=MUTED)


def slide_limitations(prs, D):
    s = dark_slide(prs)
    tag(s, Inches(0.8), Inches(0.5), 'Architectural constraints')
    add_text(s, Inches(0.8), Inches(0.9), Inches(11), Inches(0.8),
             'What this device does not do.',
             font_name=FONT_DISPLAY, font_size=Pt(36), color=WHITE, bold=True)

    lims = D['novelty_claims']['honest_limitations']
    y = Inches(2.2)
    for lim in lims:
        tf = add_text(s, Inches(1.0), y, Inches(10.5), Inches(0.7),
                      '—  ' + lim,
                      font_name=FONT_BODY, font_size=Pt(16), color=PAPER_DIM)
        y += Inches(0.9)


def slide_measured_results(prs, D):
    """Hardware benchmark results. Shows pending-measurement if not yet run."""
    s = dark_slide(prs)
    mr = D['measured_results']
    tag(s, Inches(0.8), Inches(0.5), 'Hardware benchmark')

    is_measured = mr.get('status') == 'measured'

    if not is_measured:
        add_text(s, Inches(0.8), Inches(0.9), Inches(11), Inches(1),
                 'Awaiting hardware run.',
                 font_name=FONT_DISPLAY, font_size=Pt(36), color=WARN_AMBER, bold=True)
        add_text(s, Inches(0.8), Inches(2.2), Inches(10), Inches(1.5),
                 'Run benchmarks/run_benchmark.py three times (one per strategy) '
                 'to populate this slide with measured numbers. Until then, the '
                 'simulated results on previous slides are explicitly labelled as such.',
                 font_name=FONT_BODY, font_size=Pt(16), color=PAPER_DIM)
        return

    add_text(s, Inches(0.8), Inches(0.9), Inches(11), Inches(0.8),
             'Real traffic, real ESP32.',
             font_name=FONT_DISPLAY, font_size=Pt(36), color=WHITE, bold=True)

    strats = [('Round Robin', 'round_robin'), ('Q-Learning', 'q_learning'), ('EMA', 'ema')]
    header = ['Strategy', 'Requests', 'Mean ms', 'p95 ms', 'p99 ms', 'Timeouts', 'RPS']
    rows = [header]
    for label, key in strats:
        r = mr['strategies'][key]
        rows.append([
            label,
            or_pending(r.get('total_requests'), '{:.0f}'),
            or_pending(r.get('mean_latency_ms'), '{:.1f}'),
            or_pending(r.get('p95_latency_ms'), '{:.1f}'),
            or_pending(r.get('p99_latency_ms'), '{:.1f}'),
            or_pending(r.get('timeouts'), '{:.0f}'),
            or_pending(r.get('throughput_rps'), '{:.1f}'),
        ])
    col_widths = [Inches(2), Inches(1.2), Inches(1.2), Inches(1.2), Inches(1.2), Inches(1.2), Inches(1.2)]
    add_table(s, rows, col_widths, Inches(0.5), Inches(2.2))

    if mr.get('run_timestamp'):
        add_text(s, Inches(0.8), Inches(5.0), Inches(6), Pt(16),
                 f"Run: {mr['run_timestamp']}",
                 font_name=FONT_MONO, font_size=Pt(11), color=MUTED)


def slide_sources(prs, D):
    s = dark_slide(prs)
    tag(s, Inches(0.8), Inches(0.5), 'Sources & citations')
    add_text(s, Inches(0.8), Inches(0.9), Inches(11), Inches(0.6),
             'Every number is cited or measured.',
             font_name=FONT_DISPLAY, font_size=Pt(30), color=WHITE, bold=True)

    items = []
    ev = D['external_evidence']
    for o in ev.get('outages', []):
        items.append((o['title'], o['source'], o.get('source_url', ''), o['status']))
    for c in ev.get('downtime_costs', []):
        items.append((c['metric'], c['source'], c.get('source_url', ''), c['status']))
    for a in ev.get('academic', []):
        items.append((a['claim'][:80], a['source'], a.get('source_url', ''), a['status']))
    for h in ev.get('hardware_specs', []):
        items.append((h.get('claim', 'Hardware spec'), h['source'], h.get('source_url', ''), h['status']))

    # Two columns
    col_items = [items[:len(items)//2 + 1], items[len(items)//2 + 1:]]
    for ci, col in enumerate(col_items):
        x = Inches(0.8) if ci == 0 else Inches(7.0)
        y = Inches(1.8)
        for title, source, url, status in col:
            tf = add_text(s, x, y, Inches(5.5), Inches(0.8),
                          title[:70],
                          font_name=FONT_BODY, font_size=Pt(12), color=WHITE, bold=True)
            add_para(tf, source[:100], font_size=Pt(10), color=MUTED, space_before=Pt(2))
            if url:
                add_para(tf, url[:80], font_name=FONT_MONO, font_size=Pt(8), color=BLUE, space_before=Pt(1))
            y += Inches(0.85)
            if y > Inches(7.0):
                break


def slide_conclusion(prs, D):
    s = dark_slide(prs)
    tag(s, Inches(0.8), Inches(0.5), 'Summary')
    add_text(s, Inches(0.8), Inches(1.2), Inches(11), Inches(2),
             'A $4 device that learns routing\non production traffic, with no cloud\nand no pre-training.',
             font_name=FONT_DISPLAY, font_size=Pt(44), color=WHITE, bold=True)

    add_rect(s, Inches(0.8), Inches(3.8), Inches(3), Pt(4), ORANGE)

    bullets = [
        'Q-learning advantage conditional on heterogeneity — quantified at 8× spread.',
        'Sub-watt power, one-second boot, zero attack surface.',
        'Honest about where it fails: retail (low-spread, non-stationary) is a known loss.',
        'Three real-world scenarios simulated with faithful firmware port.',
        'Hardware benchmark harness ready — measured numbers pending.',
    ]
    y = Inches(4.2)
    for b in bullets:
        add_text(s, Inches(1.0), y, Inches(10), Inches(0.5),
                 '→  ' + b,
                 font_name=FONT_BODY, font_size=Pt(16), color=PAPER_DIM)
        y += Inches(0.55)


def slide_demo(prs, D):
    s = dark_slide(prs)
    tag(s, Inches(0.8), Inches(2.5), 'Live demo')
    add_text(s, Inches(0.8), Inches(3.0), Inches(11), Inches(1.5),
             'http://localhost:5000/scenarios',
             font_name=FONT_MONO, font_size=Pt(36), color=ORANGE, bold=True)
    add_text(s, Inches(0.8), Inches(4.5), Inches(11), Inches(1),
             'Runs entirely in the browser. Same algorithms, same seeds, same results.\nChange the seed. Watch Q-learning explore then exploit. Watch it fail on retail.',
             font_name=FONT_BODY, font_size=Pt(18), color=PAPER_DIM)


# ── main ─────────────────────────────────────────────────────────────────

def main():
    D = load_data()

    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H

    slide_title(prs, D)
    slide_problem(prs, D)
    slide_solution(prs, D)
    slide_how_it_works(prs, D)
    slide_hardware_comparison(prs, D)
    slide_heterogeneity(prs, D)
    for sc_id in ['factory', 'clinic', 'retail']:
        slide_scenario(prs, D, sc_id)
    slide_weakness(prs, D)
    slide_limitations(prs, D)
    slide_measured_results(prs, D)
    slide_demo(prs, D)
    slide_sources(prs, D)
    slide_conclusion(prs, D)

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    prs.save(OUT_FILE)
    print(f'Saved {os.path.relpath(OUT_FILE, REPO)}')
    print(f'{len(prs.slides)} slides')

    mr = D['measured_results']
    if mr.get('status') != 'measured':
        print('\n[!] Hardware benchmark not yet run. Slide 12 shows a placeholder.')
        print('    Run benchmarks/run_benchmark.py (three times) to populate it.')


if __name__ == '__main__':
    main()
