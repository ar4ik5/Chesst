"use strict";
let rvEngine = null;
let rvResolve = null;
let rvLastScore = 0;
let rvCurrentTurn = 'w';

function rvInitEngine() {
  if (rvEngine) return;
  if (!window.Stockfish) return;
  rvEngine = Stockfish();
  rvEngine.onmessage = function(event) {
    const line = event.data || event;
    if (typeof line !== 'string') return;
    if (line.startsWith('info depth') && line.includes(' score ')) {
      const cp = line.match(/score cp (-?\d+)/);
      const mate = line.match(/score mate (-?\d+)/);
      if (cp) {
        const score = parseInt(cp[1], 10);
        const turn = currentTurnForReview();
        const normalized = turn === 'w' ? score : -score;
        rvLastScore = normalized;
      } else if (mate) {
        const m = parseInt(mate[1], 10);
        const turn = currentTurnForReview();
        const value = m > 0 ? 100000 - m * 100 : -100000 - m * 100;
        rvLastScore = turn === 'w' ? value : -value;
      }
    }
    if (line.startsWith('bestmove')) {
      const best = line.split(' ')[1];
      if (rvResolve) { rvResolve({ best, score: rvLastScore }); rvResolve = null; }
    }
  };
  rvEngine.postMessage('uci');
  rvEngine.postMessage('setoption name Threads value 1');
  rvEngine.postMessage('setoption name Hash value 16');
}

function currentTurnForReview() { return rvCurrentTurn; }

function analyzePosition(fen, depth = 12) {
  return new Promise((resolve) => {
    if (!rvEngine) rvInitEngine();
    if (!rvEngine) { resolve({ best: null, score: 0 }); return; }
    const parts = fen.split(' ');
    rvCurrentTurn = parts[1] || 'w';
    rvLastScore = 0;
    rvResolve = resolve;
    rvEngine.postMessage('position fen ' + fen);
    rvEngine.postMessage('go depth ' + depth);
    setTimeout(() => {
      if (rvResolve) { rvResolve({ best: null, score: rvLastScore }); rvResolve = null; }
    }, 5000);
  });
}

function classifyMove(prevScore, newScore, isWhiteMove) {
  let loss = isWhiteMove ? (prevScore - newScore) : (newScore - prevScore);
  if (loss < -100) return { type: 'brilliant', label: '!!', color: '#7BD882' };
  if (loss > 300) return { type: 'blunder', label: '??', color: '#E85050' };
  if (loss > 150) return { type: 'mistake', label: '?', color: '#E89E50' };
  if (loss > 50) return { type: 'inaccuracy', label: '?!', color: '#E8D050' };
  return { type: 'good', label: '', color: 'var(--text-hint)' };
}

function calculateAccuracy(moves) {
  if (!moves.length) return 0;
  let sum = 0;
  for (const m of moves) {
    const wp = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * m.loss)) - 1);
    sum += Math.max(0, Math.min(100, wp));
  }
  return Math.round(sum / moves.length);
}

async function analyzeGame(movesList, sansList, playerColor) {
  const results = [];
  const evals = [];
  const states = [initState()];
  for (let i = 0; i < movesList.length; i++) {
    states.push(apply(states[states.length - 1], movesList[i]));
  }
  const total = movesList.length;

  for (let i = 0; i < total; i++) {
    const fenBefore = buildFENForReview(states[i]);
    const isWhiteMove = states[i].turn === 'w';
    const resBefore = await analyzePosition(fenBefore, 12);
    const scoreBefore = resBefore.score;
    const fenAfter = buildFENForReview(states[i + 1]);
    const resAfter = await analyzePosition(fenAfter, 12);
    const scoreAfter = resAfter.score;
    const cls = classifyMove(scoreBefore, scoreAfter, isWhiteMove);
    const loss = isWhiteMove ? Math.max(0, scoreBefore - scoreAfter) : Math.max(0, scoreAfter - scoreBefore);

    results.push({
      index: i, san: sansList[i] || '', loss, type: cls.type, label: cls.label, color: cls.color,
      scoreBefore, scoreAfter, bestMove: resBefore.best, fenBefore, isWhiteMove,
    });
    evals.push({ move: i, eval: scoreAfter });

    const percent = Math.round(((i + 1) / total) * 100);
    const el = document.querySelector('#rvProgress');
    const elT = document.querySelector('#rvProgressText');
    if (el) el.style.width = percent + '%';
    if (elT) elT.textContent = percent + '%';
  }

  const myMoves = results.filter(m => (m.isWhiteMove && playerColor === 'w') || (!m.isWhiteMove && playerColor === 'b'));
  const acc = calculateAccuracy(myMoves);
  const stats = {
    blunders: myMoves.filter(m => m.type === 'blunder').length,
    mistakes: myMoves.filter(m => m.type === 'mistake').length,
    inaccuracies: myMoves.filter(m => m.type === 'inaccuracy').length,
    brilliants: myMoves.filter(m => m.type === 'brilliant').length,
  };
  return { results, evals, accuracy: acc, stats };
}

