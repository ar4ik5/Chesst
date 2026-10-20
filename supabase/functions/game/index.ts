// supabase/functions/game/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ============================================================
// 1. Верификация Telegram initData
// ============================================================
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function verifyInitData(initData: string): Promise<{ id: number; name: string } | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const enc = new TextEncoder();
  const key1 = await crypto.subtle.importKey(
    "raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const secret = await crypto.subtle.sign("HMAC", key1, enc.encode(BOT_TOKEN));
  const key2 = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key2, enc.encode(dataCheckString));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");

  if (hex !== hash) return null;

  const user = JSON.parse(params.get("user") || "null");
  if (!user?.id) return null;
  return { id: user.id, name: user.first_name || "Игрок" };
}

// ============================================================
// 2. Шахматный движок (порт engine.js)
// ============================================================
const FILES = "abcdefgh";
const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
const N_D = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const K_D = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const R_D = [[-1,0],[1,0],[0,-1],[0,1]];
const B_D = [[-1,-1],[-1,1],[1,-1],[1,1]];
const sqName = (s: number) => FILES[s & 7] + (8 - (s >> 3));

function initState() {
  const b = Array(64).fill(null), back = "RNBQKBNR";
  for (let c = 0; c < 8; c++) { b[c] = "b" + back[c]; b[8+c] = "bP"; b[48+c] = "wP"; b[56+c] = "w" + back[c]; }
  return { b, turn: "w", cast: { wK: 1, wQ: 1, bK: 1, bQ: 1 }, ep: -1, half: 0, full: 1 };
}

function attacked(b: (string|null)[], sq: number, by: "w"|"b"): boolean {
  const r = sq >> 3, c = sq & 7;
  const pr = by === "w" ? r + 1 : r - 1;
  if (pr >= 0 && pr < 8) {
    for (const dc of [-1, 1]) {
      const cc = c + dc;
      if (cc >= 0 && cc < 8 && b[pr*8+cc] === by + "P") return true;
    }
  }
  for (const [dr, dc] of N_D) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr*8+cc] === by + "N") return true;
  }
  for (const [dr, dc] of K_D) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr*8+cc] === by + "K") return true;
  }
  for (const [dr, dc] of R_D) {
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const p = b[rr*8+cc];
      if (p) { if (p[0] === by && (p[1] === "R" || p[1] === "Q")) return true; break; }
      rr += dr; cc += dc;
    }
  }
  for (const [dr, dc] of B_D) {
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const p = b[rr*8+cc];
      if (p) { if (p[0] === by && (p[1] === "B" || p[1] === "Q")) return true; break; }
      rr += dr; cc += dc;
    }
  }
  return false;
}

function pseudo(s: any): any[] {
  const { b, turn, cast, ep } = s;
  const out: any[] = [];
  const opp = turn === "w" ? "b" : "w";
  const add = (f: number, t: number, x?: any) => { const m: any = { f, t }; if (x) Object.assign(m, x); out.push(m); };
  for (let f = 0; f < 64; f++) {
    const p = b[f]; if (!p || p[0] !== turn) continue;
    const t = p[1], r = f >> 3, c = f & 7;
    if (t === "P") {
      const d = turn === "w" ? -1 : 1, start = turn === "w" ? 6 : 1, last = turn === "w" ? 0 : 7, r1 = r + d;
      if (r1 < 0 || r1 > 7) continue;
      const t1 = r1 * 8 + c;
      if (!b[t1]) {
        if (r1 === last) { for (const q of "QRBN") add(f, t1, { promo: q }); }
        else { add(f, t1); if (r === start && !b[t1 + d * 8]) add(f, t1 + d * 8, { dbl: 1 }); }
      }
      for (const dc of [-1, 1]) {
        const cc = c + dc; if (cc < 0 || cc > 7) continue;
        const t2 = r1 * 8 + cc, q = b[t2];
        if (q && q[0] === opp) {
          if (r1 === last) { for (const x of "QRBN") add(f, t2, { promo: x, cap: q[1] }); }
          else add(f, t2, { cap: q[1] });
        } else if (!q && t2 === ep) add(f, t2, { cap: "P", ep: 1 });
      }
    } else if (t === "N" || t === "K") {
      for (const [dr, dc] of (t === "N" ? N_D : K_D)) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
        const q = b[rr*8+cc];
        if (!q) add(f, rr*8+cc); else if (q[0] === opp) add(f, rr*8+cc, { cap: q[1] });
      }
      if (t === "K") {
        const home = turn === "w" ? 60 : 4, base = turn === "w" ? 56 : 0;
        if (f === home) {
          if (cast[turn+"K"] && !b[home+1] && !b[home+2] && b[base+7] === turn+"R" &&
              !attacked(b, home, opp) && !attacked(b, home+1, opp) && !attacked(b, home+2, opp))
            add(f, home+2, { cs: 1 });
          if (cast[turn+"Q"] && !b[home-1] && !b[home-2] && !b[home-3] && b[base] === turn+"R" &&
              !attacked(b, home, opp) && !attacked(b, home-1, opp) && !attacked(b, home-2, opp))
            add(f, home-2, { cs: 2 });
        }
      }
    } else {
      const dirs = t === "R" ? R_D : t === "B" ? B_D : R_D.concat(B_D);
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const q = b[rr*8+cc];
          if (!q) add(f, rr*8+cc);
          else { if (q[0] === opp) add(f, rr*8+cc, { cap: q[1] }); break; }
          rr += dr; cc += dc;
        }
      }
    }
  }
  return out;
}

