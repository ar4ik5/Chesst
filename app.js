"use strict";
// Интерфейс, навигация, состояние партии, часы, профиль

const tg = (window.Telegram && window.Telegram.WebApp) || null;
if (tg) { try { tg.ready(); tg.expand(); if (tg.colorScheme) { document.documentElement.setAttribute('data-theme', tg.colorScheme); document.documentElement.setAttribute('data-scheme', tg.colorScheme); } } catch (e) {} }

function hap(t) { try { const h = tg && tg.HapticFeedback; if (!h) return; if (t === 'move') h.selectionChanged(); else if (t === 'cap') h.impactOccurred('light'); else if (t === 'warn') h.notificationOccurred('warning'); else if (t === 'ok') h.notificationOccurred('success'); else if (t === 'err') h.notificationOccurred('error'); } catch (e) {} }

const $ = q => document.querySelector(q);
const GL = { K:'\u265A', Q:'\u265B', R:'\u265C', B:'\u265D', N:'\u265E', P:'\u265F\uFE0E' };
const SAVE_KEY = 'chesstg:v1';
const PROF_KEY = 'chesstg:profile';

let G = null, gid = 0;
let menuCfg = { mode:'bot', side:'w', level:'2', tc:'600+0' };
let PROFILE = null, resignArmed = null;
let shopPacks = [];

const cur = () => G.states[G.states.length - 1];

/* ---------- НАВИГАЦИЯ ---------- */
function showTab(id) {
  document.querySelectorAll('.tab-page').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.toggle('active', el.dataset.tab === id));
  $(`#tab-${id}`).classList.remove('hidden');
  if (id === 'profile') renderProfileMain();
  if (id === 'home') updateHomeStats();
  if (id === 'shop') { $('#shopCoinBalance').textContent = (PROFILE?.coins || 0) + ' 💎'; renderShopPacks(); }
}
document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

/* ---------- UI: ОПЦИИ ---------- */
let currentOptKey = null;
function showOpts(title, key, options) {
  currentOptKey = key;
  $('#optTitle').textContent = title;
  const list = $('#optList'); list.innerHTML = '';
  for (const [val, label] of options) {
    const b = document.createElement('button');
    b.textContent = label;
    if (menuCfg[key] === val) b.style.color = 'var(--accent)';
    b.onclick = () => { menuCfg[key] = val; closeOpts(); updatePlayUI(); };
    list.appendChild(b);
  }
  $('#optSelect').classList.remove('hidden');
}
function closeOpts() { $('#optSelect').classList.add('hidden'); }