function buildFENForReview(s) {
  let fen = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = s.b[r * 8 + c];
      if (!p) { empty++; continue; }
      if (empty) { fen += empty; empty = 0; }
      fen += p[0] === 'w' ? p[1] : p[1].toLowerCase();
    }
    if (empty) fen += empty;
    if (r < 7) fen += '/';
  }
  fen += ' ' + s.turn;
  const cast = (s.cast.wK ? 'K' : '') + (s.cast.wQ ? 'Q' : '') + (s.cast.bK ? 'k' : '') + (s.cast.bQ ? 'q' : '');
  fen += ' ' + (cast || '-');
  fen += ' ' + (s.ep >= 0 ? sq2s(s.ep) : '-');
  fen += ' ' + s.half + ' ' + s.full;
  return fen;
}

async function showReview(movesList, sansList, playerColor) {
  const rv = document.querySelector('#review');
  if (!rv) return;
  rv.classList.remove('hidden');
  document.querySelector('#rvLoading').classList.remove('hidden');
  document.querySelector('#rvResults').classList.add('hidden');
  document.querySelector('#rvProgress').style.width = '0%';
  document.querySelector('#rvProgressText').textContent = '0%';

  try {
    const analysis = await analyzeGame(movesList, sansList, playerColor);
    document.querySelector('#rvLoading').classList.add('hidden');
    document.querySelector('#rvResults').classList.remove('hidden');
    document.querySelector('#rvAccValue').textContent = analysis.accuracy + '%';
    document.querySelector('#rvAccValue').style.color = analysis.accuracy > 80 ? 'var(--st-live)' : (analysis.accuracy > 60 ? 'var(--accent)' : 'var(--destructive)');
    
    const summary = document.querySelector('#rvSummary');
    summary.innerHTML = `
      <div class="rv-sum-item blunder"><b>${analysis.stats.blunders}</b><span>Зевки</span></div>
      <div class="rv-sum-item mistake"><b>${analysis.stats.mistakes}</b><span>Ошибки</span></div>
      <div class="rv-sum-item inaccuracy"><b>${analysis.stats.inaccuracies}</b><span>Неточн.</span></div>
      <div class="rv-sum-item brilliant"><b>${analysis.stats.brilliants}</b><span>Блестящ.</span></div>
    `;
    renderEvalChart(analysis.evals);
    
    const list = document.querySelector('#rvMovesList');
    list.innerHTML = '';
    analysis.results.forEach((m, idx) => {
      const row = document.createElement('div');
      row.className = 'rv-move-row';
      const moveNum = Math.floor(idx / 2) + 1;
      const isWhite = idx % 2 === 0;
      const cp = Math.abs(m.scoreAfter) > 90000 ? (m.scoreAfter > 0 ? '+' : '-') + 'M' : (m.scoreAfter / 100).toFixed(1);
      row.innerHTML = `
        <span class="rv-move-num">${isWhite ? moveNum + '.' : ''}</span>
        <span class="rv-move-san">${m.san}</span>
        <span class="rv-move-eval">${cp}</span>
        <span class="rv-move-badge ${m.type}">${m.label}</span>
      `;
      list.appendChild(row);
    });
  } catch (e) {
    console.error('Review error', e);
    document.querySelector('#rvLoading').innerHTML = '<p class="sub" style="color:var(--destructive)">Не удалось проанализировать.</p>';
  }
}

function renderEvalChart(evals) {
  const canvas = document.querySelector('#rvChart');
  if (!canvas || !window.Chart) return;
  const data = evals.map(e => {
    const cp = e.eval;
    if (Math.abs(cp) > 90000) return cp > 0 ? 10 : -10;
    return Math.max(-10, Math.min(10, cp / 100));
  });
  if (window._rvChartInstance) window._rvChartInstance.destroy();
  window._rvChartInstance = new Chart(canvas, {
    type: 'line', data: { labels: data.map((_, i) => i + 1), datasets: [{ data: data, borderColor: '#2AABEE', backgroundColor: 'rgba(42,171,238,0.15)', fill: true, tension: 0.3, pointRadius: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: -10, max: 10, grid: { color: 'rgba(125,142,158,0.15)' }, ticks: { display: false } }, x: { display: false } } },
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.querySelector('#rvCloseBtn');
  if (closeBtn) {
    closeBtn.onclick = () => {
      document.querySelector('#review').classList.add('hidden');
      if (rvEngine) { rvEngine.postMessage('stop'); }
    };
  }
});