// DROPZONE 編集サイト（外部ライブラリなし）
const C = window.DZ_CONFIG;
const $app = document.getElementById('app');

/* =====================================================================
   Supabase との通信（認証・データ・画像）
   ===================================================================== */
const SKEY = 'dz_session_v1';
const Auth = {
  session: null,
  load() { try { this.session = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch { this.session = null; } },
  save(s) {
    if (s && s.access_token) {
      s.expires_at = s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600);
      this.session = s;
      try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch {}
    } else {
      this.session = null;
      try { localStorage.removeItem(SKEY); } catch {}
    }
  },
  async call(path, body, { method = 'POST', token } = {}) {
    const res = await fetch(C.supabaseUrl + '/auth/v1/' + path, {
      method,
      headers: { apikey: C.supabaseKey, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    const data = txt ? JSON.parse(txt) : {};
    if (!res.ok) throw new Error(authMsg(data));
    return data;
  },
  async signIn(email, password) { this.save(await this.call('token?grant_type=password', { email, password })); },
  async refresh() {
    if (!this.session?.refresh_token) throw new Error('ログインが切れました');
    try { this.save(await this.call('token?grant_type=refresh_token', { refresh_token: this.session.refresh_token })); }
    catch (e) { this.save(null); throw e; }
  },
  async token() {
    if (!this.session) return null;
    if (this.session.expires_at - 60 < Date.now() / 1000) await this.refresh();
    return this.session.access_token;
  },
  async signOut() {
    try { const t = await this.token(); if (t) await this.call('logout', null, { token: t }); } catch {}
    this.save(null);
  },
  recover(email) { return this.call('recover?redirect_to=' + encodeURIComponent(C.adminUrl + '/'), { email }); },
  async updatePassword(password) { return this.call('user', { password }, { method: 'PUT', token: await this.token() }); },
  uid() {
    try { return JSON.parse(atob(this.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch { return null; }
  },
};

function authMsg(d) {
  const m = d.error_description || d.msg || d.message || d.error || '';
  if (/Invalid login credentials/i.test(m)) return 'メールアドレスまたはパスワードが違います';
  if (/Email not confirmed/i.test(m)) return 'メールアドレスの確認が済んでいません';
  if (/Password should be at least/i.test(m)) return 'パスワードは6文字以上にしてください';
  if (/same.*password|different from the old/i.test(m)) return '今と同じパスワードは使えません';
  if (/rate limit/i.test(m)) return 'しばらく時間をおいてから試してください';
  return m || '通信エラーが起きました';
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: C.supabaseKey, 'Content-Type': 'application/json' };
  const t = await Auth.token().catch(() => null);
  if (t) headers.Authorization = 'Bearer ' + t;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(C.supabaseUrl + '/rest/v1/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  const data = txt ? JSON.parse(txt) : null;
  if (!res.ok) {
    if (res.status === 401 && t) { Auth.save(null); location.hash = '#/login'; }
    throw new Error(dbMsg(data));
  }
  return data;
}
const db = {
  select: (table, q = 'select=*') => rest(table + '?' + q),
  one: async (table, id) => (await rest(table + '?select=*&id=eq.' + id))[0] || null,
  rpc: (fn, args) => rest('rpc/' + fn, { method: 'POST', body: args }),
};
function dbMsg(d) {
  const m = (d && (d.message || d.msg || d.error)) || '';
  if (/duplicate key.*slug/i.test(m)) return 'このURL名（スラッグ）はすでに使われています';
  if (/violates check constraint.*slug/i.test(m)) return 'URL名は半角英小文字・数字・ハイフンで入力してください';
  if (/violates foreign key/i.test(m)) return '関連するデータがまだ公開されていません（先に元のデータを承認してください）';
  if (/admin only/i.test(m)) return '管理者だけができる操作です';
  if (/not allowed/i.test(m)) return 'この操作の権限がありません';
  if (/already (approved|rejected|withdrawn)/i.test(m)) return 'このリクエストはすでに処理されています';
  if (/target not found/i.test(m)) return '対象のデータが見つかりません（削除された可能性があります）';
  return m || '通信エラーが起きました';
}

async function uploadImage(file, folder) {
  const blob = await shrinkImage(file, 1600);
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
  const path = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const res = await fetch(`${C.supabaseUrl}/storage/v1/object/media/${path}`, {
    method: 'POST',
    headers: { apikey: C.supabaseKey, Authorization: 'Bearer ' + (await Auth.token()), 'Content-Type': blob.type, 'x-upsert': 'false', 'cache-control': '31536000' },
    body: blob,
  });
  if (!res.ok) { const t = await res.text(); throw new Error('画像のアップロードに失敗しました ' + t.slice(0, 120)); }
  return `${C.supabaseUrl}/storage/v1/object/public/media/${path}`;
}
function shrinkImage(file, max) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('画像ファイルを選んでください'));
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') return resolve(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を読み込めませんでした'))), 'image/webp', 0.86);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = URL.createObjectURL(file);
  });
}

/* =====================================================================
   小物
   ===================================================================== */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (v) => (v ? String(v).slice(0, 10).replace(/-/g, '.') : '');
const fmtDT = (v) => { if (!v) return ''; const d = new Date(v); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const slugify = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const rand = () => Math.random().toString(36).slice(2, 6);
function toast(msg, ng = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (ng ? ' ng' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = ''), ng ? 6000 : 3000);
}
const STATUS_JA = { pending: '承認待ち', approved: '承認済み', rejected: '差し戻し', withdrawn: '取り下げ' };
const ACTION_JA = { create: '新規', update: '編集', delete: '削除', batch: 'まとめて' };

/* 名前の表示用キャッシュ */
const cache = {
  data: {},
  async get(table) {
    if (!this.data[table]) {
      const q = {
        teams: 'select=id,name,tag,slug,logo_url&order=name',
        players: 'select=id,ign,full_ign,slug,team_id&order=ign',
        tournaments: 'select=id,name,short_name,slug,start_date&order=start_date.desc.nullslast',
        tournament_stages: 'select=id,name,tournament_id,sort_order&order=sort_order',
      }[table];
      this.data[table] = await db.select(table, q);
    }
    return this.data[table];
  },
  clear() { this.data = {}; },
  name(table, id) {
    if (!id) return '';
    const r = (this.data[table] || []).find((x) => x.id === id);
    if (!r) return '（不明）';
    return table === 'players' ? r.ign : r.name;
  },
};

/* =====================================================================
   データの種類と入力項目
   ===================================================================== */