function updatePlayUI() {
  const modes = { bot:'Против бота', two:'Вдвоём (на 1 экране)' };
  const sides = { w:'Белые', b:'Чёрные', r:'Случайно' };
  const levels = { 1:'Лёгкий', 2:'Средний', 3:'Сильный', 4:'Мастер (Stockfish)' };
  $('#playModeText').textContent = modes[menuCfg.mode];
  $('#playSideText').textContent = sides[menuCfg.side];
  $('#playLevelText').textContent = levels[menuCfg.level];
  $('#playLevelBtn').style.opacity = menuCfg.mode === 'bot' ? '1' : '0.5';
  $('#playSideBtn').style.opacity = menuCfg.mode === 'bot' ? '1' : '0.5';
  document.querySelectorAll('.tc-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === menuCfg.tc));
}

$('#playModeBtn').addEventListener('click', () => showOpts('Режим', 'mode', [['bot','Против бота'], ['two','Вдвоём']]));
$('#playSideBtn').addEventListener('click', () => { if (menuCfg.mode === 'bot') showOpts('Ваш цвет', 'side', [['w','Белые'],['b','Чёрные'],['r','Случайно']]); });
$('#playLevelBtn').addEventListener('click', () => { if (menuCfg.mode === 'bot') showOpts('Сложность', 'level', [['1','Лёгкий'],['2','Средний'],['3','Сильный'],['4','Мастер (Stockfish)']]); });
document.querySelectorAll('.tc-seg button').forEach(b => b.addEventListener('click', () => { menuCfg.tc = b.dataset.v; updatePlayUI(); }));

$('#btnStartGame').addEventListener('click', () => { 
  try {
    newGame(menuCfg); 
    save(); 
  } catch (err) {
    alert("Ошибка в коде: " + err.message);
  }
});
$('#btnCloseGame').addEventListener('click', () => { $('#gameView').classList.add('hidden'); $('#bottomNav').classList.remove('hidden'); showTab('home'); stopOnline(); });

function startQuick(type) {
  if (type === 'bot') { menuCfg = { mode:'bot', side:'r', level:'2', tc:'600+0' }; } 
  else if (type === 'blitz') { menuCfg = { mode:'online', side:'r', level:'2', tc:'180+2' }; createOnline(); return; }
  updatePlayUI(); newGame(menuCfg);
}

/* ---------- ЧАСЫ ---------- */
function parseTc(str) { if (!str || str === '0') return null; const [b, i] = String(str).split('+').map(Number); if (!isFinite(b) || b <= 0) return null; return { base: Math.round(b * 1000), inc: Math.round((i || 0) * 1000) }; }
function startClock() { if (!G || !G.clock || G.over) return; stopClock(); G.clock.active = cur().turn; G.clock.last = Date.now(); G.clock.timer = setInterval(tickClock, 200); updateClocks(); }
function stopClock() { if (!G || !G.clock) return; if (G.clock.timer) { clearInterval(G.clock.timer); G.clock.timer = null; } }
function tickClock() { if (!G || !G.clock || G.over) { stopClock(); return; } const active = G.clock.active, elapsed = G.clock.last ? (Date.now() - G.clock.last) : 0; if (G.clock[active] - elapsed <= 0) { G.clock[active] = 0; stopClock(); const winner = active === 'w' ? 'b' : 'w'; G.over = { title:'Время', text:(active === 'w' ? 'Белые' : 'Чёрные') + ' просрочили время', winner }; hap('err'); saveHistory(); renderAll(); setTimeout(showEnd, 200); return; } updateClocks(); }
function updateClocks() { if (!G || !G.clock) return; const elapsed = G.clock.last ? (Date.now() - G.clock.last) : 0; const timeOf = c => G.clock[c] - (c === G.clock.active ? elapsed : 0); const fmt = ms => { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }; const topC = G.flip ? 'w' : 'b', botC = G.flip ? 'b' : 'w'; const set = (sel, c) => { const el = document.querySelector(sel); if (!el) return; const t = timeOf(c); el.textContent = fmt(t); el.classList.toggle('low', t < 30000); el.classList.toggle('active', c === G.clock.active && !G.over); el.classList.remove('hidden'); }; set('#topBar .who .time', topC); set('#botBar .who .time', botC); }
function hideClocks() { document.querySelectorAll('.pbar .who .time').forEach(e => e.classList.add('hidden')); }

/* ---------- ЛОГИКА ПАРТИИ ---------- */
function newGame(cfg, movesList, review, serverData) {
  gid++; stopOnline(); stopClock();
  const side = cfg.side === 'r' ? (Math.random() < .5 ? 'w' : 'b') : cfg.side;
  const tc = review ? null : parseTc(cfg.tc);
  const srvWhiteTime = serverData?.white_time_ms ?? (tc?.base || 0);
  const srvBlackTime = serverData?.black_time_ms ?? (tc?.base || 0);
  
  G = {
    cfg: { mode:cfg.mode, side, level:+cfg.level, tc:cfg.tc },
    states:[initState()], moves:[], sans:[],
    over:null, saved:false, review:!!review,
    flip: cfg.mode !== 'two' && side === 'b',
    sel:-1, legalFrom:[], tset:new Set(), thinking:false, lastPop:-1,
    tc, clock: tc ? { w: srvWhiteTime, b: srvBlackTime, active:'w', last: Date.now(), timer: null, isServer: cfg.mode === 'online' } : null,
    clockHist:[], lastElo:null
  };
  if (movesList) {
    for (const mm of movesList) {
      const m = legal(cur()).find(x => x.f === mm.f && x.t === mm.t && (x.promo || '') === (mm.promo || ''));
      if (!m) break;
      G.sans.push(toSAN(cur(), m)); G.states.push(apply(cur(), m)); G.moves.push(m);
      if (G.clock) G.clockHist.push({ w:G.clock.w, b:G.clock.b });
    }
    checkEnd();
  }
  setRv(!!review);
  $('#gameView').classList.remove('hidden');
  $('#bottomNav').classList.add('hidden');
  renderAll();
  if (G.clock && !review) startClock();
  maybeBot();
}

function checkEnd() {
  const s = cur(); if (G.over && G.over.resign) return; G.over = null;
  const ms = legal(s); const W = s.turn === 'w' ? 'Чёрные' : 'Белые';
  if (!ms.length) { if (inCheck(s, s.turn)) { const winner = s.turn === 'w' ? 'b' : 'w'; G.over = { title:'Мат', text:W + ' победили', winner }; } else G.over = { title:'Пат', text:'Ничья' }; }
  else if (s.half >= 100) G.over = { title:'Ничья', text:'50 ходов' };
  else if (insufficient(s.b)) G.over = { title:'Ничья', text:'Недостаточно материала' };
  else { const k = posKey(s); let n = 0; for (const x of G.states) if (posKey(x) === k) n++; if (n >= 3) G.over = { title:'Ничья', text:'Троекратное повторение' }; }
}

function save() { if (G && (G.review || G.cfg.mode === 'online')) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify({ cfg: { mode:G.cfg.mode, side:G.cfg.side, level:G.cfg.level, tc:G.cfg.tc }, moves: G.moves.map(m => ({ f:m.f, t:m.t, promo:m.promo || '' })), over: !!(G.over && G.over.resign), clock: G.clock ? { w:G.clock.w, b:G.clock.b, active:G.clock.active } : null })); } catch (e) {} }
function loadSaved() { try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return null; const d = JSON.parse(raw); return d && d.cfg && Array.isArray(d.moves) ? d : null; } catch (e) { return null; } }

function canInteract() { return G && !G.review && !G.over && !G.thinking && $('#promo').classList.contains('hidden') && (G.cfg.mode !== 'online' || (G.online && G.online.active)) && (G.cfg.mode === 'two' || cur().turn === G.cfg.side); }
function clearSel() { G.sel = -1; G.legalFrom = []; G.tset = new Set(); }
function select(sq) { G.sel = sq; G.legalFrom = legal(cur()).filter(m => m.f === sq); G.tset = new Set(G.legalFrom.map(m => m.t)); }
function onSq(sq) { if (!canInteract()) return; const s = cur(), p = s.b[sq]; if (G.sel >= 0) { const ms = G.legalFrom.filter(m => m.t === sq); if (ms.length) { if (ms[0].promo) { askPromo(ms); return; } commit(ms[0]); return; } } if (p && p[0] === s.turn && sq !== G.sel) { select(sq); } else clearSel(); renderBoard(); }
function askPromo(ms) { const col = cur().turn, box = $('#promoBtns'); box.innerHTML = ''; for (const q of ['Q','R','B','N']) { const b = document.createElement('button'); b.innerHTML = '<i class="pc ' + col + '">' + GL[q] + '</i>'; b.addEventListener('click', () => { $('#promo').classList.add('hidden'); commit(ms.find(m => m.promo === q)); }); box.appendChild(b); } $('#promo').classList.remove('hidden'); }

