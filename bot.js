"use strict";
// Бот: оценка позиции и поиск (альфа-бета)
/* ---------- Бот ---------- */
function evaluate(s){
  let v=0;
  for(let i=0;i<64;i++){
    const p=s.b[i];if(!p)continue;
    const col=p[0],t=p[1],r=i>>3,c=i&7;
    const cd=Math.abs(c-3.5)+Math.abs(r-3.5);
    let pos=0;
    if(t==='P')pos=(col==='w'?6-r:r-1)*7+(7-cd)*2;
    else if(t==='N')pos=(7-cd)*7;
    else if(t==='B')pos=(7-cd)*4;
    else if(t==='Q')pos=(7-cd)*1.5;
    else if(t==='R')pos=(col==='w'?r===1:r===6)?12:0;
    else if(t==='K'){const home=col==='w'?7:0;pos=(r===home?12:-18)+((c<=2||c>=6)&&r===home?10:0);}
    v+=(col==='w'?1:-1)*(VAL[t]+pos);
  }
  return v;
}
const orderScore=m=>(m.cap?10*VAL[m.cap]:0)+(m.promo?800:0)+(m.cs?30:0);

function qs(s,a,b,d){
  const stand=(s.turn==='w'?1:-1)*evaluate(s);
  if(stand>=b)return b;
  if(d===0)return stand;
  if(stand>a)a=stand;
  // БЫЛО: .filter(m=>m.cap)  — теперь учитываем и превращения
  const caps=pseudo(s).filter(m=>m.cap||m.promo).sort((x,y)=>orderScore(y)-orderScore(x));
  for(const m of caps){
    const ns=apply(s,m);
    if(attacked(ns.b,kingSq(ns.b,s.turn),ns.turn))continue;
    const sc=-qs(ns,-b,-a,d-1);
    if(sc>=b)return b;
    if(sc>a)a=sc;
  }
  return a;
}

function search(s,d,a,b){
  const ms=legal(s);
  if(!ms.length)return inCheck(s,s.turn)?-100000-d:0;
  if(s.half>=100)return 0;
  if(d===0)return qs(s,a,b,2);
  ms.sort((x,y)=>orderScore(y)-orderScore(x));
  for(const m of ms){
    const sc=-search(apply(s,m),d-1,-b,-a);
    if(sc>=b)return b;
    if(sc>a)a=sc;
  }
  return a;
}

function bestMove(s,level){
  const cfg={1:{d:1,noise:90},2:{d:2,noise:12},3:{d:3,noise:0}}[level]||{d:2,noise:12};
  const ms=legal(s);if(!ms.length)return null;
  for(let i=ms.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ms[i],ms[j]]=[ms[j],ms[i]];}
  ms.sort((x,y)=>orderScore(y)-orderScore(x));
  let best=ms[0],bs=-Infinity;
  for(const m of ms){
    const ns=apply(s,m);
    let sc;
    if(cfg.noise===0){
      sc=-search(ns,cfg.d-1,-1e9,-bs);
    }else{
      sc=-search(ns,cfg.d-1,-1e9,1e9)+(Math.random()-.5)*2*cfg.noise;
    }
    if(sc>bs){bs=sc;best=m;}
  }
  return best;
}