const LINK_KEYS = [['x', 'X'], ['youtube', 'YouTube'], ['twitch', 'Twitch'], ['tiktok', 'TikTok'], ['website', 'Webサイト']];
const ENT = {
  articles: {
    label: '記事', icon: 'NEWS', titleOf: (r) => r.title, order: 'published_at.desc',
    listCols: [['published_at', '公開日', (r) => fmtDate(r.published_at)], ['title', '見出し'], ['category', 'カテゴリ', (r) => CAT[r.category] || r.category], ['author_name', '記者']],
    fields: [
      { k: 'title', l: '見出し', t: 'text', req: true, wide: true },
      { k: 'slug', l: 'URL名（スラッグ）', t: 'slug', req: true, hint: '記事のURLになります。半角英小文字・数字・ハイフン', from: 'title', prefix: 'news' },
      { k: 'published_at', l: '公開日時', t: 'datetime', req: true },
      { k: 'category', l: 'カテゴリ', t: 'select', opts: [['news', 'ニュース'], ['tournament', '大会'], ['result', '結果'], ['transfer', '移籍'], ['world', '世界']] },
      { k: 'scope', l: '地域', t: 'select', opts: [['japan', '日本'], ['world', '世界']] },
      { k: 'author_name', l: '記者名', t: 'text', defMe: true },
      { k: 'featured', l: 'トップに大きく出す', t: 'bool' },
      { k: 'lead', l: 'リード文', t: 'textarea', wide: true, hint: '見出しの下に出る2〜3行の要約' },
      { k: 'body', l: '本文', t: 'markdown', wide: true },
      { k: 'cover_url', l: 'カバー画像', t: 'image', folder: 'articles', wide: true },
      { k: 'tournament_id', l: '関連する大会', t: 'ref', ref: 'tournaments' },
      { k: 'team_ids', l: '関連するチーム', t: 'refs', ref: 'teams' },
      { k: 'player_ids', l: '関連する選手', t: 'refs', ref: 'players' },
    ],
  },
  tournaments: {
    label: '大会', icon: 'TOURNAMENTS', titleOf: (r) => r.name, order: 'start_date.desc.nullslast',
    listCols: [['start_date', '期間', (r) => fmtDate(r.start_date) + (r.end_date ? ' — ' + fmtDate(r.end_date) : '')], ['name', '大会名'], ['status', '状態', (r) => TSTATUS[r.status]], ['region', '地域']],
    fields: [
      { k: 'name', l: '大会名', t: 'text', req: true, wide: true },
      { k: 'short_name', l: '短い名前', t: 'text', hint: '一覧や表で使う略称（例：NEW GATE G1）' },
      { k: 'slug', l: 'URL名（スラッグ）', t: 'slug', req: true, from: 'name', prefix: 'tournament' },
      { k: 'series', l: 'シリーズ', t: 'text', hint: '例：CRUX SUPER LEAGUE' },
      { k: 'tier', l: 'Tier', t: 'text' },
      { k: 'status', l: '状態', t: 'select', opts: [['upcoming', '開催予定'], ['ongoing', '開催中'], ['completed', '終了']] },
      { k: 'scope', l: '国内／世界', t: 'select', opts: [['japan', '国内'], ['world', '世界']] },
      { k: 'region', l: '地域', t: 'text', req: true, def: '日本' },
      { k: 'format', l: '形式', t: 'text', hint: 'オンライン／オフライン' },
      { k: 'start_date', l: '開始日', t: 'date' },
      { k: 'end_date', l: '終了日', t: 'date' },
      { k: 'team_count', l: 'チーム数', t: 'text', hint: '例：32（INVITE 16・OPEN 16）' },
      { k: 'prize', l: '賞金', t: 'text' },
      { k: 'organizer', l: '主催', t: 'text' },
      { k: 'operator', l: '運営', t: 'text' },
      { k: 'logo_url', l: 'ロゴ', t: 'image', folder: 'tournaments' },
      { k: 'description', l: '概要', t: 'textarea', wide: true },
      { k: 'streams', l: '配信アーカイブ', t: 'pairs', wide: true, a: 'label', b: 'url', al: '表示名（例：DAY 1）', bl: 'URL' },
    ],
  },
  tournament_stages: {
    label: 'ステージ', hidden: true, titleOf: (r) => r.name, order: 'sort_order',
    fields: [
      { k: 'tournament_id', l: '大会', t: 'ref', ref: 'tournaments', req: true },
      { k: 'name', l: 'ステージ名', t: 'text', req: true, hint: '例：MAIN STAGE GRADE 1' },
      { k: 'sort_order', l: '並び順', t: 'number', hint: '小さい順に表示' },
      { k: 'schedule', l: '日程', t: 'text', hint: '例：2026.01.31 · 1DAY 6MATCH' },
      { k: 'match_count', l: 'マッチ数', t: 'number' },
      { k: 'maps', l: 'マップ', t: 'list', hint: '例：ERANGEL / MIRAMAR / RONDO（選手のマップ別成績に使います）' },
      { k: 'notes', l: 'ルール・補足', t: 'textarea', wide: true, hint: '昇降格の条件など' },
    ],
  },
  teams: {
    label: 'チーム', icon: 'TEAMS', titleOf: (r) => r.name, order: 'name',
    listCols: [['logo_url', '', (r) => (r.logo_url ? `<img class="thumb" src="${esc(r.logo_url)}" alt="">` : '<span class="thumb"></span>'), true], ['name', 'チーム名'], ['tag', 'タグ'], ['status', '状態', (r) => TEAMST[r.status]], ['region', '地域']],
    fields: [
      { k: 'name', l: 'チーム名', t: 'text', req: true },
      { k: 'tag', l: 'タグ', t: 'text', hint: '例：KN' },
      { k: 'slug', l: 'URL名（スラッグ）', t: 'slug', req: true, from: 'name', prefix: 'team' },
      { k: 'status', l: '状態', t: 'select', opts: [['active', '活動中'], ['inactive', '休止中'], ['disbanded', '解散']] },
      { k: 'region', l: '地域', t: 'text', req: true, def: '日本' },
      { k: 'founded', l: '設立', t: 'text', hint: '例：2024' },
      { k: 'manager', l: 'マネージャー', t: 'text' },
      { k: 'logo_url', l: 'ロゴ', t: 'image', folder: 'teams' },
      { k: 'description', l: '紹介文・沿革', t: 'textarea', wide: true },
      { k: 'achievements', l: '主な実績', t: 'list', wide: true },
      { k: 'links', l: 'リンク', t: 'links', wide: true },
    ],
  },
  players: {
    label: '選手', icon: 'PLAYERS', titleOf: (r) => r.ign, order: 'ign',
    listCols: [['ign', '選手名'], ['full_ign', '表記（タグ付き）'], ['team_id', '所属', (r) => esc(cache.name('teams', r.team_id)) || '<span class="muted">フリー</span>', true], ['role', 'ロール']],
    fields: [
      { k: 'ign', l: '選手名', t: 'text', req: true, hint: 'タグなし（例：TAMR4）' },
      { k: 'full_ign', l: '表記（タグ付き）', t: 'text', hint: '例：KN・TAMR4' },
      { k: 'slug', l: 'URL名（スラッグ）', t: 'slug', req: true, from: 'ign', prefix: 'player' },
      { k: 'team_id', l: '現在の所属', t: 'ref', ref: 'teams', hint: '移籍情報を登録すると自動で更新されます' },
      { k: 'role', l: 'ロール', t: 'text' },
      { k: 'nationality', l: '国籍', t: 'text' },
      { k: 'real_name', l: '本名', t: 'text' },
      { k: 'photo_url', l: '写真', t: 'image', folder: 'players' },
      { k: 'bio', l: '紹介文', t: 'textarea', wide: true },
      { k: 'links', l: 'リンク', t: 'links', wide: true },
    ],
  },
  transfers: {
    label: '移籍', icon: 'TRANSFERS', titleOf: (r) => `${cache.name('players', r.player_id)}：${cache.name('teams', r.from_team_id) || 'フリー'} → ${cache.name('teams', r.to_team_id) || 'フリー'}`, order: 'date.desc',
    listCols: [['date', '日付', (r) => fmtDate(r.date)], ['player_id', '選手', (r) => esc(cache.name('players', r.player_id)), true], ['from_team_id', '移籍元', (r) => esc(cache.name('teams', r.from_team_id)) || '<span class="muted">フリー</span>', true], ['to_team_id', '移籍先', (r) => esc(cache.name('teams', r.to_team_id)) || '<span class="muted">フリー</span>', true], ['kind', '種類', (r) => KIND[r.kind]]],
    fields: [
      { k: 'player_id', l: '選手', t: 'ref', ref: 'players', req: true },
      { k: 'date', l: '日付', t: 'date', req: true, hint: '未来の日付にすると、その日が来たら所属が切り替わります' },
      { k: 'from_team_id', l: '移籍元', t: 'ref', ref: 'teams', hint: '空欄＝フリーから' },
      { k: 'to_team_id', l: '移籍先', t: 'ref', ref: 'teams', hint: '空欄＝フリー／引退' },
      { k: 'kind', l: '種類', t: 'select', opts: [['join', '加入'], ['leave', '脱退'], ['loan', 'レンタル'], ['retire', '引退'], ['role', 'ロール変更']] },
      { k: 'source_url', l: '情報元のURL', t: 'url' },
      { k: 'note', l: 'メモ', t: 'textarea', wide: true },
    ],
  },
};
const CAT = { news: 'ニュース', tournament: '大会', result: '結果', transfer: '移籍', world: '世界' };
const TSTATUS = { upcoming: '開催予定', ongoing: '開催中', completed: '終了' };
const TEAMST = { active: '活動中', inactive: '休止中', disbanded: '解散' };
const KIND = { join: '加入', leave: '脱退', loan: 'レンタル', retire: '引退', role: 'ロール変更' };
const ENT_LABEL = { ...Object.fromEntries(Object.entries(ENT).map(([k, v]) => [k, v.label])), standings: '順位表', player_stats: '選手成績', batch: 'まとめて' };

/* =====================================================================
   入力欄の描画と読み取り
   ===================================================================== */
const MDHELP = '# 見出し　**太字**　*斜体*　[リンク](URL)　![画像](URL)　- 箇条書き　> 引用';