function commit(m) {
  const s = cur(), san = toSAN(s, m);
  G.states.push(apply(s, m)); G.moves.push(m); G.sans.push(san);
  G.lastPop = m.t; clearSel(); checkEnd();

  if (G.clock && G.cfg.mode !== 'online') {
    if (G.clock.last) G.clock[G.clock.active] -= (Date.now() - G.clock.last);
    G.clock[G.clock.active] = Math.max(0, G.clock[G.clock.active]);
    G.clock[G.clock.active] += G.tc.inc; G.clock.active = cur().turn; G.clock.last = Date.now();
    G.clockHist.push({ w:G.clock.w, b:G.clock.b });
    if (!G.clock.timer) startClock();
  }
  if (G.over) stopClock();
  if (G.over) { hap(G.over.winner && G.cfg.mode !== 'two' && G.over.winner !== G.cfg.side ? 'err' : 'ok'); saveHistory(); }
  else hap(inCheck(cur(), cur().turn) ? 'warn' : (m.cap ? 'cap' : 'move'));
  save();

  if (G.cfg.mode === 'online' && G.online && G.online.active) {
    const mv = sq2s(m.f) + sq2s(m.t) + (m.promo || '').toLowerCase();
    rpc('move', { id: G.online.id, move: mv }).then(res => {
      if (res) {
        if (res.white_time_ms !== undefined && G.clock) G.clock.w = res.white_time_ms;
        if (res.black_time_ms !== undefined && G.clock) G.clock.b = res.black_time_ms;
        if (G.clock) { G.clock.active = cur().turn; G.clock.last = Date.now(); }
        updateClocks();
        if (res.finished) { if (res.elo) G.lastElo = res.elo; if (!G.over) { G.over = { title:'Партия завершена', text:'Сервер: ' + (res.title || res.result), winner: res.result === 'd' ? undefined : res.result }; stopClock(); renderAll(); showEnd(); } loadProfile(); }
      }
    }).catch(err => note('Ход не отправлен: ' + err.message));
  }
  renderAll();
  if (G.over) setTimeout(showEnd, 450); else maybeBot();
}

let stockfish = null;
function initStockfish() { if (stockfish || !window.Stockfish) return; try { stockfish = Stockfish(); stockfish.onmessage = function(event) { const line = event.data || event; if (typeof line !== 'string') return; if (line.startsWith('bestmove')) { const move = line.split(' ')[1]; if (move && move !== '(none)') { const m = legal(cur()).find(x => sq2s(x.f) + sq2s(x.t) + (x.promo||'').toLowerCase() === move || sq2s(x.f) + sq2s(x.t) === move); if (m) { G.thinking = false; commit(m); } else { G.thinking = false; updateStatus(); } } } }; stockfish.postMessage('uci'); stockfish.postMessage('setoption name Skill Level value 20'); } catch (e) {} }

function maybeBot() {
  if (!G || G.over || G.cfg.mode !== 'bot' || cur().turn === G.cfg.side) return;
  G.thinking = true; updateStatus(); const my = gid;
  setTimeout(() => {
    if (my !== gid || !G) return;
    if (G.cfg.level === 4) { initStockfish(); if (stockfish) { stockfish.postMessage('position fen ' + buildFEN(cur())); stockfish.postMessage('go depth 10'); return; } }
    const m = bestMove(cur(), Math.min(G.cfg.level, 3));
    if (my !== gid) return; G.thinking = false;
    if (m) commit(m); else updateStatus();
  }, 380);
}

function buildFEN(s) { let fen = ''; for (let r = 0; r < 8; r++) { let empty = 0; for (let c = 0; c < 8; c++) { const p = s.b[r*8+c]; if (!p) { empty++; continue; } if (empty) { fen += empty; empty = 0; } fen += p[0] === 'w' ? p[1] : p[1].toLowerCase(); } if (empty) fen += empty; if (r < 7) fen += '/'; } fen += ' ' + s.turn; fen += ' ' + (s.cast.wK || s.cast.wQ || s.cast.bK || s.cast.bQ ? (s.cast.wK?'K':'')+(s.cast.wQ?'Q':'')+(s.cast.bK?'k':'')+(s.cast.bQ?'q':'') : '-'); fen += ' ' + (s.ep >= 0 ? sq2s(s.ep) : '-'); fen += ' ' + s.half + ' ' + s.full; return fen; }