function apply(s: any, m: any) {
  const b = s.b.slice(), p = b[m.f], turn = s.turn;
  b[m.f] = null; b[m.t] = m.promo ? turn + m.promo : p;
  if (m.ep) b[m.t + (turn === "w" ? 8 : -8)] = null;
  if (m.cs) {
    const base = turn === "w" ? 56 : 0;
    if (m.cs === 1) { b[base+5] = b[base+7]; b[base+7] = null; }
    else { b[base+3] = b[base]; b[base] = null; }
  }
  const cast = Object.assign({}, s.cast);
  if (p[1] === "K") { cast[turn+"K"] = 0; cast[turn+"Q"] = 0; }
  for (const q of [m.f, m.t]) {
    if (q === 63) cast.wK = 0; if (q === 56) cast.wQ = 0;
    if (q === 7) cast.bK = 0; if (q === 0) cast.bQ = 0;
  }
  return { b, turn: turn === "w" ? "b" : "w", cast, ep: m.dbl ? (m.f + m.t) / 2 : -1,
    half: (p[1] === "P" || m.cap) ? 0 : s.half + 1, full: s.full + (turn === "b" ? 1 : 0) };
}

const kingSq = (b: any[], c: string) => b.indexOf(c + "K");
const inCheck = (s: any, c: string) => attacked(s.b, kingSq(s.b, c), c === "w" ? "b" : "w");

function legal(s: any): any[] {
  const res = [];
  for (const m of pseudo(s)) {
    const ns = apply(s, m);
    if (!attacked(ns.b, kingSq(ns.b, s.turn), ns.turn)) res.push(m);
  }
  return res;
}

function posKey(s: any) {
  return s.b.map((x: any) => x || "-").join("") + s.turn + s.cast.wK + s.cast.wQ + s.cast.bK + s.cast.bQ + s.ep;
}

function insufficient(b: (string|null)[]) {
  const rest = b.filter(x => x && x[1] !== "K");
  if (!rest.length) return true;
  if (rest.length === 1 && (rest[0]![1] === "B" || rest[0]![1] === "N")) return true;
  return false;
}

// ============================================================
// 3. Валидация ходов
// ============================================================
const FILES_STR = "abcdefgh";
function sq(s: string): number { return FILES_STR.indexOf(s[0]) + (8 - +s[1]) * 8; }

function parseMoves(str: string): any[] {
  if (!str) return [];
  return str.split(" ").filter(Boolean).map(x => ({
    f: sq(x.slice(0, 2)), t: sq(x.slice(2, 4)),
    promo: x[4] ? x[4].toUpperCase() : "",
  }));
}

function replay(movesStrIn: string): { state: any; allStates: any[] } {
  let state = initState();
  const allStates = [state];
  for (const mm of parseMoves(movesStrIn)) {
    const lm = legal(state).find(x =>
      x.f === mm.f && x.t === mm.t && (x.promo || "") === (mm.promo || "")
    );
    if (!lm) throw new Error("bad_history");
    state = apply(state, lm);
    allStates.push(state);
  }
  return { state, allStates };
}

function checkEnd(state: any, allStates: any[]): { over: boolean; result?: "w"|"b"|"d"; title?: string } {
  const ms = legal(state);
  if (!ms.length) {
    if (inCheck(state, state.turn)) {
      const winner = state.turn === "w" ? "b" : "w";
      return { over: true, result: winner as "w"|"b", title: "Мат" };
    }
    return { over: true, result: "d", title: "Пат" };
  }
  if (state.half >= 100) return { over: true, result: "d", title: "50 ходов" };
  if (insufficient(state.b)) return { over: true, result: "d", title: "Недостаточно материала" };
  const k = posKey(state);
  let n = 0;
  for (const x of allStates) if (posKey(x) === k) n++;
  if (n >= 3) return { over: true, result: "d", title: "Троекратное повторение" };
  return { over: false };
}

