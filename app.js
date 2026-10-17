"use strict";
// Интерфейс, состояние партии, интеграция с Telegram
/* ---------- Telegram ---------- */
const tg=(window.Telegram&&window.Telegram.WebApp)||null;
if(tg){try{
  tg.ready();tg.expand();
  if(tg.colorScheme)document.documentElement.setAttribute('data-theme',tg.colorScheme);
}catch(e){}}
function hap(t){try{
  const h=tg&&tg.HapticFeedback; if(!h)return;
  if(t==='move')h.impactOccurred('light');
  else if(t==='cap')h.impactOccurred('medium');
  else if(t==='ok')h.notificationOccurred('success');
  else if(t==='err')h.notificationOccurred('error');
}catch(e){}}

/* ---------- Состояние игры ---------- */
const $=q=>document.querySelector(q);
const GL={K:'\u265A',Q:'\u265B',R:'\u265C',B:'\u265D',N:'\u265E',P:'\u265F\uFE0E'};
const SAVE_KEY='chesstg:v1';
let G=null,gid=0,menuCfg={mode:'bot',side:'w',level:'2'},resignArmed=null;

const cur=()=>G.states[G.states.length-1];

function newGame(cfg,movesList){
  gid++;
  const side=cfg.side==='r'?(Math.random()<.5?'w':'b'):cfg.side;
  G={cfg:{mode:cfg.mode,side,level:+cfg.level},states:[initState()],moves:[],sans:[],
     over:null,flip:cfg.mode==='bot'&&side==='b',sel:-1,legalFrom:[],tset:new Set(),thinking:false,lastPop:-1};
  if(movesList){
    for(const mm of movesList){
      const m=legal(cur()).find(x=>x.f===mm.f&&x.t===mm.t&&(x.promo||'')===(mm.promo||''));
      if(!m)break;
      G.sans.push(toSAN(cur(),m));G.states.push(apply(cur(),m));G.moves.push(m);
    }
    checkEnd();
  }
  renderAll();
  maybeBot();
}

function checkEnd(){
  const s=cur();
  if(G.over&&G.over.resign)return;
  G.over=null;
  const ms=legal(s);
  const W=s.turn==='w'?'Чёрные':'Белые';
  if(!ms.length){
    if(inCheck(s,s.turn)){
      const winner=s.turn==='w'?'b':'w';
      G.over={title:'Мат',text:W+' победили',winner};
    }else G.over={title:'Пат',text:'Ничья: у соперника нет ходов, но шаха нет'};
  }else if(s.half>=100)G.over={title:'Ничья',text:'Правило 50 ходов'};
  else if(insufficient(s.b))G.over={title:'Ничья',text:'Недостаточно материала для мата'};
  else{
    const k=posKey(s);let n=0;
    for(const x of G.states)if(posKey(x)===k)n++;
    if(n>=3)G.over={title:'Ничья',text:'Трёхкратное повторение позиции'};
  }
}

function save(){
  try{
    localStorage.setItem(SAVE_KEY,JSON.stringify({
      cfg:{mode:G.cfg.mode,side:G.cfg.side,level:G.cfg.level},
      moves:G.moves.map(m=>({f:m.f,t:m.t,promo:m.promo||''})),
      over:!!(G.over&&G.over.resign)
    }));
  }catch(e){}
}
function loadSaved(){
  try{const raw=localStorage.getItem(SAVE_KEY);if(!raw)return null;
    const d=JSON.parse(raw);return d&&d.cfg&&Array.isArray(d.moves)?d:null;}catch(e){return null;}
}

/* ---------- Ввод ---------- */
function canInteract(){
  return G&&!G.over&&!G.thinking&&$('#promo').classList.contains('hidden')&&
    (G.cfg.mode==='two'||cur().turn===G.cfg.side);
}
function clearSel(){G.sel=-1;G.legalFrom=[];G.tset=new Set();}
function select(sq){
  G.sel=sq;
  G.legalFrom=legal(cur()).filter(m=>m.f===sq);
  G.tset=new Set(G.legalFrom.map(m=>m.t));
}
function onSq(sq){
  if(!canInteract())return;
  const s=cur(),p=s.b[sq];
  if(G.sel>=0){
    const ms=G.legalFrom.filter(m=>m.t===sq);
    if(ms.length){
      if(ms[0].promo){askPromo(ms);return;}
      commit(ms[0]);return;
    }
  }
  if(p&&p[0]===s.turn&&sq!==G.sel){select(sq);}else clearSel();
  renderBoard();
}
function askPromo(ms){
  const col=cur().turn,box=$('#promoBtns');
  box.innerHTML='';
  for(const q of ['Q','R','B','N']){
    const b=document.createElement('button');
    b.innerHTML='<i class="pc '+col+'">'+GL[q]+'</i>';
    b.addEventListener('click',()=>{
      $('#promo').classList.add('hidden');
      commit(ms.find(m=>m.promo===q));
    });
    box.appendChild(b);
  }
  $('#promo').classList.remove('hidden');
}