function renderBoard() { const s = cur(), chk = inCheck(s, s.turn) && !G.over ? kingSq(s.b, s.turn) : (G.over && G.over.title === 'Мат' ? kingSq(s.b, s.turn) : -1); const last = G.moves.length ? G.moves[G.moves.length - 1] : null; let h = ''; for (let vi = 0; vi < 64; vi++) { const sq = G.flip ? 63 - vi : vi, r = sq >> 3, c = sq & 7, p = s.b[sq]; let cls = 'sq ' + (((r + c) & 1) ? 'd' : 'l'); if (last && (sq === last.f || sq === last.t)) cls += ' last'; if (sq === G.sel) cls += ' sel'; if (sq === chk) cls += ' chk'; if (G.tset.has(sq)) cls += (p || (G.legalFrom.find(m => m.t === sq && m.ep))) ? ' cap' : ' mv'; h += '<div class="' + cls + '" data-sq="' + sq + '">'; if ((vi & 7) === 0) h += '<span class="co r">' + (8 - r) + '</span>'; if ((vi >> 3) === 7) h += '<span class="co f">' + FILES[c] + '</span>'; if (p) h += '<i class="pc ' + p[0] + (sq === G.lastPop ? ' pop' : '') + '">' + GL[p[1]] + '</i>'; h += '</div>'; } $('#board').innerHTML = h; }
function updateStatus() { const el = $('#status'), s = cur(); el.className = ''; if (G.review) { el.textContent = 'Просмотр: ход ' + G.moves.length + ' из ' + G.rvFull.moves.length; return; } if (G.over) { el.textContent = G.over.title + (G.over.text ? '. ' + G.over.text : ''); if (G.over.title === 'Мат' || G.over.resign || G.over.title === 'Время') el.className = 'alert'; return; } if (G.thinking) { el.textContent = G.cfg.level === 4 ? 'Stockfish думает...' : 'Бот думает'; el.className = 'think'; return; } const chk = inCheck(s, s.turn); let t; if (G.cfg.mode === 'bot') t = 'Ваш ход'; else if (G.cfg.mode === 'online') t = (!G.online || !G.online.active) ? 'Ждём соперника' : (s.turn === G.cfg.side ? 'Ваш ход' : 'Ход соперника'); else t = 'Ход ' + (s.turn === 'w' ? 'белых' : 'чёрных'); el.textContent = (chk ? 'Шах! ' : '') + t; if (chk) el.className = 'alert'; }
function renderBars() { const s = cur(), topC = G.flip ? 'w' : 'b', botC = G.flip ? 'b' : 'w'; const start = { P:8, N:2, B:2, R:2, Q:1 }; const have = { w:{P:0,N:0,B:0,R:0,Q:0}, b:{P:0,N:0,B:0,R:0,Q:0} }; const mat = { w:0, b:0 }; for (const p of s.b) { if (p && p[1] !== 'K') { have[p[0]][p[1]]++; mat[p[0]] += VAL[p[1]]; } } const names = c => { if (G.cfg.mode === 'two') return c === 'w' ? 'Белые' : 'Чёрные'; if (G.cfg.mode === 'online') return c === G.cfg.side ? (displayName() || 'Вы') : ((G.online && G.online.oppName) || 'Соперник'); if (c === G.cfg.side) return displayName() || 'Вы'; return 'Бот · ' + ({1:'лёгкий', 2:'средний', 3:'сильный', 4:'Stockfish'}[G.cfg.level]); }; for (const [id, c] of [['#topBar', topC], ['#botBar', botC]]) { const el = $(id), opp = c === 'w' ? 'b' : 'w'; el.querySelector('.chip').className = 'chip ' + c; el.querySelector('.nm').textContent = names(c); let g = ''; for (const t of ['Q','R','B','N','P']) { const n = Math.max(0, start[t] - have[opp][t]); for (let i = 0; i < n; i++) g += '<i class="g ' + opp + '">' + GL[t] + '</i>'; } const diff = mat[c] - mat[opp]; if (diff > 0) g += '<em>+' + Math.round(diff / 100) + '</em>'; el.querySelector('.caps').innerHTML = g; } }
function renderMoves() { let h = ''; G.sans.forEach((x, i) => { if (i % 2 === 0) h += '<span class="n">' + (i / 2 + 1) + '.</span>'; h += (i === G.sans.length - 1 ? '<b>' + x + '</b>' : x) + ' '; }); const el = $('#moves'); el.innerHTML = h || 'Ходов пока нет'; el.scrollLeft = el.scrollWidth; }
function renderTools() { const bot = G.cfg.mode === 'bot', min = bot && G.cfg.side === 'b' ? 1 : 0; $('#btnUndo').disabled = G.moves.length <= min || G.thinking || G.cfg.mode === 'online'; $('#btnResign').disabled = !!G.over; }
function renderAll() { renderBoard(); renderBars(); renderMoves(); updateStatus(); renderTools(); if (G.clock && !G.review) updateClocks(); else hideClocks(); G.lastPop = -1; }

function showEnd() {
  if (!G || !G.over) return; let title = G.over.title, text = G.over.text || '';
  if (G.cfg.mode !== 'two' && G.over.winner) { title = G.over.winner === G.cfg.side ? 'Вы победили!' : 'Победил ' + (G.cfg.mode === 'bot' ? 'бот' : 'соперник'); text = G.over.title === 'Мат' ? 'Мат на ' + Math.ceil(G.moves.length / 2) + '-м ходу' : text; }
  $('#endTitle').textContent = title; $('#endText').textContent = text;
  const eloLine = $('#endElo'); eloLine.textContent = '';
  if (G.lastElo && G.cfg.mode === 'online') { const mine = G.cfg.side === 'w' ? G.lastElo.white : G.lastElo.black; if (mine) { const sign = mine.delta > 0 ? '+' : ''; eloLine.textContent = 'Рейтинг: ' + mine.before + ' → ' + mine.after + ' (' + sign + mine.delta + ')'; eloLine.style.color = mine.delta > 0 ? 'var(--st-live)' : (mine.delta < 0 ? 'var(--destructive)' : 'var(--text-hint)'); } }
  
  const endSheet = document.querySelector('#end .sheet'); let reviewBtn = document.querySelector('#btnReviewGame');
  if (!reviewBtn) { reviewBtn = document.createElement('button'); reviewBtn.id = 'btnReviewGame'; reviewBtn.className = 'cta alt'; reviewBtn.textContent = '🔍 Разобрать партию'; reviewBtn.style.marginTop = '12px'; endSheet.insertBefore(reviewBtn, document.querySelector('#btnAgain')); }
  if (G.cfg.mode === 'online' || G.cfg.mode === 'bot') { reviewBtn.classList.remove('hidden'); reviewBtn.onclick = () => { const moves = G.moves.slice(); const sans = G.sans.slice(); const color = G.cfg.side; document.querySelector('#end').classList.add('hidden'); showReview(moves, sans, color); }; } else { reviewBtn.classList.add('hidden'); }
  $('#end').classList.remove('hidden');
}

