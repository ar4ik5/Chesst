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

$('#btnStartGame').addEventListener('click', () => { newGame(menuCfg); save(); });
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
  gid++; stopOnline(); stopClock