function fieldHTML(f, v, opts = {}) {
  const id = 'f_' + f.k;
  const lbl = `<label for="${id}">${esc(f.l)}${f.req ? '<span class="req">*</span>' : ''}</label>`;
  const hint = f.hint ? `<span class="hint">${esc(f.hint)}</span>` : '';
  const wide = f.wide ? ' wide' : '';
  const req = f.req ? ' required' : '';
  switch (f.t) {
    case 'text': case 'url':
      return `<div class="f${wide}">${lbl}<input id="${id}" name="${f.k}" type="${f.t === 'url' ? 'url' : 'text'}" value="${esc(v)}"${req}>${hint}</div>`;
    case 'slug':
      return `<div class="f${wide}">${lbl}<input id="${id}" name="${f.k}" type="text" value="${esc(v)}" pattern="[a-z0-9][a-z0-9\\-]*" data-from="${f.from || ''}" data-prefix="${f.prefix || ''}" data-touched="${v ? '1' : ''}"${req}>${hint || '<span class="hint">半角英小文字・数字・ハイフン。ページのURLになります</span>'}</div>`;
    case 'number':
      return `<div class="f${wide}">${lbl}<input id="${id}" name="${f.k}" type="number" value="${esc(v)}"${req}>${hint}</div>`;
    case 'date':
      return `<div class="f${wide}">${lbl}<input id="${id}" name="${f.k}" type="date" value="${esc(v ? String(v).slice(0, 10) : '')}"${req}>${hint}</div>`;
    case 'datetime': {
      let val = '';
      if (v) { const d = new Date(v); val = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
      return `<div class="f${wide}">${lbl}<input id="${id}" name="${f.k}" type="datetime-local" value="${val}"${req}>${hint}</div>`;
    }
    case 'textarea':
      return `<div class="f${wide}">${lbl}<textarea id="${id}" name="${f.k}"${req}>${esc(v)}</textarea>${hint}</div>`;
    case 'markdown':
      return `<div class="f${wide}">${lbl}<div class="md-wrap"><textarea id="${id}" class="md" name="${f.k}" data-md="1">${esc(v)}</textarea><div class="md-prev" data-prev="${f.k}">${renderMD(v || '')}</div></div><span class="hint">${esc(MDHELP)}</span></div>`;
    case 'select':
      return `<div class="f${wide}">${lbl}<select id="${id}" name="${f.k}">${f.opts.map(([a, b]) => `<option value="${a}"${a === (v ?? f.opts[0][0]) ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>${hint}</div>`;
    case 'bool':
      return `<div class="f${wide}"><span class="lbl">${esc(f.l)}</span><label class="chk"><input type="checkbox" name="${f.k}"${v ? ' checked' : ''}> はい</label>${hint}</div>`;
    case 'ref': {
      const rows = opts.refs?.[f.ref] || [];
      const label = (r) => (f.ref === 'players' ? r.ign + (r.full_ign && r.full_ign !== r.ign ? `（${r.full_ign}）` : '') : r.name);
      return `<div class="f${wide}">${lbl}<select id="${id}" name="${f.k}"${req}><option value="">（なし）</option>${rows.map((r) => `<option value="${r.id}"${r.id === v ? ' selected' : ''}>${esc(label(r))}</option>`).join('')}</select>${hint}</div>`;
    }
    case 'refs': {
      const rows = opts.refs?.[f.ref] || [];
      const sel = Array.isArray(v) ? v : [];
      const nm = (id2) => { const r = rows.find((x) => x.id === id2); return r ? (r.name || r.ign) : '（不明）'; };
      return `<div class="f${wide}" data-refs="${f.k}"><span class="lbl">${esc(f.l)}</span><div class="multi">${sel.map((s) => `<span class="chip" data-id="${s}">${esc(nm(s))}<button type="button" data-act="chip-x" aria-label="外す">×</button></span>`).join('')}</div>
        <select data-act="chip-add" aria-label="${esc(f.l)}を追加"><option value="">＋ 追加…</option>${rows.map((r) => `<option value="${r.id}">${esc(r.name || r.ign)}</option>`).join('')}</select>${hint}</div>`;
    }
    case 'list': {
      const arr = Array.isArray(v) && v.length ? v : [''];
      return `<div class="f${wide}" data-list="${f.k}"><span class="lbl">${esc(f.l)}</span><div class="listed">${arr.map((x) => `<div class="it"><input type="text" value="${esc(x)}" aria-label="${esc(f.l)}"><button type="button" class="btn line sm" data-act="li-x" aria-label="削除">×</button></div>`).join('')}</div><button type="button" class="linkbtn" data-act="li-add">＋ 行を追加</button>${hint}</div>`;
    }
    case 'pairs': {
      const arr = Array.isArray(v) && v.length ? v : [{}];
      return `<div class="f${wide}" data-pairs="${f.k}" data-a="${f.a}" data-b="${f.b}"><span class="lbl">${esc(f.l)}</span><div class="listed">${arr.map((x) => `<div class="it"><input type="text" placeholder="${esc(f.al)}" value="${esc(x[f.a])}" aria-label="${esc(f.al)}" style="max-width:220px"><input type="url" placeholder="${esc(f.bl)}" value="${esc(x[f.b])}" aria-label="${esc(f.bl)}"><button type="button" class="btn line sm" data-act="li-x" aria-label="削除">×</button></div>`).join('')}</div><button type="button" class="linkbtn" data-act="li-add">＋ 行を追加</button>${hint}</div>`;
    }
    case 'links': {
      const o = v && typeof v === 'object' ? v : {};
      return `<div class="f${wide}" data-links="${f.k}"><span class="lbl">${esc(f.l)}</span><div class="kv">${LINK_KEYS.map(([k, n]) => `<span>${n}</span><input type="url" data-key="${k}" value="${esc(o[k])}" placeholder="https://" aria-label="${n}">`).join('')}</div>${hint}</div>`;
    }
    case 'image':
      return `<div class="f${wide}" data-image="${f.k}"><span class="lbl">${esc(f.l)}</span><div class="img-f"><img src="${esc(v || '')}" alt="" ${v ? '' : 'style="visibility:hidden"'}><div class="col">
        <input type="url" name="${f.k}" value="${esc(v)}" placeholder="画像のURL（アップロードすると自動で入ります）" aria-label="${esc(f.l)}のURL">
        <div class="row"><label class="btn line sm">画像を選ぶ<input type="file" accept="image/*" data-folder="${f.folder}" hidden></label><button type="button" class="linkbtn" data-act="img-clear">画像を外す</button></div></div></div>${hint}</div>`;
    default: return '';
  }
}

function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    switch (f.t) {
      case 'bool': out[f.k] = form.querySelector(`[name="${f.k}"]`).checked; break;
      case 'number': { const v = form.querySelector(`[name="${f.k}"]`).value; out[f.k] = v === '' ? null : Number(v); break; }
      case 'datetime': { const v = form.querySelector(`[name="${f.k}"]`).value; out[f.k] = v ? new Date(v).toISOString() : null; break; }
      case 'refs': out[f.k] = [...form.querySelectorAll(`[data-refs="${f.k}"] .chip`)].map((c) => c.dataset.id); break;
      case 'list': out[f.k] = [...form.querySelectorAll(`[data-list="${f.k}"] .it input`)].map((i) => i.value.trim()).filter(Boolean); break;
      case 'pairs': {
        const box = form.querySelector(`[data-pairs="${f.k}"]`);
        out[f.k] = [...box.querySelectorAll('.it')].map((it) => { const [a, b] = it.querySelectorAll('input'); return { [f.a]: a.value.trim(), [f.b]: b.value.trim() }; }).filter((x) => x[f.a] || x[f.b]);
        break;
      }
      case 'links': {
        const o = {};
        form.querySelectorAll(`[data-links="${f.k}"] input`).forEach((i) => { if (i.value.trim()) o[i.dataset.key] = i.value.trim(); });
        out[f.k] = o; break;
      }
      default: { const v = form.querySelector(`[name="${f.k}"]`).value.trim(); out[f.k] = v === '' ? null : v; }
    }
  }
  return out;
}

function bindFormWidgets(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'li-add') {
      const box = b.parentElement.querySelector('.listed');
      const proto = box.querySelector('.it');
      const n = proto.cloneNode(true); n.querySelectorAll('input').forEach((i) => (i.value = '')); box.appendChild(n); n.querySelector('input').focus();
    } else if (act === 'li-x') {
      const box = b.closest('.listed');
      if (box.querySelectorAll('.it').length > 1) b.closest('.it').remove(); else b.closest('.it').querySelectorAll('input').forEach((i) => (i.value = ''));
    } else if (act === 'chip-x') b.closest('.chip').remove();
    else if (act === 'img-clear') {
      const w = b.closest('[data-image]'); w.querySelector('input[type=url]').value = ''; const im = w.querySelector('img'); im.src = ''; im.style.visibility = 'hidden';
    }
  });
  root.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.dataset.act === 'chip-add' && el.value) {
      const box = el.parentElement.querySelector('.multi');
      if (!box.querySelector(`[data-id="${el.value}"]`)) box.insertAdjacentHTML('beforeend', `<span class="chip" data-id="${el.value}">${esc(el.options[el.selectedIndex].text)}<button type="button" data-act="chip-x" aria-label="外す">×</button></span>`);
      el.value = '';
    }
    if (el.type === 'file' && el.files[0]) {
      const w = el.closest('[data-image]');
      try {
        toast('画像をアップロード中…');
        const url = await uploadImage(el.files[0], el.dataset.folder || 'misc');
        w.querySelector('input[type=url]').value = url;
        const im = w.querySelector('img'); im.src = url; im.style.visibility = 'visible';
        toast('アップロードしました');
      } catch (err) { toast(err.message, true); }
      el.value = '';
    }
    if (el.matches('[data-image] input[type=url]')) { const im = el.closest('[data-image]').querySelector('img'); im.src = el.value; im.style.visibility = el.value ? 'visible' : 'hidden'; }
  });
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.md) { const p = root.querySelector(`[data-prev="${el.name}"]`); if (p) p.innerHTML = renderMD(el.value); }
    if (el.matches('input[data-from]')) el.dataset.touched = el.value ? '1' : '';
    // スラッグの自動入力
    root.querySelectorAll('input[data-from]').forEach((s) => {
      if (s.dataset.touched || !s.dataset.from || el.name !== s.dataset.from) return;
      const base = slugify(el.value);
      s.value = base || '';
    });
  });
}

/* ミニ Markdown（安全のため、まず全部エスケープしてから整形） */
function renderMD(src) {
  const inline = (s) => esc(s)
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  const lines = String(src).replace(/\r/g, '').split('\n');
  let html = '', para = [], list = null;
  const flushP = () => { if (para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const flushL = () => { if (list) { html += `<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.t}>`; list = null; } };
  for (const ln of lines) {
    let m;
    if (!ln.trim()) { flushP(); flushL(); continue; }
    if ((m = ln.match(/^(#{1,4})\s+(.*)/))) { flushP(); flushL(); const lv = Math.min(4, m[1].length + 1); html += `<h${lv}>${inline(m[2])}</h${lv}>`; continue; }
    if ((m = ln.match(/^\s*[-*]\s+(.*)/))) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = ln.match(/^>\s?(.*)/))) { flushP(); flushL(); html += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
    if (/^---+$/.test(ln.trim())) { flushP(); flushL(); html += '<hr>'; continue; }
    flushL(); para.push(ln);
  }
  flushP(); flushL();
  return html || '<p class="muted">（プレビュー）</p>';
}

/* =====================================================================
   画面の骨組み
   ===================================================================== */
let ME = null;            // {id, display_name, role}
let PENDING_COUNT = 0;
const isAdmin = () => ME?.role === 'admin';

async function loadMe() {
  const uid = Auth.uid();
  if (!uid) { ME = null; return; }
  const rows = await db.select('profiles', 'select=*&id=eq.' + uid);
  ME = rows[0] || null;
}
async function loadPendingCount() {
  try {
    const q = isAdmin() ? 'select=id&status=eq.pending' : `select=id&status=eq.pending&author_id=eq.${ME.id}`;
    PENDING_COUNT = (await db.select('change_requests', q)).length;
  } catch { PENDING_COUNT = 0; }
}

function shell(route, content) {
  const nav = [
    ['#/', 'ホーム', route === ''],
    ['#/list/articles', '記事', route === 'articles'],
    ['#/list/tournaments', '大会', route === 'tournaments'],
    ['#/list/teams', 'チーム', route === 'teams'],
    ['#/list/players', '選手', route === 'players'],
    ['#/list/transfers', '移籍', route === 'transfers'],
    ['#/requests', isAdmin() ? '承認' : 'リクエスト', route === 'requests', PENDING_COUNT],
    ...(isAdmin() ? [['#/members', 'メンバー', route === 'members']] : []),
  ];
  return `<header class="top"><div class="top-in">
    <a class="brand" href="#/"><i></i>DROPZONE <small>編集サイト</small></a>
    <nav class="nav" aria-label="メニュー">${nav.map(([h, l, on, n]) => `<a href="${h}"${on ? ' class="on" aria-current="page"' : ''}>${l}${n ? `<span class="badge">${n}</span>` : ''}</a>`).join('')}</nav>
    <div class="me"><span class="role ${ME.role}">${ME.role === 'admin' ? '管理者' : '投稿者'}</span><a href="#/account">${esc(ME.display_name)}</a></div>
  </div></header><main>${content}</main>`;
}

function authShell(inner) { return `<div class="auth"><div class="card"><div class="brand"><i></i>DROPZONE</div>${inner}</div></div>`; }

/* =====================================================================
   ルーター
   ===================================================================== */
let AUTH_TYPE = null;   // 招待・再設定メールから来たとき 'invite' / 'recovery'

async function router() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const q = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  if (path === '/login') return viewLogin();
  if (path === '/forgot') return viewForgot();
  if (!Auth.session) { location.hash = '#/login'; return; }
  try {
    if (!ME) await loadMe();
  } catch (e) { $app.innerHTML = authShell(`<p class="notice ng">${esc(e.message)}</p><button class="btn" onclick="location.reload()">再読み込み</button>`); return; }
  if (!ME) { $app.innerHTML = authShell('<p>このアカウントはまだ登録されていません。管理者に連絡してください。</p><button class="btn line" id="lo">ログアウト</button>'); document.getElementById('lo').onclick = logout; return; }
  if (ME.role === 'disabled') { $app.innerHTML = authShell('<p>このアカウントは現在利用できません。</p><button class="btn line" id="lo">ログアウト</button>'); document.getElementById('lo').onclick = logout; return; }
  if (path === '/set-password' || AUTH_TYPE) return viewSetPassword();
  await loadPendingCount();
  try {
    if (parts[0] === 'list' && ENT[parts[1]] && !ENT[parts[1]].hidden) return await viewList(parts[1], q);
    if (parts[0] === 'edit' && ENT[parts[1]]) return await viewEdit(parts[1], parts[2], q);
    if (parts[0] === 'stage' && parts[1]) return await viewStage(parts[1]);
    if (parts[0] === 'requests') return await viewRequests(q);
    if (parts[0] === 'request' && parts[1]) return await viewRequest(parts[1]);
    if (parts[0] === 'members') return await viewMembers();
    if (parts[0] === 'account') return viewAccount();
    return await viewHome();
  } catch (e) {
    console.error(e);
    $app.innerHTML = shell('', `<p class="notice ng">読み込みに失敗しました：${esc(e.message)}</p>`);
  }
}

async function logout() { await Auth.signOut(); ME = null; cache.clear(); location.hash = '#/login'; }

/* ---------- ログイン ---------- */
function viewLogin() {
  if (Auth.session) { location.hash = '#/'; return; }
  $app.innerHTML = authShell(`
    <h1 style="font-size:24px">ログイン</h1>
    <form id="lf" class="f" style="gap:14px">
      <div class="f"><label for="em">メールアドレス</label><input id="em" type="email" autocomplete="username" required></div>
      <div class="f"><label for="pw">パスワード</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <p id="err" class="notice ng" hidden></p>
      <button class="btn acc" type="submit">ログイン</button>
    </form>
    <a href="#/forgot" class="small">パスワードを忘れた場合</a>`);
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('err'); err.hidden = true;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try { await Auth.signIn(document.getElementById('em').value.trim(), document.getElementById('pw').value); ME = null; location.hash = '#/'; }
    catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
  };
}
function viewForgot() {
  $app.innerHTML = authShell(`
    <h1 style="font-size:24px">パスワードの再設定</h1>
    <p class="small muted" style="margin:0">登録したメールアドレスに、再設定用のリンクを送ります。</p>
    <form id="ff" class="f" style="gap:14px">
      <div class="f"><label for="em">メールアドレス</label><input id="em" type="email" required></div>
      <p id="msg" class="notice" hidden></p>
      <button class="btn acc" type="submit">リンクを送る</button>
    </form>
    <a href="#/login" class="small">ログイン画面に戻る</a>`);
  document.getElementById('ff').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('msg');
    try { await Auth.recover(document.getElementById('em').value.trim()); msg.className = 'notice ok'; msg.textContent = 'メールを送りました。届いたリンクから新しいパスワードを設定してください。'; }
    catch (x) { msg.className = 'notice ng'; msg.textContent = x.message; }
    msg.hidden = false;
  };
}
function viewSetPassword() {
  const first = AUTH_TYPE === 'invite';
  $app.innerHTML = authShell(`
    <h1 style="font-size:24px">${first ? 'ようこそ！' : '新しいパスワード'}</h1>
    <p class="small muted" style="margin:0">${first ? 'DROPZONE 編集サイトで使うパスワードと表示名を決めてください。' : '新しいパスワードを入力してください。'}</p>
    <form id="sp" class="f" style="gap:14px">
      ${first ? `<div class="f"><label for="dn">表示名（記者名）</label><input id="dn" type="text" value="${esc(ME.display_name)}" required></div>` : ''}
      <div class="f"><label for="p1">パスワード（8文字以上）</label><input id="p1" type="password" minlength="8" autocomplete="new-password" required></div>
      <div class="f"><label for="p2">もう一度</label><input id="p2" type="password" minlength="8" autocomplete="new-password" required></div>
      <p id="err" class="notice ng" hidden></p>
      <button class="btn acc" type="submit">設定する</button>
    </form>`);
  document.getElementById('sp').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('err'); err.hidden = true;
    const p1 = document.getElementById('p1').value, p2 = document.getElementById('p2').value;
    if (p1 !== p2) { err.textContent = 'パスワードが一致しません'; err.hidden = false; return; }
    try {
      await Auth.updatePassword(p1);
      const dn = document.getElementById('dn');
      if (dn && dn.value.trim()) await db.rpc('set_my_name', { p_display_name: dn.value.trim() });
      AUTH_TYPE = null; ME = null;
      toast('設定しました');
      location.hash = '#/';
      if (location.hash === '#/') router();
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  };
}

/* ---------- ホーム ---------- */
async function viewHome() {
  const mine = await db.select('change_requests', `select=id,entity,action,title,status,created_at,comment&author_id=eq.${ME.id}&order=created_at.desc&limit=8`);
  const tiles = Object.entries(ENT).filter(([, v]) => !v.hidden).map(([k, v]) => `<a class="tile" href="#/list/${k}"><b>${v.icon}</b><span>${v.label}を追加・編集</span></a>`).join('');
  $app.innerHTML = shell('', `
    <h1>こんにちは、${esc(ME.display_name)}さん</h1>
    <p class="lead">${isAdmin() ? '管理者として、編集はそのまま公開されます。投稿者からのリクエストは「承認」から確認できます。' : '編集した内容は「承認リクエスト」として送られ、管理者が承認すると公開サイトに反映されます。'}</p>
    ${isAdmin() && PENDING_COUNT ? `<p class="notice">承認待ちのリクエストが <b>${PENDING_COUNT}件</b> あります。<a href="#/requests">確認する →</a></p>` : ''}
    <div class="grid">${tiles}</div>
    <h2>自分の最近のリクエスト</h2>
    ${requestTable(mine, false)}
    <p class="small muted" style="margin-top:24px">公開サイト：<a href="${esc(C.siteUrl)}" target="_blank" rel="noopener">${esc(C.siteUrl.replace('https://', ''))}</a>（承認から反映まで数分〜15分ほどかかります）</p>`);
}

function requestTable(rows, showAuthor) {
  if (!rows.length) return '<p class="muted">まだありません。</p>';
  return `<div class="tbl-wrap"><table><thead><tr><th>日時</th><th>種類</th><th>内容</th>${showAuthor ? '<th>投稿者</th>' : ''}<th>状態</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="small muted">${fmtDT(r.created_at)}</td><td class="small">${r.entity === 'batch' ? '一括更新' : esc(ENT_LABEL[r.entity] || r.entity) + '・' + (ACTION_JA[r.action] || r.action)}</td>
      <td><a href="#/request/${r.id}">${esc(r.title || '（無題）')}</a>${r.status === 'rejected' && r.comment ? `<div class="small" style="color:var(--ng)">${esc(r.comment)}</div>` : ''}</td>
      ${showAuthor ? `<td class="small">${esc(r.author_name || '')}</td>` : ''}<td><span class="pill ${r.status}">${STATUS_JA[r.status]}</span></td></tr>`).join('')}
  </tbody></table></div>`;
}

/* ---------- 一覧 ---------- */
async function viewList(ent, q) {
  const E = ENT[ent];
  if (['players', 'transfers'].includes(ent)) { await cache.get('teams'); }
  if (ent === 'transfers') await cache.get('players');
  const rows = await db.select(ent, `select=*&order=${E.order}`);
  const term = q.get('q') || '';
  const filtered = term ? rows.filter((r) => JSON.stringify(Object.values(r)).toLowerCase().includes(term.toLowerCase()) || E.titleOf(r).toLowerCase().includes(term.toLowerCase())) : rows;
  $app.innerHTML = shell(ent, `
    <div class="row"><h1>${E.label}</h1><span class="spacer"></span><a class="btn acc" href="#/edit/${ent}/new">＋ ${E.label}を追加</a></div>
    <p class="lead">${rows.length}件${term ? `（「${esc(term)}」で${filtered.length}件）` : ''}</p>
    <form id="sf" class="row" style="margin-bottom:14px"><input type="search" id="sq" value="${esc(term)}" placeholder="検索" style="max-width:320px" aria-label="検索"><button class="btn line">検索</button></form>
    ${filtered.length ? `<div class="tbl-wrap"><table><thead><tr>${E.listCols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${filtered.map((r) => `<tr>${E.listCols.map(([k, , fn, raw]) => `<td>${fn ? (raw ? fn(r) : esc(fn(r))) : esc(r[k])}</td>`).join('')}<td style="text-align:right"><a class="btn line sm" href="#/edit/${ent}/${r.id}">編集</a></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">まだ登録がありません。</p>'}`);
  document.getElementById('sf').onsubmit = (e) => { e.preventDefault(); const v = document.getElementById('sq').value.trim(); location.hash = `#/list/${ent}${v ? '?q=' + encodeURIComponent(v) : ''}`; };
}

/* ---------- 編集 ---------- */
async function loadRefs(fields) {
  const refs = {};
  for (const f of fields) if (f.ref && !refs[f.ref]) refs[f.ref] = await cache.get(f.ref);
  return refs;
}

async function viewEdit(ent, id, q) {
  const E = ENT[ent];
  const isNew = !id || id === 'new';
  const refs = await loadRefs(E.fields);
  let row = isNew ? {} : await db.one(ent, id);
  if (!isNew && !row) { $app.innerHTML = shell(ent, '<p class="notice ng">データが見つかりません（削除された可能性があります）。</p>'); return; }
  // 差し戻されたリクエストから作り直す
  let fromReq = null;
  if (q.get('from')) {
    const rr = await db.select('change_requests', 'select=*&id=eq.' + q.get('from'));
    fromReq = rr[0] || null;
    if (fromReq) row = { ...row, ...fromReq.payload };
  }
  // 新規の初期値
  if (isNew && !fromReq) {
    for (const f of E.fields) {
      if (f.defMe) row[f.k] = ME.display_name;
      if (f.def !== undefined) row[f.k] = f.def;
      if (f.t === 'datetime' && f.req) row[f.k] = new Date().toISOString();
    }
    for (const [k, v] of q.entries()) if (E.fields.some((f) => f.k === k)) row[k] = v;
  }
  const orig = isNew ? {} : await db.one(ent, id);
  // 自分の承認待ち
  let pend = [];
  if (!isNew) pend = await db.select('change_requests', `select=id,title,created_at,author_name&status=eq.pending&entity_id=eq.${id}`);

  let extra = '';
  if (ent === 'tournaments' && !isNew) {
    const stages = await db.select('tournament_stages', `select=*&tournament_id=eq.${id}&order=sort_order`);
    extra = `<h2>ステージ・順位表</h2><p class="small muted" style="margin-top:-6px">ステージごとに、順位表と選手成績を入力します。</p>
      ${stages.length ? `<div class="tbl-wrap"><table><thead><tr><th>並び</th><th>ステージ</th><th>日程</th><th></th></tr></thead><tbody>${stages.map((s) => `<tr><td class="num">${esc(s.sort_order)}</td><td>${esc(s.name)}</td><td class="small muted">${esc(s.schedule || '')}</td><td style="text-align:right"><a class="btn line sm" href="#/stage/${s.id}">順位表・成績</a> <a class="btn line sm" href="#/edit/tournament_stages/${s.id}">ステージ情報</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">まだステージがありません。</p>'}
      <p style="margin-top:12px"><a class="btn line" href="#/edit/tournament_stages/new?tournament_id=${id}&sort_order=${stages.length + 1}">＋ ステージを追加</a></p>`;
  }
  if (ent === 'tournament_stages' && !isNew) {
    extra = `<p style="margin-top:20px"><a class="btn line" href="#/stage/${id}">このステージの順位表・選手成績を入力 →</a></p>`;
  }

  const back = ent === 'tournament_stages' ? `#/edit/tournaments/${row.tournament_id || q.get('tournament_id') || ''}` : `#/list/${ent}`;
  const title = isNew ? `${E.label}を追加` : `${E.label}を編集`;
  $app.innerHTML = shell(ent === 'tournament_stages' ? 'tournaments' : ent, `
    <div class="crumb"><a href="${back}">← ${ent === 'tournament_stages' ? '大会に戻る' : E.label + 'の一覧'}</a></div>
    <h1>${title}</h1>
    ${!isNew ? `<p class="lead">${esc(E.titleOf(orig))}</p>` : '<p class="lead"></p>'}
    ${fromReq ? `<p class="notice">差し戻されたリクエストの内容を読み込みました。${fromReq.comment ? `管理者のコメント：「${esc(fromReq.comment)}」` : ''}</p>` : ''}
    ${pend.length ? `<p class="notice">このデータには承認待ちのリクエストが${pend.length}件あります（${pend.map((p) => `<a href="#/request/${p.id}">${esc(p.author_name || '')} ${fmtDT(p.created_at)}</a>`).join('、')}）。重ならないよう注意してください。</p>` : ''}
    ${!isAdmin() ? '<p class="notice">保存すると「承認リクエスト」として送られます。管理者が承認すると公開されます。</p>' : ''}
    <form id="ef" class="card" novalidate>
      <div class="form">${E.fields.map((f) => fieldHTML(f, row[f.k], { refs })).join('')}</div>
      <div class="actions">
        <button class="btn acc" type="submit">${isAdmin() ? (isNew ? '追加して公開' : '保存して公開') : '承認リクエストを送る'}</button>
        <a class="btn line" href="${back}">キャンセル</a>
        <span class="spacer"></span>
        ${!isNew ? `<button class="btn ng" type="button" id="delb">${isAdmin() ? '削除する' : '削除をリクエスト'}</button>` : ''}
      </div>
    </form>${extra}`);

  const form = document.getElementById('ef');
  bindFormWidgets(form);
  // 移籍：選手を選んだら移籍元に現所属を入れる
  if (ent === 'transfers') {
    form.querySelector('[name=player_id]').addEventListener('change', (e) => {
      const p = (refs.players || []).find((x) => x.id === e.target.value);
      const fromSel = form.querySelector('[name=from_team_id]');
      if (p && !fromSel.value) fromSel.value = p.team_id || '';
    });
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = readForm(form, E.fields);
    for (const f of E.fields) {
      if (f.req && (data[f.k] === null || data[f.k] === '')) { toast(`「${f.l}」を入力してください`, true); form.querySelector(`[name="${f.k}"]`)?.focus(); return; }
      if (f.t === 'slug' && data[f.k] && !/^[a-z0-9][a-z0-9-]*$/.test(data[f.k])) { toast('URL名は半角英小文字・数字・ハイフンで入力してください', true); return; }
    }
    let payload = data;
    if (!isNew) {
      payload = {};
      for (const f of E.fields) if (JSON.stringify(data[f.k] ?? null) !== JSON.stringify(orig[f.k] ?? null)) payload[f.k] = data[f.k];
      if (!Object.keys(payload).length) { toast('変更がありません', true); return; }
    } else {
      payload.id = crypto.randomUUID();
    }
    const label = E.titleOf({ ...orig, ...data });
    await submit(ent, isNew ? 'create' : 'update', isNew ? null : id, payload, `${E.label}${isNew ? '追加' : '編集'}：${label}`, form, (res) => {
      if (ent === 'tournament_stages') return `#/edit/tournaments/${data.tournament_id}`;
      if (isAdmin() && isNew && ent === 'tournaments') return `#/edit/tournaments/${res.entity_id}`;
      return `#/list/${ent}`;
    });
  };
  const delb = document.getElementById('delb');
  if (delb) delb.onclick = async () => {
    const extraMsg = ent === 'tournaments' ? '\nステージ・順位表・選手成績もまとめて削除されます。' : ent === 'teams' ? '\n選手の所属や順位表のチーム情報は空になります。' : '';
    if (!confirm(`「${E.titleOf(orig)}」を削除${isAdmin() ? 'します' : 'するリクエストを送ります'}。よろしいですか？${extraMsg}`)) return;
    await submit(ent, 'delete', id, {}, `${E.label}削除：${E.titleOf(orig)}`, form, () => (ent === 'tournament_stages' ? `#/edit/tournaments/${orig.tournament_id}` : `#/list/${ent}`));
  };
}

async function submit(entity, action, entityId, payload, title, form, next) {
  const btns = form ? form.querySelectorAll('button') : [];
  btns.forEach((b) => (b.disabled = true));
  try {
    const res = await db.rpc('submit_change', { p_entity: entity, p_action: action, p_entity_id: entityId, p_payload: payload, p_title: title });
    cache.clear();
    toast(res.status === 'approved' ? '公開しました（サイトへの反映まで数分かかります）' : '承認リクエストを送りました');
    const n = typeof next === 'function' ? next(res) : next;
    if (n) { if (location.hash === n) router(); else location.hash = n; }
    return res;
  } catch (e) {
    toast(e.message, true);
    btns.forEach((b) => (b.disabled = false));
    throw e;
  }
}

/* ---------- ステージの順位表・選手成績 ---------- */
async function viewStage(stageId) {
  const stage = await db.one('tournament_stages', stageId);
  if (!stage) { $app.innerHTML = shell('tournaments', '<p class="notice ng">ステージが見つかりません。</p>'); return; }
  const [tour, teams, players, standings, stats, pend] = await Promise.all([
    db.one('tournaments', stage.tournament_id), cache.get('teams'), cache.get('players'),
    db.select('standings', `select=*&stage_id=eq.${stageId}&order=rank.asc.nullslast`),
    db.select('player_stats', `select=*&stage_id=eq.${stageId}&order=kills.desc`),
    db.select('change_requests', `select=id,title,created_at,author_name&status=eq.pending&entity=eq.batch&entity_id=eq.${stageId}`),
  ]);
  const maps = Array.isArray(stage.maps) ? stage.maps : [];
  const teamOpts = (sel) => `<option value="">（未登録／入力）</option>` + teams.map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  const playerOpts = (sel) => `<option value="">（選手を選ぶ）</option>` + players.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.ign)}${p.full_ign && p.full_ign !== p.ign ? `（${esc(p.full_ign)}）` : ''}</option>`).join('');

  const sRow = (r = {}) => `<tr data-id="${r.id || ''}">
    <td><input type="number" data-k="rank" value="${esc(r.rank ?? '')}" aria-label="順位" style="width:56px"></td>
    <td><select data-k="team_id" aria-label="チーム">${teamOpts(r.team_id)}</select></td>
    <td><input type="text" data-k="team_name" value="${esc(r.team_name || '')}" placeholder="未登録チーム名" aria-label="未登録チーム名" style="min-width:120px"></td>
    <td><input type="number" data-k="wwcd" value="${esc(r.wwcd ?? 0)}" aria-label="WWCD"></td>
    <td><input type="number" data-k="place_pts" value="${esc(r.place_pts ?? 0)}" aria-label="順位pt"></td>
    <td><input type="number" data-k="kill_pts" value="${esc(r.kill_pts ?? 0)}" aria-label="キルpt"></td>
    <td><input type="number" data-k="total" value="${esc(r.total ?? 0)}" aria-label="合計"></td>
    <td><input type="text" data-k="note" value="${esc(r.note || '')}" placeholder="昇格 など" aria-label="メモ" style="width:90px"></td>
    <td><button type="button" class="btn line sm" data-act="row-x" aria-label="この行を削除">×</button></td></tr>`;
  const mk = (r, m, k) => esc(r.map_kills?.[m]?.[k] ?? '');
  const pRow = (r = {}) => `<tr data-id="${r.id || ''}">
    <td><select data-k="player_id" aria-label="選手">${playerOpts(r.player_id)}</select></td>
    <td><select data-k="team_id" aria-label="チーム">${teamOpts(r.team_id)}</select></td>
    <td><input type="number" data-k="matches" value="${esc(r.matches ?? 0)}" aria-label="マッチ数"></td>
    <td><input type="number" data-k="kills" value="${esc(r.kills ?? 0)}" aria-label="キル"></td>
    <td><input type="number" data-k="max_kills" value="${esc(r.max_kills ?? '')}" aria-label="最多キル"></td>
    ${maps.map((m) => `<td><input type="number" data-map="${esc(m)}" data-mk="matches" value="${mk(r, m, 'matches')}" aria-label="${esc(m)} マッチ数" style="width:56px"></td><td><input type="number" data-map="${esc(m)}" data-mk="kills" value="${mk(r, m, 'kills')}" aria-label="${esc(m)} キル" style="width:56px"></td>`).join('')}
    <td><button type="button" class="btn line sm" data-act="row-x" aria-label="この行を削除">×</button></td></tr>`;

  $app.innerHTML = shell('tournaments', `
    <div class="crumb"><a href="#/edit/tournaments/${tour.id}">← ${esc(tour.name)}</a></div>
    <h1>${esc(stage.name)}</h1>
    <p class="lead">${esc(tour.name)}　<a href="#/edit/tournament_stages/${stage.id}" class="small">ステージ情報を編集</a></p>
    ${pend.length ? `<p class="notice">このステージには承認待ちのリクエストが${pend.length}件あります（${pend.map((p) => `<a href="#/request/${p.id}">${esc(p.author_name || '')} ${fmtDT(p.created_at)}</a>`).join('、')}）。</p>` : ''}
    ${!isAdmin() ? '<p class="notice">保存すると、表全体が1件の承認リクエストとして送られます。</p>' : ''}

    <h2>順位表</h2>
    <form id="sf" class="card ge">
      <div class="tbl-wrap" style="border:0"><table><thead><tr><th>#</th><th>チーム</th><th>未登録の場合</th><th class="num">WWCD</th><th class="num">順位pt</th><th class="num">キルpt</th><th class="num">合計</th><th>メモ</th><th></th></tr></thead>
      <tbody>${(standings.length ? standings : []).map(sRow).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button type="button" class="btn line sm" data-act="row-add">＋ 行を追加</button>
        <label class="chk small"><input type="checkbox" id="autosum" checked> 合計を自動計算（順位pt＋キルpt）</label>
        <button type="button" class="btn line sm" data-act="sort">合計で並べ替えて順位を振る</button></div>
      <div class="actions"><button class="btn acc" type="submit">${isAdmin() ? '順位表を保存して公開' : '順位表の承認リクエストを送る'}</button></div>
    </form>

    <h2>選手成績</h2>
    ${maps.length ? '' : '<p class="small muted">ステージ情報で「マップ」を入れると、マップ別の成績も入力できます。</p>'}
    <form id="pf" class="card ge">
      <div class="tbl-wrap" style="border:0"><table><thead><tr><th>選手</th><th>チーム</th><th class="num">マッチ</th><th class="num">キル</th><th class="num">最多</th>${maps.map((m) => `<th colspan="2">${esc(m)}<br><span class="small">試合 / キル</span></th>`).join('')}<th></th></tr></thead>
      <tbody>${stats.map(pRow).join('')}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button type="button" class="btn line sm" data-act="row-add">＋ 行を追加</button></div>
      <div class="actions"><button class="btn acc" type="submit">${isAdmin() ? '選手成績を保存して公開' : '選手成績の承認リクエストを送る'}</button></div>
    </form>`);

  const sf = document.getElementById('sf'), pf = document.getElementById('pf');
  if (!standings.length) sf.querySelector('tbody').insertAdjacentHTML('beforeend', sRow());
  if (!stats.length) pf.querySelector('tbody').insertAdjacentHTML('beforeend', pRow());
  const gridClick = (form, proto) => form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const tb = form.querySelector('tbody');
    if (b.dataset.act === 'row-add') tb.insertAdjacentHTML('beforeend', proto());
    if (b.dataset.act === 'row-x') { const tr = b.closest('tr'); if (tr.dataset.id) tr.classList.toggle('del'); else tr.remove(); }
    if (b.dataset.act === 'sort') {
      const trs = [...tb.querySelectorAll('tr')];
      trs.sort((a, c) => Number(c.querySelector('[data-k=total]').value || 0) - Number(a.querySelector('[data-k=total]').value || 0));
      let n = 0; trs.forEach((tr) => { tb.appendChild(tr); if (!tr.classList.contains('del')) tr.querySelector('[data-k=rank]').value = ++n; });
    }
  });
  gridClick(sf, sRow); gridClick(pf, pRow);
  sf.addEventListener('input', (e) => {
    if (!document.getElementById('autosum').checked) return;
    const tr = e.target.closest('tr'); if (!tr || !['place_pts', 'kill_pts'].includes(e.target.dataset.k)) return;
    tr.querySelector('[data-k=total]').value = Number(tr.querySelector('[data-k=place_pts]').value || 0) + Number(tr.querySelector('[data-k=kill_pts]').value || 0);
  });
  pf.addEventListener('change', (e) => {
    if (e.target.dataset.k !== 'player_id') return;
    const p = players.find((x) => x.id === e.target.value); const ts = e.target.closest('tr').querySelector('[data-k=team_id]');
    if (p && !ts.value) ts.value = p.team_id || '';
  });

  const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
  const diffItems = (form, table, origRows, read) => {
    const items = [];
    form.querySelectorAll('tbody tr').forEach((tr) => {
      const id = tr.dataset.id;
      if (tr.classList.contains('del')) { items.push({ entity: table, action: 'delete', entity_id: id, payload: {} }); return; }
      const d = read(tr); if (!d) return;
      if (!id) { items.push({ entity: table, action: 'create', payload: { ...d, stage_id: stageId, id: crypto.randomUUID() } }); return; }
      const o = origRows.find((x) => x.id === id); const ch = {};
      for (const k of Object.keys(d)) if (JSON.stringify(d[k] ?? null) !== JSON.stringify(o[k] ?? null)) ch[k] = d[k];
      if (Object.keys(ch).length) items.push({ entity: table, action: 'update', entity_id: id, payload: ch });
    });
    return items;
  };
  sf.onsubmit = async (e) => {
    e.preventDefault();
    const items = diffItems(sf, 'standings', standings, (tr) => {
      const g = (k) => tr.querySelector(`[data-k=${k}]`).value;
      if (!g('team_id') && !g('team_name').trim()) return null;
      return { rank: numOrNull(g('rank')), team_id: g('team_id') || null, team_name: g('team_name').trim() || null, wwcd: Number(g('wwcd') || 0), place_pts: Number(g('place_pts') || 0), kill_pts: Number(g('kill_pts') || 0), total: Number(g('total') || 0), note: g('note').trim() || null };
    });
    if (!items.length) { toast('変更がありません', true); return; }
    await submit('batch', 'batch', stageId, { items }, `順位表：${tour.short_name || tour.name} ${stage.name}（${items.length}行）`, sf, `#/stage/${stageId}`).catch(() => {});
  };
  pf.onsubmit = async (e) => {
    e.preventDefault();
    const items = diffItems(pf, 'player_stats', stats, (tr) => {
      const g = (k) => tr.querySelector(`[data-k=${k}]`).value;
      if (!g('player_id')) return null;
      const mk2 = {};
      tr.querySelectorAll('[data-map]').forEach((i) => { if (i.value !== '') { (mk2[i.dataset.map] ||= {})[i.dataset.mk] = Number(i.value); } });
      return { player_id: g('player_id'), team_id: g('team_id') || null, matches: Number(g('matches') || 0), kills: Number(g('kills') || 0), max_kills: numOrNull(g('max_kills')), map_kills: mk2 };
    });
    if (!items.length) { toast('変更がありません', true); return; }
    await submit('batch', 'batch', stageId, { items }, `選手成績：${tour.short_name || tour.name} ${stage.name}（${items.length}行）`, pf, `#/stage/${stageId}`).catch(() => {});
  };
}

/* ---------- 承認リクエスト ---------- */
async function viewRequests(q) {
  const st = q.get('status') || 'pending';
  let qs = `select=id,entity,action,title,status,created_at,author_name,comment&order=created_at.desc&limit=200`;
  if (st !== 'all') qs += `&status=eq.${st}`;
  if (!isAdmin()) qs += `&author_id=eq.${ME.id}`;
  const rows = await db.select('change_requests', qs);
  const tabs = [['pending', '承認待ち'], ['approved', '承認済み'], ['rejected', '差し戻し'], ['all', 'すべて']];
  $app.innerHTML = shell('requests', `
    <h1>${isAdmin() ? '承認' : '自分のリクエスト'}</h1>
    <p class="lead">${isAdmin() ? '投稿者から届いたリクエストです。内容を確認して承認・差し戻しをしてください。' : '送ったリクエストの状況です。差し戻されたものは、修正して送り直せます。'}</p>
    <div class="row" style="margin-bottom:14px">${tabs.map(([k, l]) => `<a class="btn ${k === st ? '' : 'line'} sm" href="#/requests?status=${k}">${l}</a>`).join('')}</div>
    ${requestTable(rows, isAdmin())}`);
}

async function viewRequest(id) {
  const r = (await db.select('change_requests', 'select=*&id=eq.' + id))[0];
  if (!r) { $app.innerHTML = shell('requests', '<p class="notice ng">リクエストが見つかりません。</p>'); return; }
  await Promise.all(['teams', 'players', 'tournaments', 'tournament_stages'].map((t) => cache.get(t)));
  let body = '';
  if (r.entity === 'batch') {
    body = await batchDiff(r);
  } else {
    const E = ENT[r.entity];
    const cur = r.entity_id ? await db.one(r.entity, r.entity_id) : null;
    const fields = E.fields;
    const show = (f, v) => fmtVal(f, v);
    if (r.action === 'delete') {
      body = `<p class="notice ng">このデータを削除するリクエストです。</p>${cur ? kvTable(fields, cur) : '<p class="muted">（すでに削除されています）</p>'}`;
    } else if (r.action === 'create') {
      body = `<p class="small muted">新しく追加される内容</p><div class="tbl-wrap"><table class="diff"><tbody>${fields.filter((f) => r.payload[f.k] != null && r.payload[f.k] !== '' && JSON.stringify(r.payload[f.k]) !== '[]' && JSON.stringify(r.payload[f.k]) !== '{}').map((f) => `<tr><th style="width:180px">${esc(f.l)}</th><td class="new">${show(f, r.payload[f.k])}</td></tr>`).join('')}</tbody></table></div>`;
    } else {
      const base = r.status === 'pending' ? cur : null;
      body = `<p class="small muted">${r.status === 'pending' ? '赤＝今の公開内容、緑＝変更後' : '変更した項目（緑＝送った内容）'}</p><div class="tbl-wrap"><table class="diff"><thead><tr><th>項目</th>${base ? '<th>今</th>' : ''}<th>変更後</th></tr></thead><tbody>${Object.keys(r.payload).map((k) => { const f = fields.find((x) => x.k === k) || { k, l: k, t: 'text' }; return `<tr><th style="width:180px">${esc(f.l)}</th>${base ? `<td class="old">${show(f, base?.[k])}</td>` : ''}<td class="new">${show(f, r.payload[k])}</td></tr>`; }).join('')}</tbody></table></div>`;
      if (r.status === 'pending' && !cur) body = '<p class="notice ng">対象のデータが見つかりません（削除された可能性があります）。</p>' + body;
    }
  }
  const mine = r.author_id === ME.id;
  const canEditAgain = mine && r.status === 'rejected' && r.entity !== 'batch' && r.action !== 'delete';
  $app.innerHTML = shell('requests', `
    <div class="crumb"><a href="#/requests">← リクエスト一覧</a></div>
    <h1 style="font-size:26px">${esc(r.title || '（無題）')}</h1>
    <p class="lead"><span class="pill ${r.status}">${STATUS_JA[r.status]}</span>　${r.entity === 'batch' ? '一括更新' : esc(ENT_LABEL[r.entity] || r.entity) + '・' + ACTION_JA[r.action]}　／　${esc(r.author_name || '')}　${fmtDT(r.created_at)}
      ${r.reviewed_at ? `　／　処理：${esc(r.reviewer_name || '')} ${fmtDT(r.reviewed_at)}` : ''}</p>
    ${r.comment && r.status !== 'pending' ? `<p class="notice ${r.status === 'rejected' ? 'ng' : 'ok'}">コメント：${esc(r.comment)}</p>` : ''}
    ${body}
    ${isAdmin() && r.status === 'pending' ? `
      <div class="card" style="margin-top:20px"><div class="f"><label for="cm">コメント（差し戻すときは理由を書いてください）</label><textarea id="cm" style="min-height:70px"></textarea></div>
      <div class="actions" style="border:0;padding-top:0;margin-top:14px"><button class="btn ok" id="ap">承認して公開</button><button class="btn ng" id="rj">差し戻す</button></div></div>` : ''}
    ${mine && r.status === 'pending' ? '<div class="actions"><button class="btn line" id="wd">このリクエストを取り下げる</button></div>' : ''}
    ${canEditAgain ? `<div class="actions"><a class="btn acc" href="#/edit/${r.entity}/${r.entity_id || 'new'}?from=${r.id}">修正して送り直す</a></div>` : ''}`);

  const ap = document.getElementById('ap'), rj = document.getElementById('rj'), wd = document.getElementById('wd');
  const review = async (ok) => {
    const cm = document.getElementById('cm').value.trim();
    if (!ok && !cm) { toast('差し戻す理由を書いてください', true); document.getElementById('cm').focus(); return; }
    ap.disabled = rj.disabled = true;
    try { await db.rpc('review_change', { p_request: r.id, p_approve: ok, p_comment: cm || null }); cache.clear(); toast(ok ? '承認しました（サイトへの反映まで数分かかります）' : '差し戻しました'); location.hash = '#/requests'; }
    catch (e) { toast(e.message, true); ap.disabled = rj.disabled = false; }
  };
  if (ap) { ap.onclick = () => review(true); rj.onclick = () => review(false); }
  if (wd) wd.onclick = async () => { if (!confirm('このリクエストを取り下げますか？')) return; await db.rpc('withdraw_change', { p_request: r.id }); toast('取り下げました'); location.hash = '#/requests'; };
}

function fmtVal(f, v) {
  if (v === null || v === undefined || v === '') return '<span class="muted">（空）</span>';
  switch (f.t) {
    case 'ref': return esc(cache.name(f.ref, v));
    case 'refs': return (v || []).map((x) => esc(cache.name(f.ref, x))).join('、') || '<span class="muted">（なし）</span>';
    case 'bool': return v ? 'はい' : 'いいえ';
    case 'select': return esc((f.opts.find(([a]) => a === v) || [, v])[1]);
    case 'image': return `<img src="${esc(v)}" alt="" style="max-width:160px;max-height:120px;display:block;margin-bottom:4px"><span class="small">${esc(v)}</span>`;
    case 'datetime': return esc(fmtDT(v));
    case 'date': return esc(fmtDate(v));
    case 'list': return (v || []).map(esc).join('<br>');
    case 'links': return Object.entries(v || {}).map(([k, u]) => `${esc(k)}: ${esc(u)}`).join('<br>');
    case 'pairs': return (v || []).map((x) => `${esc(x[f.a])} — ${esc(x[f.b])}`).join('<br>');
    case 'markdown': return `<div style="max-height:360px;overflow:auto">${renderMD(v)}</div>`;
    default: return esc(typeof v === 'object' ? JSON.stringify(v) : v);
  }
}
function kvTable(fields, row) {
  return `<div class="tbl-wrap"><table class="diff"><tbody>${fields.map((f) => `<tr><th style="width:180px">${esc(f.l)}</th><td class="same">${fmtVal(f, row[f.k])}</td></tr>`).join('')}</tbody></table></div>`;
}
async function batchDiff(r) {
  const items = r.payload.items || [];
  const isSt = items.some((i) => i.entity === 'standings');
  const stage = cache.data.tournament_stages?.find((s) => s.id === r.entity_id);
  const curRows = r.entity_id ? await db.select(isSt ? 'standings' : 'player_stats', `select=*&stage_id=eq.${r.entity_id}`) : [];
  const tname = (x) => (x.team_id ? cache.name('teams', x.team_id) : x.team_name || '');
  const head = isSt ? ['#', 'チーム', 'WWCD', '順位pt', 'キルpt', '合計', 'メモ'] : ['選手', 'チーム', 'マッチ', 'キル', '最多', 'マップ別'];
  const cells = (x) => isSt ? [x.rank, tname(x), x.wwcd, x.place_pts, x.kill_pts, x.total, x.note] : [cache.name('players', x.player_id), tname(x), x.matches, x.kills, x.max_kills, Object.entries(x.map_kills || {}).map(([m, v]) => `${m} ${v.matches ?? '-'}/${v.kills ?? '-'}`).join(' ')];
  const lab = { create: ['追加', 'new'], update: ['変更', 'new'], delete: ['削除', 'old'] };
  return `<p class="small muted">${stage ? esc(stage.name) + '　' : ''}${items.length}行の変更</p>
    <div class="tbl-wrap"><table class="diff"><thead><tr><th>操作</th>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
    ${items.map((it) => {
      const cur = curRows.find((x) => x.id === it.entity_id) || {};
      const merged = it.action === 'create' ? it.payload : { ...cur, ...it.payload };
      const changed = new Set(Object.keys(it.payload));
      const keys = isSt ? ['rank', 'team_id', 'wwcd', 'place_pts', 'kill_pts', 'total', 'note'] : ['player_id', 'team_id', 'matches', 'kills', 'max_kills', 'map_kills'];
      const cs = cells(merged);
      return `<tr><td><span class="pill ${it.action === 'delete' ? 'rejected' : 'approved'}">${lab[it.action][0]}</span></td>${cs.map((c, i) => {
        const k = keys[i]; const hl = it.action === 'update' && (changed.has(k) || (k === 'team_id' && changed.has('team_name')));
        const was = hl ? `<div class="small old">${esc(cells(cur)[i] ?? '')}</div>` : '';
        return `<td class="${it.action === 'delete' ? 'old' : hl || it.action === 'create' ? 'new' : 'same'}">${esc(c ?? '')}${was}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody></table></div>`;
}

/* ---------- メンバー（管理者） ---------- */
async function viewMembers() {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const rows = await db.select('profiles', 'select=*&order=created_at');
  $app.innerHTML = shell('members', `
    <h1>メンバー</h1>
    <p class="lead">管理者は承認なしで公開でき、投稿者のリクエストを承認できます。「停止」にするとログインしても使えなくなります。</p>
    <div class="tbl-wrap"><table><thead><tr><th>表示名</th><th>権限</th><th>登録日</th><th></th></tr></thead><tbody>
    ${rows.map((m) => `<tr data-id="${m.id}"><td><input type="text" value="${esc(m.display_name)}" aria-label="表示名" style="max-width:240px"></td>
      <td><select aria-label="権限"${m.id === ME.id ? ' disabled' : ''}>${[['admin', '管理者'], ['editor', '投稿者'], ['disabled', '停止']].map(([v, l]) => `<option value="${v}"${v === m.role ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
      <td class="small muted">${fmtDate(m.created_at)}</td><td style="text-align:right"><button class="btn line sm" data-act="save">保存</button></td></tr>`).join('')}
    </tbody></table></div>
    <h2>メンバーを招待するには</h2>
    <div class="card small" style="line-height:1.9">
      <ol style="margin:0;padding-left:20px">
        <li>Supabase の管理画面で、このプロジェクトの <b>Authentication → Users</b> を開きます。</li>
        <li>右上の <b>Add user → Send invitation</b> を押し、招待する人のメールアドレスを入れて送ります。</li>
        <li>届いたメールのリンクを開くと、この編集サイトでパスワードと表示名を決める画面が出ます。</li>
        <li>最初は「投稿者」として登録されます。管理者にする場合は、この画面で権限を変えてください。</li>
      </ol>
    </div>`);
  $app.querySelector('tbody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act=save]'); if (!b) return;
    const tr = b.closest('tr');
    try { await db.rpc('set_member', { p_user: tr.dataset.id, p_role: tr.querySelector('select').value, p_display_name: tr.querySelector('input').value.trim() }); toast('保存しました'); }
    catch (x) { toast(x.message, true); }
  });
}

/* ---------- アカウント ---------- */
function viewAccount() {
  $app.innerHTML = shell('account', `
    <h1>アカウント</h1>
    <div class="card" style="max-width:520px;display:flex;flex-direction:column;gap:20px">
      <form id="nf" class="f" style="gap:8px"><label for="dn">表示名（記者名）</label><div class="row"><input id="dn" type="text" value="${esc(ME.display_name)}" style="flex:1" required><button class="btn line">変更</button></div></form>
      <form id="pf" class="f" style="gap:8px"><label for="p1">新しいパスワード（8文字以上）</label><input id="p1" type="password" minlength="8" autocomplete="new-password" required><button class="btn line" style="align-self:flex-start">パスワードを変更</button></form>
      <div><button class="btn ng" id="lo">ログアウト</button></div>
    </div>`);
  document.getElementById('nf').onsubmit = async (e) => { e.preventDefault(); try { await db.rpc('set_my_name', { p_display_name: document.getElementById('dn').value.trim() }); ME = null; await loadMe(); toast('変更しました'); router(); } catch (x) { toast(x.message, true); } };
  document.getElementById('pf').onsubmit = async (e) => { e.preventDefault(); try { await Auth.updatePassword(document.getElementById('p1').value); toast('パスワードを変更しました'); e.target.reset(); } catch (x) { toast(x.message, true); } };
  document.getElementById('lo').onclick = logout;
}

/* =====================================================================
   起動
   ===================================================================== */
(function boot() {
  Auth.load();
  // 招待・パスワード再設定メールのリンクから来たとき（#access_token=...&type=invite）
  const hp = new URLSearchParams(location.hash.slice(1));
  if (hp.get('access_token')) {
    Auth.save({ access_token: hp.get('access_token'), refresh_token: hp.get('refresh_token'), expires_in: Number(hp.get('expires_in') || 3600) });
    AUTH_TYPE = ['invite', 'recovery', 'signup', 'magiclink'].includes(hp.get('type')) && hp.get('type') !== 'magiclink' ? hp.get('type') : null;
    if (AUTH_TYPE === 'signup') AUTH_TYPE = 'invite';
    history.replaceState(null, '', location.pathname + '#/' + (AUTH_TYPE ? 'set-password' : ''));
  } else if (hp.get('error_description')) {
    const msg = hp.get('error_description');
    history.replaceState(null, '', location.pathname + '#/login');
    setTimeout(() => toast(/expired/i.test(msg) ? 'リンクの有効期限が切れています。管理者に再送してもらうか、パスワード再設定をしてください。' : msg, true), 300);
  }
  window.addEventListener('hashchange', router);
  router();
})();
