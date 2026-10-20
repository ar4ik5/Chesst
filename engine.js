"use strict";
// Шахматный движок: правила, генерация ходов, нотация
/* ---------- Движок ---------- */
const FILES='abcdefgh';
const VAL={P:100,N:320,B:330,R:500,Q:900,K:0};
const N_D=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const K_D=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const R_D=[[-1,0],[1,0],[0,-1],[0,1]];
const B_D=[[-1,-1],[-1,1],[1,-1],[1,1]];
const sqName=s=>FILES[s&7]+(8-(s>>3));

function initState(){
  const b=Array(64).fill(null),back='RNBQKBNR';
  for(let c=0;c<8;c++){b[c]='b'+back[c];b[8+c]='bP';b[48+c]='wP';b[56+c]='w'+back[c];}
  return {b,turn:'w',cast:{wK:1,wQ:1,bK:1,bQ:1},ep:-1,half:0,full:1};
}

function attacked(b,sq,by){
  const r=sq>>3,c=sq&7;
  const pr=by==='w'?r+1:r-1;
  if(pr>=0&&pr<8){for(const dc of [-1,1]){const cc=c+dc;if(cc>=0&&cc<8&&b[pr*8+cc]===by+'P')return true;}}
  for(const [dr,dc] of N_D){const rr=r+dr,cc=c+dc;if(rr>=0&&rr<8&&cc>=0&&cc<8&&b[rr*8+cc]===by+'N')return true;}
  for(const [dr,dc] of K_D){const rr=r+dr,cc=c+dc;if(rr>=0&&rr<8&&cc>=0&&cc<8&&b[rr*8+cc]===by+'K')return true;}
  for(const [dr,dc] of R_D){let rr=r+dr,cc=c+dc;
    while(rr>=0&&rr<8&&cc>=0&&cc<8){const p=b[rr*8+cc];
      if(p){if(p[0]===by&&(p[1]==='R'||p[1]==='Q'))return true;break;}rr+=dr;cc+=dc;}}
  for(const [dr,dc] of B_D){let rr=r+dr,cc=c+dc;
    while(rr>=0&&rr<8&&cc>=0&&cc<8){const p=b[rr*8+cc];
      if(p){if(p[0]===by&&(p[1]==='B'||p[1]==='Q'))return true;break;}rr+=dr;cc+=dc;}}
  return false;
}

function pseudo(s){
  const {b,turn,cast,ep}=s,out=[],opp=turn==='w'?'b':'w';
  const add=(f,t,x)=>{const m={f,t};if(x)Object.assign(m,x);out.push(m);};
  for(let f=0;f<64;f++){
    const p=b[f];if(!p||p[0]!==turn)continue;
    const t=p[1],r=f>>3,c=f&7;
    if(t==='P'){
      const d=turn==='w'?-1:1,start=turn==='w'?6:1,last=turn==='w'?0:7,r1=r+d;
      if(r1<0||r1>7)continue;
      const t1=r1*8+c;
      if(!b[t1]){
        if(r1===last){for(const q of 'QRBN')add(f,t1,{promo:q});}
        else{add(f,t1);if(r===start&&!b[t1+d*8])add(f,t1+d*8,{dbl:1});}
      }
      for(const dc of [-1,1]){
        const cc=c+dc;if(cc<0||cc>7)continue;
        const t2=r1*8+cc,q=b[t2];
        if(q&&q[0]===opp){
          if(r1===last){for(const x of 'QRBN')add(f,t2,{promo:x,cap:q[1]});}
          else add(f,t2,{cap:q[1]});
        }else if(!q&&t2===ep)add(f,t2,{cap:'P',ep:1});
      }
    }else if(t==='N'||t==='K'){
      for(const [dr,dc] of (t==='N'?N_D:K_D)){
        const rr=r+dr,cc=c+dc;if(rr<0||rr>7||cc<0||cc>7)continue;
        const q=b[rr*8+cc];
        if(!q)add(f,rr*8+cc);else if(q[0]===opp)add(f,rr*8+cc,{cap:q[1]});
      }
      if(t==='K'){
        const home=turn==='w'?60:4,base=turn==='w'?56:0;
        if(f===home){
          if(cast[turn+'K']&&!b[home+1]&&!b[home+2]&&b[base+7]===turn+'R'&&
            !attacked(b,home,opp)&&!attacked(b,home+1,opp)&&!attacked(b,home+2,opp))add(f,home+2,{cs:1});
          if(cast[turn+'Q']&&!b[home-1]&&!b[home-2]&&!b[home-3]&&b[base]===turn+'R'&&
            !attacked(b,home,opp)&&!attacked(b,home-1,opp)&&!attacked(b,home-2,opp))add(f,home-2,{cs:2});
        }
      }
    }else{
      const dirs=t==='R'?R_D:t==='B'?B_D:R_D.concat(B_D);
      for(const [dr,dc] of dirs){
        let rr=r+dr,cc=c+dc;
        while(rr>=0&&rr<8&&cc>=0&&cc<8){
          const q=b[rr*8+cc];
          if(!q)add(f,rr*8+cc);
          else{if(q[0]===opp)add(f,rr*8+cc,{cap:q[1]});break;}
          rr+=dr;cc+=dc;
        }
      }
    }
  }
  return out;
}

