// Turns the survey Sheet (as sent by the Apps Script feed) into the tables the dashboard draws from.
// Input: {responses:[[header...],[row...],...], members:[[header...],[name,tea number],...]}
// Output: {D0, AREAS, PAY, SUPP, DQ, BANDPAY}
// The rules here match the earlier SQL views (03_views.sql) so the numbers stay the same.
(function (root) {
  'use strict';

  const MIN_CONTRACT = 187; // Texas Education Code 21.401 minimum contract days
  const LEVEL = { MS: 'Middle School', HS: 'High School', Elementary: 'Elementary' };
  const LEVEL_SORT = { Elementary: 1, 'Middle School': 2, 'High School': 3 };
  const ROLE_SORT = { 'Art Teacher': 1, Head: 1, 'Elementary Teacher': 1, Assistant: 2, Associate: 3, Teacher: 4, 'Lead Teacher': 6 };
  const AB = { Elementary: 'ES', 'Middle School': 'MS', 'High School': 'HS' };

  // Column keys, built from the header text the same way the SQL column names were.
  function snake(h) {
    let s = String(h).toLowerCase().replace(/\//g, ' ').replace(/\?/g, '');
    s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    s = s.replace('texas_education_agency', 'tea').replace('extra_contract_days', 'days')
      .replace('extended_calendar_professional', 'ext').replace('administrator', 'admin');
    if (/^[0-9]/.test(s)) s = 'c_' + s;
    return s;
  }
  function keys(headers) {
    const seen = {};
    return headers.map(h => {
      let c = snake(h);
      if (seen[c]) { seen[c]++; c = c + '_' + seen[c]; } else seen[c] = 1;
      return c;
    });
  }

  // Which level, content area and role a position question belongs to.
  function parsePosition(h) {
    const m = /^(MS|HS|Elementary) (.*)$/.exec(String(h).trim());
    if (!m) return null;
    const level = LEVEL[m[1]];
    let rest = m[2], metric = 'stipend', role = 'Director';
    if (rest.endsWith(' Extra Contract Days')) { metric = 'extra_days'; rest = rest.slice(0, -' Extra Contract Days'.length); }
    else if (rest.endsWith(' Lead Stipend')) { metric = 'lead_stipend'; rest = rest.slice(0, -' Lead Stipend'.length); }
    else if (rest.endsWith(' Stipend')) rest = rest.slice(0, -' Stipend'.length);
    rest = rest.replace(' Coach', '');
    const r = /^(Head|Assistant|Associate) (.*)$/.exec(rest);
    if (r) { role = r[1]; rest = r[2]; }
    if (rest.includes('Mariachi')) { role = (rest.includes('Assistant') || role === 'Assistant') ? 'Assistant' : 'Head'; rest = 'Mariachi'; }
    if (rest === 'Music Theory') role = 'Teacher';
    if (rest === 'Music' && level === 'Elementary') rest = 'Elementary Music';
    if (rest === 'Colorguard') role = 'Head';
    if (['Band', 'Choir', 'Orchestra', 'Theatre', 'Cheer', 'Technical Theatre'].includes(rest) && role === 'Director' && metric !== 'lead_stipend') role = 'Head';
    if (role === 'Director' && ['Dance', 'Modern Band', 'Technical Theatre'].includes(rest)) role = 'Head';
    if (level === 'Elementary') role = 'Elementary Teacher';
    if (metric === 'lead_stipend') role = 'Lead Teacher';
    if (rest === 'Art' && level !== 'Elementary' && metric !== 'lead_stipend') role = 'Art Teacher';
    return { level, level_sort: LEVEL_SORT[level], content_area: rest, role, role_sort: ROLE_SORT[role], metric };
  }

  // Numbers as typed: drop everything but digits and the decimal point.
  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).replace(/[^0-9.]/g, '');
    if (!s || !/^\d*\.?\d*$/.test(s) || s === '.') return null;
    return parseFloat(s);
  }
  const txt = v => (v === null || v === undefined) ? '' : String(v).trim();
  const teaId = v => { const s = String(v ?? '').replace(/[^0-9]/g, ''); return s ? s.padStart(6, '0') : ''; };
  const shortName = n => n.replace('Consolidated Independent School District', 'CISD').replace('Independent School District', 'ISD');
  function parseTime(v) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(txt(v));
    if (m) return Date.UTC(+m[3], m[1] - 1, +m[2], +m[4], +m[5], +m[6]);
    const t = Date.parse(txt(v));
    return isNaN(t) ? -Infinity : t;
  }
  function median(a) {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y), k = (s.length - 1) / 2, lo = Math.floor(k), hi = Math.ceil(k);
    return s[lo] + (s[hi] - s[lo]) * (k - lo);
  }
  function area(title) {
    const t = title.toLowerCase();
    if (/cheer/.test(t)) return 'Cheer';
    if (/drill|dance/.test(t)) return 'Dance';
    if (/color ?guard|winter ?guard/.test(t)) return 'Colorguard';
    if (/jazz|band/.test(t)) return 'Band';
    if (/technical|tech theat/.test(t)) return 'Technical Theatre';
    if (/one act|uil oap|auditorium|performing arts center|pac\b|theat/.test(t)) return 'Theatre';
    if (/mariachi/.test(t)) return 'Mariachi';
    if (/choir|vocal|show choir/.test(t)) return 'Choir';
    if (/orchestra|string/.test(t)) return 'Orchestra';
    if (/\bart\b|visual/.test(t)) return 'Art';
    if (/theory/.test(t)) return 'Music Theory';
    if (/music/.test(t)) return 'Elementary Music';
    return 'Other / district-wide';
  }
  const cleanAmount = x => x === null ? '' : String(Math.round(x * 100) / 100);

  function buildData(raw) {
    const rows = (raw.responses || []).filter(r => r.some(c => txt(c) !== ''));
    const headers = rows.shift().map(txt);
    const K = keys(headers);
    const col = {};
    K.forEach((k, i) => { col[k] = i; });
    const get = (r, k) => col[k] === undefined ? '' : r[col[k]];

    // Member list: TFAA name by TEA number
    const memberName = {};
    (raw.members || []).slice(1).forEach(r => {
      const id = teaId(r[1]), n = txt(r[0]);
      if (id && n && !(id in memberName)) memberName[id] = n;
    });

    // One row per district: the latest submission wins
    const latest = {};
    rows.forEach(r => {
      const id = teaId(get(r, 'tea_district_number'));
      if (!id) return;
      const t = parseTime(get(r, 'timestamp'));
      if (!latest[id] || t > latest[id].t) latest[id] = { t, r };
    });

    const districts = Object.keys(latest).map(id => {
      const r = latest[id].r, g = k => num(get(r, k));
      const fullName = memberName[id] || txt(get(r, 'school_district_name'));
      const enrollment = g('pk_12_district_enrollment_size'), campuses = g('total_number_of_campuses');
      const staffReported = g('total_number_of_central_staff');
      const k8 = g('number_of_k_8_campuses'), c612 = g('number_of_6_12_campuses');
      const lab = v => v === null ? null : String(Math.trunc(v)).padStart(2, '0');
      let mix;
      if (!(k8 > 0) && !(c612 > 0)) mix = 'Traditional EL / MS / HS only';
      else if (k8 > 0 && c612 > 0) mix = 'K-8 and 6-12 campuses';
      else mix = k8 > 0 ? 'Has K-8 campuses' : 'Has 6-12 campuses';
      const lt = txt(get(r, 'lead_teacher_stipend_type'));
      let titles = 0;
      for (let s = 1; s <= 10; s++) if (txt(get(r, 'stipend_title_' + s))) titles++;
      return {
        id, r, fullName, name: shortName(fullName), isMember: id in memberName, staffReported,
        row: [
          shortName(fullName), enrollment, campuses, g('total_number_of_hs_campuses'),
          staffReported !== null && staffReported > 10 ? null : staffReported,
          enrollment !== null && campuses ? Math.round(enrollment / campuses) : null,
          titles,
          txt(get(r, 'regional_designation')) || 'Not given',
          lab(g('tmea_region_number')), lab(g('tea_region_number')), mix,
          g('executive_directors_or_above') > 0 ? 'Executive director or above' : g('directors') > 0 ? 'Director' : g('coordinators') > 0 ? 'Coordinator' : 'No central fine arts leader listed',
          txt(get(r, 'supplemental_stipends')).toLowerCase() === 'yes' ? 'Pays supplemental stipends' : 'No supplemental stipends',
          lt.startsWith('Scenario 1') ? 'Lead stipend varies by area' : lt.startsWith('Scenario 2') ? 'One lead stipend for all areas' : 'No lead stipend reported'
        ]
      };
    });
    districts.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);
    districts.forEach((d, i) => { d.i = i; });
    const D0 = districts.map(d => d.row);

    // Position questions, one value per district
    const cat = [];
    headers.forEach((h, i) => { const p = parsePosition(h); if (p) cat.push(Object.assign({ column_name: K[i], question: h }, p)); });
    const facts = [];
    districts.forEach(d => {
      const typed = cat.map(p => { const rawv = txt(get(d.r, p.column_name)); return { d, p, raw: rawv, rep: num(rawv) }; });
      const programs = new Set(typed.filter(t => t.p.metric !== 'lead_stipend' && t.rep > 0).map(t => t.p.level + '|' + t.p.content_area));
      const uniform = txt(get(d.r, 'lead_teacher_stipend_type')).startsWith('Scenario 2') ? num(get(d.r, 'lead_teacher_stipend_amount')) : null;
      typed.forEach(t => {
        t.value = t.rep; t.source = 'Reported';
        if (t.p.metric === 'lead_stipend' && !(t.rep > 0) && uniform > 0 && (t.p.level === 'Elementary' || programs.has(t.p.level + '|' + t.p.content_area))) {
          t.value = uniform; t.source = 'Uniform lead amount';
        } else if (t.p.metric === 'extra_days' && t.rep > 60) {
          t.value = Math.max(t.rep - MIN_CONTRACT, 0); t.source = 'Converted';
        }
        facts.push(t);
      });
    });
    const byCol = {};
    facts.forEach(f => { (byCol[f.p.column_name] = byCol[f.p.column_name] || []).push(f); });
    Object.values(byCol).forEach(list => {
      const offered = list.filter(f => f.value > 0).map(f => f.value), n = offered.length, md = median(offered);
      list.forEach(f => {
        f.outlier = null;
        if (!(f.value > 0)) return;
        if (f.p.metric === 'extra_days') { if (f.value > 60) f.outlier = 'Over 60 extra days even after taking out the 187-day contract: check the entry'; }
        else if (n >= 5 && f.value < 0.25 * md) f.outlier = 'Under 25% of the statewide median';
        else if (n >= 5 && f.value > 3 * md) f.outlier = 'Over 3x the statewide median';
        f.include = f.outlier === null;
      });
    });

    // Extended calendar and administrator pay ranges (the sheet swaps the labels after slot 1)
    const payRows = [];
    districts.forEach(d => {
      const slots = [['Extended calendar / professional', 'ext', 1]];
      for (let s = 2; s <= 10; s++) slots.push(['Extended calendar / professional', 'admin', s]);
      slots.push(['Administrator', 'admin', 1]);
      for (let s = 2; s <= 10; s++) slots.push(['Administrator', 'ext', s]);
      slots.forEach(([ct, pre, s]) => {
        const title = txt(get(d.r, `${pre}_pay_position_${s}`));
        if (!title) return;
        const lo = num(get(d.r, `${pre}_pay_range_position_${s}_low`)), hi = num(get(d.r, `${pre}_pay_range_position_${s}_high`));
        const top = Math.max(lo || 0, hi || 0);
        payRows.push({ d, ct, title, area: area(title), lo, hi, unit: top === 0 ? 'Not given' : top < 2000 ? 'Daily rate' : 'Annual salary' });
      });
    });
    const PAY = [];
    payRows.forEach(p => {
      const m = /^(ES|MS|HS) (Head|Assistant|Associate)/.exec(p.title);
      p.lv = m && m[1]; p.rk = m && m[2];
      const v = [p.lo, p.hi].filter(x => x > 0);
      if (!m || !v.length) return;
      PAY.push([p.d.i, p.area, m[1], m[2], p.ct === 'Administrator' ? 8 : 4, Math.min(...v), Math.max(...v), p.unit === 'Annual salary' ? 'A' : 'D']);
    });

    // Content-area pages
    const AREAS = {};
    const RO = { Head: 0, Associate: 1, Assistant: 2, Teacher: 3 };
    const stip = facts.filter(f => f.p.metric === 'stipend'), days = facts.filter(f => f.p.metric === 'extra_days');
    [...new Set(stip.map(f => f.p.content_area))].sort().forEach(A => {
      const colsIn = [...new Set(stip.filter(f => f.p.content_area === A).map(f => f.p.column_name))].sort();
      let pl = colsIn.map(c => {
        const list = byCol[c], p = list[0].p, rk = ({ Head: 'Head', Assistant: 'Assistant', Associate: 'Associate' })[p.role] || 'Teacher';
        return {
          c, lv: AB[p.level], ls: p.level_sort, rk, role: p.role,
          lab: rk === 'Teacher' ? `${AB[p.level]} ${A} Teacher` : `${AB[p.level]} ${rk} ${A}`,
          title: rk === 'Teacher' ? `${A} Teacher` : `${rk} ${A} Director`,
          n: list.filter(f => f.include).length, list
        };
      }).filter(p => p.n > 0 && p.role !== 'Lead Teacher');
      pl = pl.map((p, k) => [p, k]).sort((a, b) => (a[0].ls - b[0].ls) || (RO[a[0].rk] - RO[b[0].rk]) || (a[1] - b[1])).map(x => x[0]);
      if (!pl.length) return;
      const v = D0.map(() => pl.map(() => null)), m = D0.map(() => pl.map(() => 0)), x = D0.map(() => pl.map(() => null));
      pl.forEach((p, j) => {
        p.list.forEach(f => {
          if (f.include) v[f.d.i][j] = f.value;
          if (f.value > 0) m[f.d.i][j] |= 1;
        });
        const dayRole = p.rk !== 'Teacher' ? p.rk : (A === 'Art' && p.lv !== 'ES') ? 'Art Teacher' : A === 'Music Theory' ? 'Teacher' : 'Elementary Teacher';
        days.filter(f => f.p.content_area === A && AB[f.p.level] === p.lv && f.p.role === dayRole && f.value > 0).forEach(f => {
          m[f.d.i][j] |= 2;
          if (!f.outlier) x[f.d.i][j] = f.value;
        });
        payRows.filter(q => q.area === A && q.lv === p.lv && q.rk === p.rk).forEach(q => { m[q.d.i][j] |= q.ct.startsWith('Extended') ? 4 : 8; });
      });
      AREAS[A] = { pos: pl.map(({ c, lv, ls, rk, lab, title, n }) => ({ c, lv, ls, rk, lab, title, n })), v, m, x };
    });

    // Free-text supplemental stipends
    const sup = [];
    districts.forEach(d => {
      for (let s = 1; s <= 10; s++) {
        const title = txt(get(d.r, 'stipend_title_' + s));
        if (title) sup.push({ d, title, area: area(title), amount: num(get(d.r, 'stipend_amount_' + s)) });
      }
    });
    const byTitle = {};
    sup.forEach(s => { (byTitle[s.title.toLowerCase()] = byTitle[s.title.toLowerCase()] || []).push(s); });
    Object.values(byTitle).forEach(list => {
      const a = list.filter(s => s.amount > 0).map(s => s.amount), md = median(a);
      list.forEach(s => {
        s.outlier = !(s.amount > 0) ? 'Zero or blank amount'
          : a.length >= 5 && s.amount < 0.25 * md ? 'Under 25% of the median for this title'
          : a.length >= 5 && s.amount > 3 * md ? 'Over 3x the median for this title' : null;
      });
    });
    const SUPP = sup.filter(s => !s.outlier).map(s => [s.d.i, s.area, s.title, s.amount]);

    // Entries held out of the statistics, for the Data checks tab
    const dq = [];
    facts.forEach(f => {
      if (f.outlier) dq.push([f.d, 'Position amount', f.p.question, f.raw, f.outlier]);
      if (f.source === 'Converted') dq.push([f.d, 'Position amount', f.p.question, f.raw, `Entered as ${f.raw} total contract days. Counted as ${Math.trunc(f.value)} extra days (the entry minus the ${MIN_CONTRACT}-day minimum contract)`]);
    });
    sup.forEach(s => { if (s.outlier) dq.push([s.d, 'Supplemental stipend', s.title, cleanAmount(s.amount), s.outlier]); });
    districts.forEach(d => {
      if (d.staffReported > 10) dq.push([d, 'District', 'Central staff', cleanAmount(d.staffReported), 'More than 10 central fine arts staff: left out of the staff slider and ratios, check the entry']);
      if (!d.isMember) dq.push([d, 'District', 'Membership', '', 'Responded but not on the Member Districts tab']);
    });
    dq.sort((a, b) => (a[0].fullName < b[0].fullName ? -1 : a[0].fullName > b[0].fullName ? 1 : 0) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
    const DQ = dq.map(([d, ...rest]) => [d.i, ...rest]);

    // How HS head band directors are paid (kept for reference)
    const band = AREAS.Band, hb = band ? band.pos.findIndex(p => p.lv === 'HS' && p.rk === 'Head') : -1;
    const BANDPAY = D0.map((_, i) => hb < 0 ? 'None reported' : band.m[i][hb] & 1 ? 'Stipend' : band.m[i][hb] & 12 ? 'Salaried contract' : 'None reported');

    return { D0, AREAS, PAY, SUPP, DQ, BANDPAY };
  }

  const api = { buildData, parsePosition, keys };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TFAA = api;
})(this);
