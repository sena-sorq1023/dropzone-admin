// 順位表の取り込み（Liquipediaのソース／表の貼り付け）。ブラウザでもNodeでも動く純粋関数だけを置く。

/* ---------- ウィキ記法の読み取り ---------- */

// text の中から {{Name ...}} をすべて探す（入れ子OK）。names は小文字で比較。
export function findTemplates(text, names) {
  const want = names.map((n) => n.toLowerCase());
  const out = [];
  const re = /\{\{\s*([^|{}\n]+?)\s*(?=[|}\n])/g;
  let m;
  while ((m = re.exec(text))) {
    const nm = m[1].trim().toLowerCase().replace(/_/g, ' ');
    if (!want.includes(nm)) continue;
    const end = matchBraces(text, m.index);
    if (end < 0) continue;
    out.push({ name: m[1].trim(), start: m.index, end, body: text.slice(m.index + 2, end - 2) });
    re.lastIndex = end;
  }
  return out;
}

function matchBraces(text, i) {
  let depth = 0;
  while (i < text.length) {
    if (text.startsWith('{{', i)) { depth++; i += 2; continue; }
    if (text.startsWith('}}', i)) { depth--; i += 2; if (depth === 0) return i; continue; }
    i++;
  }
  return -1;
}

// テンプレートの中身を | で分割（入れ子の {{ }} [[ ]] の中は分割しない）
export function splitParams(body) {
  const parts = [];
  let depthC = 0, depthS = 0, cur = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{') { depthC++; cur += two; i++; continue; }
    if (two === '}}') { depthC--; cur += two; i++; continue; }
    if (two === '[[') { depthS++; cur += two; i++; continue; }
    if (two === ']]') { depthS--; cur += two; i++; continue; }
    if (body[i] === '|' && depthC === 0 && depthS === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  parts.push(cur);
  const name = parts.shift().trim();
  const pos = [], named = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    const brace = p.indexOf('{{');
    if (eq > 0 && (brace < 0 || eq < brace) && /^\s*[\w ]+\s*$/.test(p.slice(0, eq))) named[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
    else pos.push(p.trim());
  }
  return { name, pos, named };
}

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const cleanName = (s) => (s || '').replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/_/g, ' ').trim();

// 既定の配点（Liquipedia PUBG Mobile の雛形と同じ）
export const DEFAULT_POINTS = { place: [10, 6, 5, 4, 3, 2, 1, 1], kill: 1 };

// 直前の見出し（大見出し＝セクション と、いちばん近い見出し）
function headingBefore(text, idx) {
  const re = /^(={2,6})\s*(.+?)\s*\1\s*$/gm;
  let m; const stack = [];
  while ((m = re.exec(text)) && m.index < idx) {
    const lv = m[1].length, h = m[2].replace(/\{\{[^}]*\}\}/g, '').trim();
    while (stack.length && stack[stack.length - 1].lv >= lv) stack.pop();
    stack.push({ lv, h });
  }
  return { section: stack[0]?.h || '', path: stack.map((x) => x.h).join(' › ') };
}

// Liquipediaのソースから {{Match}}（バトロワ形式）をすべて読む
export function parseWikiMatches(raw) {
  const text = stripComments(raw);
  const blocks = [];
  for (const t of findTemplates(text, ['Match'])) {
    const { named } = splitParams(t.body);
    const oppKeys = Object.keys(named).filter((k) => /^opponent\d+$/.test(k)).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
    if (!oppKeys.length) continue;
    const place = [];
    for (let i = 1; i <= 64; i++) if (named['p' + i] !== undefined && named['p' + i] !== '') place[i - 1] = Number(named['p' + i]) || 0;
    const hasPts = place.length > 0;
    const killDefault = named.p_kill !== undefined && named.p_kill !== '' ? Number(named.p_kill) : DEFAULT_POINTS.kill;
    const killAt = (pl) => { const v = named[`p${pl}_kill`]; return v !== undefined && v !== '' ? Number(v) : killDefault; };
    const placeAt = (pl) => (hasPts ? place[pl - 1] || 0 : DEFAULT_POINTS.place[pl - 1] || 0);
    const maps = [];
    for (let i = 1; i <= 30; i++) {
      const v = named['map' + i];
      if (v === undefined) continue;
      const mt = findTemplates(v, ['Map'])[0];
      const mp = mt ? splitParams(mt.body).named : {};
      maps[i - 1] = cleanName(mp.map || '') || `MATCH ${i}`;
    }
    const teams = [];
    for (const k of oppKeys) {
      const ot = findTemplates(named[k], ['TeamOpponent', 'Opponent', 'Team', 'Literal'])[0];
      if (!ot) continue;
      const op = splitParams(ot.body);
      const team = cleanName(op.named.team || op.named['1'] || op.pos[0] || '');
      if (!team) continue;
      const games = [];
      for (const [key, val] of Object.entries(op.named)) {
        const mm = key.match(/^m(\d+)$/); if (!mm) continue;
        const ms = findTemplates(val, ['MS'])[0];
        if (!ms) continue;
        const sp = splitParams(ms.body).pos;
        const plRaw = (sp[0] || '').trim(), kills = Number((sp[1] || '').trim());
        if (!plRaw && !(sp[1] || '').trim()) continue;
        let pl = Number(plRaw), plEnd = pl;
        const rng = plRaw.match(/^(\d+)\s*-\s*(\d+)$/);
        if (rng) { pl = Number(rng[1]); plEnd = Number(rng[2]); }
        let ppts = 0;
        if (pl) { let s = 0; for (let x = pl; x <= plEnd; x++) s += placeAt(x); ppts = s / (plEnd - pl + 1); }
        games[Number(mm[1]) - 1] = { place: pl || null, kills: Number.isFinite(kills) ? kills : 0, placePts: ppts, killPts: (Number.isFinite(kills) ? kills : 0) * (pl ? killAt(pl) : killDefault) };
      }
      teams.push({ team, games });
    }
    if (!teams.length) continue;
    const gameCount = Math.max(maps.length, ...teams.map((t) => t.games.length));
    blocks.push({
      ...(({ section, path }) => ({ section, heading: path }))(headingBefore(text, t.start)), maps: Array.from({ length: gameCount }, (_, i) => maps[i] || `MATCH ${i + 1}`),
      teams, pointsFromPage: hasPts, killPts: killDefault, placePts: hasPts ? place : DEFAULT_POINTS.place,
    });
  }
  return blocks;
}

// 選んだ {{Match}} を合算して順位表にする
export function aggregateBlocks(blocks) {
  const by = new Map();
  for (const b of blocks) for (const t of b.teams) {
    const r = by.get(t.team) || { team: t.team, wwcd: 0, place_pts: 0, kill_pts: 0, kills: 0, games: 0 };
    for (const g of t.games) {
      if (!g) continue;
      r.games++;
      if (g.place === 1) r.wwcd++;
      r.place_pts += g.placePts; r.kill_pts += g.killPts; r.kills += g.kills;
    }
    by.set(t.team, r);
  }
  const rows = [...by.values()].map((r) => {
    const pp = Math.round(r.place_pts * 100) / 100, kp = Math.round(r.kill_pts * 100) / 100;
    return { team: r.team, wwcd: r.wwcd, place_pts: pp, kill_pts: kp, total: Math.round((pp + kp) * 100) / 100, games: r.games };
  });
  rows.sort((a, b) => b.total - a.total || b.wwcd - a.wwcd || b.place_pts - a.place_pts || b.kill_pts - a.kill_pts);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// 賞金表（{{Slot|place=..}}）から最終順位だけ読む（試合結果が載っていない古いページ用）
export function parsePrizePool(raw) {
  const text = stripComments(raw);
  const rows = [];
  for (const s of findTemplates(text, ['Slot'])) {
    const { named, pos } = splitParams(s.body);
    const pl = String(named.place || '').match(/^(\d+)/);
    if (!pl) continue;
    for (const p of pos) {
      const ot = findTemplates(p, ['TeamOpponent', 'Opponent'])[0];
      if (!ot) continue;
      const op = splitParams(ot.body);
      const team = cleanName(op.named.team || op.named['1'] || op.pos[0] || '');
      if (team && !/^tbd$/i.test(team)) rows.push({ team, rank: Number(pl[1]), wwcd: 0, place_pts: 0, kill_pts: 0, total: 0 });
    }
  }
  return rows;
}

/* ---------- 表の貼り付け（Webページやスプレッドシートからコピー） ---------- */

export const COLS = [['', '（使わない）'], ['rank', '順位'], ['team', 'チーム'], ['wwcd', 'WWCD'], ['place_pts', '順位pt'], ['kill_pts', 'キルpt'], ['total', '合計']];

const isNum = (s) => /^-?\d+(\.\d+)?$/.test(String(s).replace(/[,\s]/g, '').replace(/(st|nd|rd|th|位)$/i, ''));
export const toNum = (s) => Number(String(s ?? '').replace(/[,\s]/g, '').replace(/(st|nd|rd|th|位)$/i, '')) || 0;

export function parsePastedTable(raw) {
  let lines = raw.replace(/\r/g, '').split('\n').map((l) => l.replace(/ /g, ' ')).filter((l) => l.trim());
  let cells = lines.map((l) => (l.includes('\t') ? l.split('\t') : l.split(/\s{2,}|,/)).map((c) => c.trim()));
  // 空のセル（ロゴ画像など）だけの列を落とす
  const width = Math.max(...cells.map((r) => r.length));
  cells = cells.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  const keep = Array.from({ length: width }, (_, i) => cells.some((r) => r[i] !== ''));
  cells = cells.map((r) => r.filter((_, i) => keep[i]));
  if (!cells.length || cells[0].length < 2) return null;
  const n = cells[0].length;
  const numericRatio = (r) => r.filter(isNum).length / r.length;
  let header = null;
  if (cells.length > 1 && numericRatio(cells[0]) < numericRatio(cells[1])) header = cells.shift();
  const guess = Array(n).fill('');
  if (header) {
    header.forEach((h, i) => {
      const s = h.toLowerCase();
      if (/wwcd|chicken|ドン勝|1位回数/.test(s)) guess[i] = 'wwcd';
      else if (/kill|キル|elim|撃破/.test(s)) guess[i] = 'kill_pts';
      else if (/total|合計|総合|^pts$|^points$|ポイント$/.test(s)) guess[i] = 'total';
      else if (/plac|順位pt|順位ポイント|rank ?pts|^pp$/.test(s)) guess[i] = 'place_pts';
      else if (/^#$|^rank$|^順位$|^pos|^no\.?$/.test(s)) guess[i] = 'rank';
      else if (/team|チーム|name/.test(s)) guess[i] = 'team';
    });
  }
  if (!guess.includes('team')) {
    const ti = cells[0].findIndex((c, i) => !guess[i] && !isNum(c) && cells.filter((r) => !isNum(r[i])).length >= cells.length * 0.7);
    if (ti >= 0) guess[ti] = 'team';
  }
  const numIdx = [...Array(n).keys()].filter((i) => !guess[i] && cells.filter((r) => isNum(r[i]) || r[i] === '' || r[i] === '-').length >= cells.length * 0.8);
  const ti = guess.indexOf('team');
  if (!guess.includes('rank')) { const r0 = numIdx.find((i) => i < ti); if (r0 !== undefined) { guess[r0] = 'rank'; numIdx.splice(numIdx.indexOf(r0), 1); } }
  const after = numIdx.filter((i) => i > ti);
  const want = ['total', 'kill_pts', 'place_pts', 'wwcd'].filter((k) => !guess.includes(k));
  if (after.length >= 1 && want.includes('total')) {
    const order = after.length >= 4 ? ['wwcd', 'place_pts', 'kill_pts', 'total'] : after.length === 3 ? ['place_pts', 'kill_pts', 'total'] : after.length === 2 ? ['kill_pts', 'total'] : ['total'];
    const tail = after.slice(-order.length);
    tail.forEach((i, j) => { if (want.includes(order[j])) guess[i] = order[j]; });
  }
  return { header, rows: cells, cols: guess };
}

export function tableToRows(t, cols) {
  const rows = [];
  for (const r of t.rows) {
    const o = { rank: null, team: '', wwcd: 0, place_pts: 0, kill_pts: 0, total: 0 };
    cols.forEach((k, i) => { if (!k) return; if (k === 'team') o.team = r[i] || ''; else o[k] = toNum(r[i]); });
    o.team = o.team.replace(/\s+/g, ' ').trim();
    if (!o.team) continue;
    if (!cols.includes('total')) o.total = o.place_pts + o.kill_pts;
    rows.push(o);
  }
  if (!cols.includes('rank')) {
    rows.sort((a, b) => b.total - a.total);
    rows.forEach((r, i) => { r.rank = i + 1; });
  }
  return rows;
}

/* ---------- チーム名の照合 ---------- */

export const normTeam = (s) => String(s || '').normalize('NFKC').toLowerCase()
  .replace(/\s*\((?:[a-z ]*team|japanese.*|jp|japan)\)\s*$/i, '')
  .replace(/^(team|チーム)\s+/, '').replace(/\s+(esports|e-sports|gaming|team)$/, '')
  .replace(/[^\p{L}\p{N}]/gu, '');

export function matchTeams(rows, teams) {
  const idx = new Map();
  const add = (key, t) => { const k = normTeam(key); if (k && !idx.has(k)) idx.set(k, t); };
  for (const t of teams) { add(t.name, t); add(t.tag, t); add(t.slug, t); }
  return rows.map((r) => {
    const t = idx.get(normTeam(r.team));
    return { ...r, team_id: t ? t.id : null, team_label: t ? t.name : null };
  });
}

// LiquipediaのURLから「ソースを表示」用URLを作る
export function liquipediaRawUrl(u) {
  try {
    const url = new URL(u.trim());
    if (!/liquipedia\.net$/.test(url.hostname)) return null;
    url.search = ''; url.hash = '';
    url.searchParams.set('action', 'raw');
    return url.toString();
  } catch { return null; }
}