$('#board').addEventListener('click', e => { const el = e.target.closest('.sq'); if (el) onSq(+el.dataset.sq); });
$('#btnFlip').addEventListener('click', () => { G.flip = !G.flip; renderBoard(); renderBars(); updateClocks(); });
$('#btnUndo').addEventListener('click', () => { if (!G || G.thinking || G.cfg.mode === 'online') return; const bot = G.cfg.mode === 'bot', min = bot && G.cfg.side === 'b' ? 1 : 0; if (G.moves.length <= min) return; let n = bot ? (cur().turn === G.cfg.side ? 2 : 1) : 1; n = Math.min(n, G.moves.length - min); stopClock(); for (let i = 0; i < n; i++) { G.states.pop(); G.moves.pop(); G.sans.pop(); if (G.clock) { const prev = G.clockHist.pop(); if (prev) { G.clock.w = prev.w; G.clock.b = prev.b; } } } G.over = null; G.saved = false; G.lastElo = null; clearSel(); gid++; save(); renderAll(); if (G.clock) startClock(); maybeBot(); });
$('#btnResign').addEventListener('click', () => { if (!G || G.over) return; const b = $('#btnResign'); if (!resignArmed) { b.classList.add('warn'); b.querySelector('span').textContent = 'Точно?'; resignArmed = setTimeout(disarm, 3000); return; } disarm(); const loser = G.cfg.mode !== 'two' ? G.cfg.side : cur().turn; const winner = loser === 'w' ? 'b' : 'w'; G.over = { title:'Сдача', text:(loser === 'w' ? 'Белые' : 'Чёрные') + ' сдались', winner, resign:true }; gid++; G.thinking = false; stopClock(); saveHistory(); if (G.cfg.mode === 'online' && G.online) { rpc('resign', { id: G.online.id }).then(res => { if (res && res.elo) { G.lastElo = res.elo; loadProfile(); renderAll(); } }).catch(() => {}); } save(); renderAll(); showEnd(); });
function disarm() { clearTimeout(resignArmed); resignArmed = null; const b = $('#btnResign'); b.classList.remove('warn'); b.querySelector('span').textContent = 'Сдаться'; }

$('#btnAgain').addEventListener('click', () => { $('#end').classList.add('hidden'); $('#gameView').classList.add('hidden'); $('#bottomNav').classList.remove('hidden'); showTab('play'); });
$('#btnView').addEventListener('click', () => $('#end').classList.add('hidden'));

/* ---------- ПРОФИЛЬ ---------- */
const TIERS = [ { min:0, name:'Новичок', color:'var(--text-hint)' }, { min:800, name:'Ученик', color:'#5C9BD6' }, { min:1000, name:'Любитель', color:'#4FB4D3' }, { min:1200, name:'Игрок', color:'#2AABEE' }, { min:1400, name:'Опытный', color:'#39B08A' }, { min:1600, name:'Эксперт', color:'#B585E0' }, { min:1800, name:'Кандидат', color:'#E0A85C' }, { min:2000, name:'Мастер', color:'#F0B23A' }, { min:2200, name:'Гроссмейстер', color:'#FF6B6B' } ];
function tierOf(elo) { let t = TIERS[0]; for (const x of TIERS) if (elo >= x.min) t = x; return t; }
function displayName() { if (PROFILE) return PROFILE.display_name || PROFILE.first_name || 'Игрок'; return userName(); }
function userName() { const U = tg && tg.initDataUnsafe && tg.initDataUnsafe.user; return U && U.first_name ? U.first_name : 'Вы'; }
function updateHomeStats() { if (!PROFILE) return; $('#homeElo').textContent = PROFILE.elo; $('#homeStreak').textContent = PROFILE.current_streak || 0; $('#coinBalance').textContent = PROFILE.coins || 0; }

async function loadProfile() { if (!isTelegram()) return null; try { const p = await rpc('profile_get'); PROFILE = p; lsSet(PROF_KEY, JSON.stringify(p)); renderProfileMini(); renderProfileMain(); updateHomeStats(); return p; } catch (e) { const raw = lsGet(PROF_KEY); if (raw) { try { PROFILE = JSON.parse(raw); renderProfileMini(); renderProfileMain(); updateHomeStats(); } catch (x) {} } return null; } }
function renderProfileMini() { const el = $('#homeMiniAvatar'); if (!el) return; if (PROFILE && PROFILE.photo_url) el.innerHTML = '<img src="' + PROFILE.photo_url + '" alt="">'; else { const n = displayName(); el.textContent = (n[0] || '?').toUpperCase(); } }