function apply(s,m){
  const b=s.b.slice(),p=b[m.f],turn=s.turn;
  b[m.f]=null;b[m.t]=m.promo?turn+m.promo:p;
  if(m.ep)b[m.t+(turn==='w'?8:-8)]=null;
  if(m.cs){const base=turn==='w'?56:0;
    if(m.cs===1){b[base+5]=b[base+7];b[base+7]=null;}
    else{b[base+3]=b[base];b[base]=null;}}
  const cast=Object.assign({},s.cast);
  if(p[1]==='K'){cast[turn+'K']=0;cast[turn+'Q']=0;}
  for(const q of [m.f,m.t]){
    if(q===63)cast.wK=0;if(q===56)cast.wQ=0;if(q===7)cast.bK=0;if(q===0)cast.bQ=0;
  }
  return {b,turn:turn==='w'?'b':'w',cast,ep:m.dbl?(m.f+m.t)/2:-1,
    half:(p[1]==='P'||m.cap)?0:s.half+1,full:s.full+(turn==='b'?1:0)};
}

const kingSq=(b,c)=>b.indexOf(c+'K');
const inCheck=(s,c)=>attacked(s.b,kingSq(s.b,c),c==='w'?'b':'w');
function legal(s){
  const res=[];
  for(const m of pseudo(s)){
    const ns=apply(s,m);
    if(!attacked(ns.b,kingSq(ns.b,s.turn),ns.turn))res.push(m);
  }
  return res;
}

function posKey(s){return s.b.map(x=>x||'-').join('')+s.turn+s.cast.wK+s.cast.wQ+s.cast.bK+s.cast.bQ+s.ep;}
function insufficient(b){
  const rest=b.filter(x=>x&&x[1]!=='K');
  if(!rest.length)return true;
  if(rest.length===1&&(rest[0][1]==='B'||rest[0][1]==='N'))return true;
  return false;
}

/* SAN (русские обозначения фигур) */
const RU={K:'Кр',Q:'Ф',R:'Л',B:'С',N:'К'};
function toSAN(s,m){
  const ns=apply(s,m);
  let suf='';
  if(inCheck(ns,ns.turn))suf=legal(ns).length?'+':'#';
  if(m.cs)return (m.cs===1?'O-O':'O-O-O')+suf;
  const t=s.b[m.f][1];
  if(t==='P'){
    let x=(m.cap?FILES[m.f&7]+'x':'')+sqName(m.t);
    if(m.promo)x+='='+RU[m.promo];
    return x+suf;
  }
  let dis='';
  const others=legal(s).filter(o=>o.t===m.t&&o.f!==m.f&&s.b[o.f][1]===t);
  if(others.length){
    if(!others.some(o=>(o.f&7)===(m.f&7)))dis=FILES[m.f&7];
    else if(!others.some(o=>(o.f>>3)===(m.f>>3)))dis=String(8-(m.f>>3));
    else dis=sqName(m.f);
  }
  return RU[t]+dis+(m.cap?'x':'')+sqName(m.t)+suf;
}