// ============================================================
// 4. Handlers
// ============================================================
async function createGame(user: { id: number; name: string }, color: "w" | "b") {
  const insert = color === "w"
    ? { white_id: user.id, white_name: user.name }
    : { black_id: user.id, black_name: user.name };
  const { data, error } = await admin.from("games").insert(insert).select("*").single();
  if (error) throw error;
  return { id: data.id, color, status: data.status, moves: data.moves };
}

async function joinGame(user: { id: number; name: string }, id: string) {
  const { data: g, error } = await admin.from("games").select("*").eq("id", id).single();
  if (error || !g) throw new Error("not_found");

  if (String(g.white_id) === String(user.id)) return { id: g.id, color: "w", status: g.status, moves: g.moves };
  if (String(g.black_id) === String(user.id)) return { id: g.id, color: "b", status: g.status, moves: g.moves };

  let color: "w" | "b";
  let patch: Record<string, unknown>;
  if (!g.black_id) { color = "b"; patch = { black_id: user.id, black_name: user.name, status: "active" }; }
  else if (!g.white_id) { color = "w"; patch = { white_id: user.id, white_name: user.name, status: "active" }; }
  else throw new Error("full");

  patch.updated_at = new Date().toISOString();
  const { data, error: e2 } = await admin.from("games")
    .update(patch).eq("id", id).is(color === "b" ? "black_id" : "white_id", null)
    .select("*").single();
  if (e2 || !data) throw new Error("full");
  return { id: data.id, color, status: data.status, moves: data.moves };
}

async function makeMove(user: { id: number }, id: string, move: string) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw new Error("bad_format");

  const { data: g, error } = await admin.from("games").select("*").eq("id", id).single();
  if (error || !g) throw new Error("not_found");
  if (g.status !== "active") throw new Error("not_active");

  const isWhite = String(g.white_id) === String(user.id);
  const isBlack = String(g.black_id) === String(user.id);
  if (!isWhite && !isBlack) throw new Error("forbidden");

  const { state, allStates } = replay(g.moves || "");
  const turn = state.turn;
  if ((turn === "w" && !isWhite) || (turn === "b" && !isBlack)) throw new Error("not_your_turn");

  const mm = parseMoves(move)[0];
  if (!mm) throw new Error("bad_format");

  const lm = legal(state).find(x =>
    x.f === mm.f && x.t === mm.t && (x.promo || "") === (mm.promo || "")
  );
  if (!lm) throw new Error("illegal_move");

  const newState = apply(state, lm);
  const newMoves = g.moves ? `${g.moves} ${move}` : move;
  const end = checkEnd(newState, [...allStates, newState]);

  const patch: Record<string, unknown> = {
    moves: newMoves,
    updated_at: new Date().toISOString(),
  };
  if (end.over) { patch.status = "finished"; patch.result = end.result; }

  const { error: e2 } = await admin.from("games").update(patch).eq("id", id);
  if (e2) throw e2;

  return { ok: true, moves: newMoves, finished: end.over, result: end.result, title: end.title };
}

async function resign(user: { id: number }, id: string) {
  const { data: g, error } = await admin.from("games").select("*").eq("id", id).single();
  if (error || !g) throw new Error("not_found");
  const isWhite = String(g.white_id) === String(user.id);
  const isBlack = String(g.black_id) === String(user.id);
  if (!isWhite && !isBlack) throw new Error("forbidden");
  const result = isWhite ? "b" : "w";
  const { error: e2 } = await admin.from("games")
    .update({ status: "finished", result, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (e2) throw e2;
  return { ok: true };
}

async function getGame(id: string) {
  const { data, error } = await admin.from("games")
    .select("id, white_id, white_name, black_id, black_name, moves, status, result, updated_at")
    .eq("id", id).single();
  if (error || !data) throw new Error("not_found");
  return data;
}

// ============================================================
// 5. Роутер
// ============================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { op, initData } = body;
    const user = await verifyInitData(initData);
    if (!user) return json({ error: "unauthorized" }, 401);

    let res: unknown;
    switch (op) {
      case "create": res = await createGame(user, body.color === "b" ? "b" : "w"); break;
      case "join":   res = await joinGame(user, String(body.id)); break;
      case "move":   res = await makeMove(user, String(body.id), String(body.move)); break;
      case "resign": res = await resign(user, String(body.id)); break;
      case "get":    res = await getGame(String(body.id)); break;
      default: return json({ error: "bad_op" }, 400);
    }
    return json(res);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}