function renderProfileMain() {
  const box = $('#profileContent');
  if (!isTelegram()) { box.innerHTML = `<div class="prof-header-main"><div class="prof-avatar-large">?</div><div class="prof-name-large">Гость</div><div class="prof-rank-large" style="color:var(--text-hint)">Без рейтинга</div><p class="sub" style="text-align:center">Откройте приложение в Telegram, чтобы получить профиль.</p><button class="cta" onclick="window.open('${window.CFG.BOT_LINK}','_blank')">Открыть в Telegram</button></div>`; return; }
  if (!PROFILE) { box.innerHTML = '<p class="sub" style="text-align:center;margin-top:40px">Загрузка...</p>'; loadProfile(); return; }
  const p = PROFILE, t = tierOf(p.elo), name = displayName(); const total = p.wins + p.losses + p.draws;
  box.innerHTML = `
    <div class="prof-header-main"><div class="prof-avatar-large">${p.photo_url ? `<img src="${p.photo_url}">` : (name[0] || '?').toUpperCase()}</div><div class="prof-name-large">${name}</div><div class="prof-rank-large" style="color:${t.color}">${t.name} • ${p.elo} Elo</div></div>
    <div class="prof-stats-grid"><div class="ps-box"><b>${total}</b><span>Игр</span></div><div class="ps-box win"><b>${p.wins}</b><span>Побед</span></div><div class="ps-box draw"><b>${p.draws}</b><span>Ничьих</span></div><div class="ps-box loss"><b>${p.losses}</b><span>Пораж.</span></div></div>
    <div class="section-title">История партий</div><div id="profHistory" style="margin-bottom:24px"><p class="sub" style="text-align:center">Загрузка...</p></div>
    <div style="width:100%;margin-bottom:16px"><button class="cta alt" onclick="editProfileName()">✏️ Изменить имя</button></div>
    <div class="section-title" style="margin-top:24px">Уведомления</div>
    <div id="notifySettings" style="margin-bottom:24px">
      <div class="option-row" style="margin-bottom:8px;cursor:pointer" onclick="toggleNotify('notify_move')"><span class="opt-icon">♟</span><span class="opt-text">Ход соперника</span><span class="opt-arrow" id="notify_move_state">…</span></div>
      <div class="option-row" style="margin-bottom:8px;cursor:pointer" onclick="toggleNotify('notify_invite')"><span class="opt-icon">⚔️</span><span class="opt-text">Приглашения на партию</span><span class="opt-arrow" id="notify_invite_state">…</span></div>
      <div class="option-row" style="cursor:pointer" onclick="toggleNotify('notify_finish')"><span class="opt-icon">🏆</span><span class="opt-text">Завершение партии</span><span class="opt-arrow" id="notify_finish_state">…</span></div>
    </div>
  `;
  loadHistoryInProfile(); loadNotificationSettings();
}

async function loadHistoryInProfile() { if (!isTelegram()) return; try { const list = await rpc('history', { limit: 10 }); const box = $('#profHistory'); if (!list || !list.length) { box.innerHTML = '<p class="sub" style="text-align:center">Вы еще не сыграли ни одной партии.</p>'; return; } let html = ''; for (const g of list) { const isWhite = g.white_id === PROFILE.id; const result = g.result; let resColor = 'var(--text-hint)', resSign = '='; if (result === 'd') { resColor = 'var(--text-hint)'; resSign = '½'; } else if ((result === 'w' && isWhite) || (result === 'b' && !isWhite)) { resColor = 'var(--st-live)'; resSign = '+'; } else { resColor = 'var(--destructive)'; resSign = '-'; } const oppName = isWhite ? (g.black_name || 'Соперник') : (g.white_name || 'Соперник'); const oppElo = isWhite ? (g.black_elo || '?') : (g.white_elo || '?'); html += `<div class="option-row" style="padding:12px;margin-bottom:8px;cursor:pointer" onclick="openHistoryReview('${g.id}')"><div style="width:24px;height:24px;border-radius:50%;background:${resColor};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;margin-right:12px">${resSign}</div><div style="flex:1"><div style="font-size:14px;font-weight:600">${oppName} (${oppElo})</div><div style="font-size:12px;color:var(--text-hint)">${g.time_control || 'Без часов'}</div></div></div>`; } box.innerHTML = html; } catch(e) { const box = $('#profHistory'); if (box) box.innerHTML = '<p class="sub" style="text-align:center">Не удалось загрузить историю</p>'; } }

window.openHistoryReview = async (gameId) => { try { const g = await rpc('get', { id: gameId }); if (!g || !g.moves) { note('Партия пуста'); return; } const moves = parseMoves(g.moves); const states = [initState()]; const sans = []; for (const mm of moves) { const s = states[states.length - 1]; const lm = legal(s).find(x => x.f === mm.f && x.t === mm.t && (x.promo || '') === (mm.promo || '')); if (!lm) break; sans.push(toSAN(s, lm)); states.push(apply(s, lm)); } const myColor = String(g.white_id) === String(PROFILE.id) ? 'w' : 'b'; showReview(moves, sans, myColor); } catch (e) { note('Не удалось загрузить: ' + e.message); } };
window.editProfileName = async () => { const old = displayName(); const v = prompt('Введите новое имя (2-30 символов):', old); if (!v || v.trim().length < 2) return; try { const p = await rpc('profile_update', { patch: { display_name: v.trim() } }); PROFILE = p; lsSet(PROF_KEY, JSON.stringify(p)); renderProfileMain(); renderProfileMini(); hap('ok'); } catch (e) { note('Ошибка: ' + e.message); } };

let NOTIFY = null;
async function loadNotificationSettings() { if (!isTelegram()) return; try { NOTIFY = await rpc("notifications_get"); renderNotifyStates(); } catch (e) {} }
function renderNotifyStates() { if (!NOTIFY) return; const set = (key) => { const el = $('#notify_' + key + '_state'); if (!el) return; el.textContent = NOTIFY[key] ? '✅' : '❌'; el.style.color = NOTIFY[key] ? 'var(--st-live)' : 'var(--text-hint)'; }; set("notify_move"); set("notify_invite"); set("notify_finish"); }
window.toggleNotify = async (key) => { if (!NOTIFY) return; const patch = {}; patch[key] = !NOTIFY[key]; try { NOTIFY = await rpc("notifications_set", { patch }); renderNotifyStates(); hap('ok'); } catch (e) { note("Не удалось сохранить: " + e.message); } };