function commit(m){
  const s=cur(),san=toSAN(s,m);
  G.states.push(apply(s,m));G.moves.push(m);G.sans.push(san);
  G.lastPop=m.t;
  clearSel();
  checkEnd();
  if(G.over){hap(G.over.winner&&G.cfg.mode==='bot'&&G.over.winner!==G.cfg.side?'err':'ok');}
  else hap(m.cap?'cap':'move');
  save();
  renderAll();
  if(G.over)setTimeout(showEnd,450);
  else maybeBot();
}

function maybeBot(){
  if(!G||G.over||G.cfg.mode!=='bot'||cur().turn===G.cfg.side)return;
  G.thinking=true;updateStatus();
  const my=gid;
  setTimeout(()=>{
    if(my!==gid||!G)return;
    const m=bestMove(cur(),G.cfg.level);
    if(my!==gid)return;
    G.thinking=false;
    if(m)commit(m);else updateStatus();
  },380);
}

/* ---------- Рендер ---------- */
function renderBoard(){
  const s=cur(),chk=inCheck(s,s.turn)&&!G.over?kingSq(s.b,s.turn):(G.over&&G.over.title==='Мат'?kingSq(s.b,s.turn):-1);
  const last=G.moves.length?G.moves[G.moves.length-1]:null;
  let h='';
  for(let vi=0;vi<64;vi++){
    const sq=G.flip?63-vi:vi,r=sq>>3,c=sq&7,p=s.b[sq];
    let cls='sq '+(((r+c)&1)?'d':'l');
    if(last&&(sq===last.f||sq===last.t))cls+=' last';
    if(sq===G.sel)cls+=' sel';
    if(sq===chk)cls+=' chk';
    if(G.tset.has(sq))cls+=(p||(G.legalFrom.find(m=>m.t===sq&&m.ep)))?' cap':' mv';
    h+='<div class="'+cls+'" data-sq="'+sq+'">';
    if((vi&7)===0)h+='<span class="co r">'+(8-r)+'</span>';
    if((vi>>3)===7)h+='<span class="co f">'+FILES[c]+'</span>';
    if(p)h+='<i class="pc '+p[0]+(sq===G.lastPop?' pop':'')+'">'+GL[p[1]]+'</i>';
    h+='</div>';
  }
  $('#board').innerHTML=h;
}

function updateStatus(){
  const el=$('#status'),s=cur();
  el.className='';
  if(G.over){
    el.textContent=G.over.title+(G.over.text?'. '+G.over.text:'');
    if(G.over.title==='Мат'||G.over.resign)el.className='alert';
    return;
  }
  if(G.thinking){el.textContent='Бот думает';el.className='think';return;}
  const chk=inCheck(s,s.turn);
  let t;
  if(G.cfg.mode==='bot')t='Ваш ход';
  else t='Ход '+(s.turn==='w'?'белых':'чёрных');
  el.textContent=(chk?'Шах! ':'')+t;
  if(chk)el.className='alert';
}

function renderBars(){
  const s=cur(),topC=G.flip?'w':'b',botC=G.flip?'b':'w';
  const start={P:8,N:2,B:2,R:2,Q:1};
  const have={w:{P:0,N:0,B:0,R:0,Q:0},b:{P:0,N:0,B:0,R:0,Q:0}};
  const mat={w:0,b:0};
  for(const p of s.b){if(p&&p[1]!=='K'){have[p[0]][p[1]]++;mat[p[0]]+=VAL[p[1]];}}
  const names=c=>{
    if(G.cfg.mode==='two')return c==='w'?'Белые':'Чёрные';
    if(c===G.cfg.side)return 'Вы';
    return 'Бот · '+({1:'лёгкий',2:'средний',3:'сильный'}[G.cfg.level]);
  };
  for(const [id,c] of [['#topBar',topC],['#botBar',botC]]){
    const el=$(id),opp=c==='w'?'b':'w';
    el.querySelector('.chip').className='chip '+c;
    el.querySelector('.nm').textContent=names(c);
    let g='';
    for(const t of ['Q','R','B','N','P']){
      const n=Math.max(0,start[t]-have[opp][t]);
      for(let i=0;i<n;i++)g+='<i class="g '+opp+'">'+GL[t]+'</i>';
    }
    const diff=mat[c]-mat[opp];
    if(diff>0)g+='<em>+'+Math.round(diff/100)+'</em>';
    el.querySelector('.caps').innerHTML=g;
  }
}