/* ---------- МАГАЗИН ---------- */
async function renderShopPacks() { const box = $('#shopPacks'); if (!shopPacks.length) { try { shopPacks = await rpc('packs', {}, 'payments'); } catch(e) { box.innerHTML = '<p class="sub">Не удалось загрузить магазин.</p>'; return; } } box.innerHTML = ''; for (const p of shopPacks) { const el = document.createElement('div'); el.className = 'pack-card'; el.innerHTML = `<div class="pack-info"><b>${p.coins} 💎</b><span>${p.title}</span></div><div class="pack-price">${p.stars} ⭐</div>`; el.onclick = () => buyPack(p.id); box.appendChild(el); } }
async function buyPack(packId) { if (!isTelegram()) { note('Покупка доступна только в Telegram'); return; } try { const res = await rpc('create_invoice', { pack: packId }, 'payments'); if (res && res.link) { if (tg && tg.openInvoice) { tg.openInvoice(res.link, (status) => { if (status === 'paid') { note('Оплата прошла успешно! Монеты зачислены.'); loadProfile(); } else if (status === 'failed') { note('Оплата не прошла'); } }); } else { window.open(res.link, '_blank'); } } } catch (e) { note('Ошибка: ' + e.message); } }

/* ---------- СЕТЬ ---------- */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
function note(msg) { try { if (tg && tg.showAlert) { tg.showAlert(msg); return; } } catch (e) {} alert(msg); }
function onlineReady() { const c = window.CFG || {}; return !!(c.SUPA_URL && c.SUPA_KEY && c.BOT_LINK); }
function fnUrl(fn) { return (window.CFG.SUPA_URL || '') + '/functions/v1/' + (fn || 'game'); }
function initData() { return (tg && tg.initData) || ''; }
function isTelegram() { return !!(tg && tg.initData && tg.initData.length > 0); }
function sq2s(i) { return FILES[i & 7] + (8 - (i >> 3)); }