function renderMoves(){
  let h='';
  G.sans.forEach((x,i)=>{
    if(i%2===0)h+='<span class="n">'+(i/2+1)+'.</span>';
    h+=(i===G.sans.length-1?'<b>'+x+'</b>':x)+' ';
  });
  const el=$('#moves');
  el.innerHTML=h||'Ходов пока нет';
  el.scrollLeft=el.scrollWidth;
}

function renderTools(){
  const bot=G.cfg.mode==='bot';
  const min=bot&&G.cfg.side==='b'?1:0;
  $('#btnUndo').disabled=G.moves.length<=min||G.thinking;
  $('#btnResign').disabled=!!G.over;
}

function renderAll(){
  renderBoard();renderBars();renderMoves();updateStatus();renderTools();
  G.lastPop=-1;
}

function showEnd(){
  if(!G||!G.over)return;
  let title=G.over.title,text=G.over.text||'';
  if(G.cfg.mode==='bot'&&G.over.winner){
    title=G.over.winner===G.cfg.side?'Вы победили!':'Победил бот';
    text=G.over.title==='Мат'?'Мат на '+Math.ceil(G.moves.length/2)+'-м ходу':text;
  }
  $('#endTitle').textContent=title;
  $('#endText').textContent=text;
  $('#end').classList.remove('hidden');
}

/* ---------- Кнопки ---------- */
$('#board').addEventListener('click',e=>{
  const el=e.target.closest('.sq');if(el)onSq(+el.dataset.sq);
});
$('#btnFlip').addEventListener('click',()=>{G.flip=!G.flip;renderBoard();renderBars();});
$('#btnUndo').addEventListener('click',()=>{
  if(!G||G.thinking)return;
  const bot=G.cfg.mode==='bot',min=bot&&G.cfg.side==='b'?1:0;
  if(G.moves.length<=min)return;
  let n=bot?(cur().turn===G.cfg.side?2:1):1;
  n=Math.min(n,G.moves.length-min);
  for(let i=0;i<n;i++){G.states.pop();G.moves.pop();G.sans.pop();}
  G.over=null;clearSel();gid++;
  save();renderAll();maybeBot();
});
$('#btnResign').addEventListener('click',()=>{
  if(!G||G.over)return;
  const b=$('#btnResign');
  if(!resignArmed){
    b.classList.add('warn');b.querySelector('span').textContent='Точно?';
    resignArmed=setTimeout(disarm,3000);return;
  }
  disarm();
  const loser=G.cfg.mode==='bot'?G.cfg.side:cur().turn;
  const winner=loser==='w'?'b':'w';
  G.over={title:'Сдача',text:(loser==='w'?'Белые':'Чёрные')+' сдались',winner,resign:true};
  gid++;G.thinking=false;
  save();renderAll();showEnd();
});
function disarm(){
  clearTimeout(resignArmed);resignArmed=null;
  const b=$('#btnResign');b.classList.remove('warn');b.querySelector('span').textContent='Сдаться';
}
$('#btnNew').addEventListener('click',openMenu);
$('#btnMenu').addEventListener('click',openMenu);
$('#btnAgain').addEventListener('click',()=>{$('#end').classList.add('hidden');openMenu();});
$('#btnView').addEventListener('click',()=>$('#end').classList.add('hidden'));

function openMenu(){
  const sv=loadSaved();
  $('#btnContinue').classList.toggle('hidden',!(sv&&sv.moves.length&&!sv.over&&G));
  $('#menu').classList.remove('hidden');
}
document.querySelectorAll('.seg').forEach(seg=>{
  seg.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    seg.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
    menuCfg[seg.dataset.k]=b.dataset.v;
    $('#botOpts').classList.toggle('hidden',menuCfg.mode!=='bot');
  });
});
$('#btnPlay').addEventListener('click',()=>{
  $('#menu').classList.add('hidden');
  newGame(menuCfg);save();
});
$('#btnContinue').addEventListener('click',()=>$('#menu').classList.add('hidden'));

/* ---------- Старт ---------- */
(function init(){
  const sv=loadSaved();
  if(sv&&sv.moves.length&&!sv.over){
    newGame({mode:sv.cfg.mode,side:sv.cfg.side,level:sv.cfg.level},sv.moves);
    $('#btnContinue').classList.remove('hidden');
  }else{
    newGame(menuCfg);
  }
  // сохранённая партия не восстановлена как "завершённая сдачей" — стартуем с меню
  $('#menu').classList.remove('hidden');
})();