async function rpc(op, payload, fn) {
  payload = payload || {};
  const r = await fetch(fnUrl(fn), { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': window.CFG.SUPA_KEY, 'Authorization': 'Bearer ' + window.CFG.SUPA_KEY }, body: JSON.stringify(Object.assign({ op: op, initData: initData() }, payload)) });
  const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) throw new Error((data && data.error) || text || ('HTTP ' + r.status));
  return data;
}

function parseMoves(str) { return str ? str.split(' ').filter(Boolean).map(x => ({ f: FILES.indexOf(x[0]) + (8 - (+x[1])) * 8, t: FILES.indexOf(x[2]) + (8 - (+x[3])) * 8, promo: x[4] ? x[4].toUpperCase() : '' })) : []; }
function stopOnline() { if (G && G.online) { if (G.online.timer) clearInterval(G.online.timer); if (G.online.channel) G.online.channel.unsubscribe(); G.online = null; } }
function applyRemote(list) { let changed = false; for (let i = G.moves.length; i < list.length; i++) { const mm = list[i]; const m = legal(cur()).find(x => x.f === mm.f && x.t === mm.t && (x.promo || '') === (mm.promo || '')); if (!m) break; G.sans.push(toSAN(cur(), m)); G.states.push(apply(cur(), m)); G.moves.push(m); G.lastPop = m.t; changed = true; } if (!changed) return; clearSel(); checkEnd(); if (G.over) { hap(G.over.winner && G.over.winner !== G.cfg.side ? 'err' : 'ok'); saveHistory(); setTimeout(showEnd, 450); } else hap(inCheck(cur(), cur().turn) ? 'warn' : 'move'); if (G.clock && !G.over) startClock(); renderAll(); }

async function pollOnline() { const O = G && G.online; if (!O || O.busy) return; O.busy = true; try { const r = await rpc('get', { id: O.id }); if (!G || G.online !== O || !r) return; if (!O.active && r.status !== 'waiting') { O.active = true; O.oppName = (O.color === 'w' ? r.black_name : r.white_name) || 'Соперник'; $('#wait').classList.add('hidden'); hap('ok'); if (G.clock && !G.clock.timer) startClock(); } if (G.clock && r.white_time_ms != null && r.black_time_ms != null) { const serverTurn = r.moves ? (r.moves.split(' ').filter(Boolean).length % 2 === 0 ? 'w' : 'b') : 'w'; G.clock.w = r.white_time_ms; G.clock.b = r.black_time_ms; G.clock.active = serverTurn; G.clock.last = Date.now(); updateClocks(); } const list = parseMoves(r.moves || ''); if (list.length > G.moves.length) applyRemote(list); if (r.status === 'finished' && !G.over) { const result = r.result; G.over = { title:'Партия завершена', text:'Результат: ' + (result === 'd' ? 'ничья' : (result === 'w' ? 'белые' : 'чёрные')), winner: result === 'd' ? undefined : result }; if (r.white_elo_delta != null || r.black_elo_delta != null) { const dW = r.white_elo_delta || 0, dB = r.black_elo_delta || 0; G.lastElo = { white:{delta:dW,after:null,before:null}, black:{delta:dB,after:null,before:null} }; } stopClock(); saveHistory(); renderAll(); showEnd(); loadProfile(); } if (r.status === 'finished' && G.over) { stopOnline(); lsSet('chesstg:online', null); } renderBars(); updateStatus(); } catch (e) {} finally { O.busy = false; } }

function showWait() { $('#waitLink').textContent = gameLink(G.online.id); $('#wait').classList.remove('hidden'); }

function startOnline(g, color) {
  newGame({ mode:'online', side:color, level:2, tc:menuCfg.tc }, null, false, g);
  const O = G.online = { id:g.id, color, active:g.status !== 'waiting', oppName:(color === 'w' ? g.black_name : g.white_name) || '', timer:null, busy:false };
  lsSet('chesstg:online', g.id);
  const list = parseMoves(g.moves || ''); if (list.length) applyRemote(list);
  renderAll(); if (!O.active) showWait();
  if (window.supabase) {
    const sb = window.supabase.createClient(window.CFG.SUPA_URL, window.CFG.SUPA_KEY);
    O.channel = sb.channel('game_' + g.id).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${g.id}` }, payload => {
      if (!payload.new) return;
      if (G.clock && payload.new.white_time_ms != null) { G.clock.w = payload.new.white_time_ms; G.clock.b = payload.new.black_time_ms; G.clock.last = Date.now(); const serverTurn = payload.new.moves.split(' ').filter(Boolean).length % 2 === 0 ? 'w' : 'b'; G.clock.active = serverTurn; updateClocks(); }
      if (payload.new.moves && payload.new.moves.length > G.moves.length) applyRemote(parseMoves(payload.new.moves));
      if (payload.new.status === 'finished' && !G.over) pollOnline();
    }).subscribe();
  } else { O.timer = setInterval(pollOnline, 1500); pollOnline(); }
}

async function createOnline() { const side = menuCfg.side === 'r' ? (Math.random() < .5 ? 'w' : 'b') : menuCfg.side; try { const g = await rpc('create', { color: side, tc: menuCfg.tc }); startOnline(g, g.color); } catch(e) { if (e.message === 'rate_limit') note('Слишком много партий. Подождите 10 минут.'); else note(e.message); } }
async function joinOnline(id) { if (!onlineReady()) { note('Онлайн-игра не настроена'); return; } try { const g = await rpc('join', { id: id }); startOnline(g, g.color); } catch (e) { note(e.message === 'full' ? 'В этой партии уже играют двое' : (e.message === 'not_found' ? 'Партия не найдена' : 'Не удалось подключиться')); lsSet('chesstg:online', null); } }

function gameLink(id) { return window.CFG.BOT_LINK + '?startapp=g_' + id; }
function shareLink() { const link = gameLink(G.online.id); const u = 'https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('Сыграем в шахматы?'); try { if (tg && tg.openTelegramLink) { tg.openTelegramLink(u); return; } } catch (e) {} window.open(u, '_blank'); }

$('#btnFindMatch').addEventListener('click', () => { if (!onlineReady()) { note('Онлайн-игра ещё не настроена'); return; } if (menuCfg.tc === '0') { note('Выберите контроль времени (3+2, 10+0)'); return; } findMatch(menuCfg.tc); });
$('#btnInvite').addEventListener('click', () => { if (!onlineReady()) { note('Онлайн-игра ещё не настроена'); return; } if (!isTelegram()) { note('Онлайн-партии доступны только в Telegram'); return; } createOnline(); });
$('#btnWaitShare').addEventListener('click', shareLink);
$('#btnWaitClose').addEventListener('click', () => { $('#wait').classList.add('hidden'); stopOnline(); $('#gameView').classList.add('hidden'); $('#bottomNav').classList.remove('hidden'); showTab('play'); });

/* ---------- МАТЧМЕЙКИНГ UI ---------- */
let MM = null;
async function findMatch(tc) { if (!isTelegram()) { note('Матчмейкинг доступен только в Telegram'); return; } $('#wait').classList.add('hidden'); showMatchmakingScreen(tc); MM = { tc, cancelled: false, timer: null }; try { const res = await rpc('enqueue', { tc }, 'matchmaking'); if (res.status === 'matched') { stopMatchmakingScreen(); startOnline(res.game, res.game.color); return; } } catch (e) { stopMatchmakingScreen(); note(e.message === 'rate_limit' ? 'Слишком много попыток. Подождите минуту.' : e.message); return; } MM.timer = setInterval(async () => { if (!MM || MM.cancelled) return; try { const res = await rpc('poll', { tc }, 'matchmaking'); if (res.status === 'matched') { stopMatchmakingScreen(); startOnline(res.game, res.game.color); } else if (res.status === 'cancelled') { stopMatchmakingScreen(); } else if (res.status === 'waiting') { updateMatchmakingTimer(res.wait_seconds); } } catch (e) {} }, 2000); }
function showMatchmakingScreen(tc) { const sheet = document.createElement('div'); sheet.id = 'mmSheet'; sheet.className = 'overlay'; sheet.innerHTML = `<div class="sheet" style="text-align:center"><div style="font-size:48px;margin-bottom:12px">🔍</div><h2>Ищем соперника</h2><p class="sub" id="mmTimer">0:00</p><p class="sub" style="margin:0;font-size:13px">Контроль: ${formatTc(tc)}</p><button class="cta alt" style="margin-top:20px" onclick="cancelMatchmaking()">Отмена</button></div>`; document.body.appendChild(sheet); }
function formatTc(tc) { if (tc === '0') return '∞ без часов'; const [b, i] = tc.split('+'); return `${b}+${i || 0}`; }
function updateMatchmakingTimer(seconds) { const el = $('#mmTimer'); if (!el) return; const m = Math.floor(seconds / 60); const s = seconds % 60; el.textContent = m + ':' + String(s).padStart(2, '0'); }
async function cancelMatchmaking() { if (MM) { MM.cancelled = true; if (MM.timer) clearInterval(MM.timer); try { await rpc('cancel', {}, 'matchmaking'); } catch (e) {} MM = null; } stopMatchmakingScreen(); }
function stopMatchmakingScreen() { const el = $('#mmSheet'); if (el) el.remove(); if (MM && MM.timer) { clearInterval(MM.timer); MM.timer = null; } MM = null; }

/* ---------- СТАРТ ---------- */
(function init() {
  updatePlayUI();
  const cached = lsGet(PROF_KEY); if (cached) { try { PROFILE = JSON.parse(cached); renderProfileMini(); updateHomeStats(); } catch (e) {} }
  loadProfile();
  const sv = loadSaved();
  const sp = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
  if (sp && sp.indexOf('g_') === 0) joinOnline(sp.slice(2));
  else if (sp === 'profile') showTab('profile');
})();