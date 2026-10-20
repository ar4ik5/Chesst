import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string; language_code?: string };

async function verifyInitData(initData: string): Promise<TgUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const str = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const enc = new TextEncoder();
  const k1 = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", k1, enc.encode(BOT_TOKEN));
  const k2 = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k2, enc.encode(str));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (hex !== hash) return null;
  const user = JSON.parse(params.get("user") || "null");
  return user?.id ? user : null;
}

async function ensureProfile(user: TgUser) {
  const { data, error } = await admin.from("profiles").upsert({
    id: user.id, username: user.username ?? null, first_name: user.first_name ?? null,
    last_name: user.last_name ?? null, photo_url: user.photo_url ?? null,
    lang: user.language_code ?? "ru", updated_at: new Date().toISOString(),
  }, { onConflict: "id" }).select("*").single();
  if (error) throw error;
  return data;
}

async function updateProfile(user: TgUser, patch: any) {
  const clean: any = {};
  if ("display_name" in patch) {
    const n = String(patch.display_name).trim().slice(0, 30);
    if (n.length < 2) throw new Error("name_too_short");
    clean.display_name = n;
  }
  if ("onboarded" in patch) clean.onboarded = !!patch.onboarded;
  clean.updated_at = new Date().toISOString();
  await ensureProfile(user);
  const { data, error } = await admin.from("profiles").update(clean).eq("id", user.id).select("*").single();
  if (error) throw error;
  return data;
}

async function sendTelegram(chatId: number, text: string, opts: any = {}) {
  try { await fetch(`${TG_API}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...opts }) }); } catch (e) {}
}

async function shouldSendNotification(userId: number, gameId: string | null, type: string): Promise<boolean> {
  const { data: should } = await admin.rpc("should_notify", { p_user_id: userId, p_type: type });
  if (!should) return false;
  const { data: recent } = await admin.from("notification_log").select("id").eq("user_id", userId).eq("type", type).eq("game_id", gameId).gte("sent_at", new Date(Date.now() - 30000).toISOString()).limit(1);
  if (recent && recent.length) return false;
  await admin.from("notification_log").insert({ user_id: userId, game_id: gameId, type });
  return true;
}

async function notifyOpponentMove(game: any, moverId: number) {
  const isMoverWhite = String(game.white_id) === String(moverId);
  const oppId = isMoverWhite ? game.black_id : game.white_id;
  if (!oppId || !(await shouldSendNotification(oppId, game.id, "move"))) return;
  const moverName = isMoverWhite ? game.white_name : game.black_name;
  const text = `♟ <b>${moverName}</b> сделал ход!\nВаш черед.`;
  await sendTelegram(oppId, text, { reply_markup: { inline_keyboard: [[{ text: "▶️ Открыть партию", url: `https://t.me/${(Deno.env.get("BOT_USERNAME") || "TChess_bot").replace("@","")}/app?startapp=g_${game.id}` }]] } });
}

async function notifyGameFinish(game: any) {
  if (game.result === "d") return;
  const winnerId = game.result === "w" ? game.white_id : game.black_id;
  const loserId = game.result === "w" ? game.black_id : game.white_id;
  if (winnerId && await shouldSendNotification(winnerId, game.id, "finish")) await sendTelegram(winnerId, `🏆 <b>Вы победили!</b>`);
  if (loserId && await shouldSendNotification(loserId, game.id, "finish")) await sendTelegram(loserId, `💔 <b>Партия проиграна.</b>`);
}

function kFactor(g: number) { return g < 30 ? 32 : g < 100 ? 24 : 16; }
function detectMode(tc: string | null): "bullet"|"blitz"|"rapid" {
  if (!tc || tc === "0") return "rapid";
  const [b] = tc.split("+").map(Number);
  return b < 180 ? "bullet" : b < 600 ? "blitz" : "rapid";
}

async function applyGameResult(whiteId: number | null, blackId: number | null, result: "w"|"b"|"d", tc: string | null) {
  if (!whiteId || !blackId) return null;
  const { data: profs } = await admin.from("profiles").select("id, elo, games_played").in("id", [whiteId, blackId]);
  if (!profs || profs.length !== 2) return null;
  const w = profs.find(p => Number(p.id) === Number(whiteId))!;
  const b = profs.find(p => Number(p.id) === Number(blackId))!;
  const ew = 1 / (1 + Math.pow(10, (b.elo - w.elo) / 400));
  const sw = result === "w" ? 1 : result === "b" ? 0 : 0.5;
  const dW = Math.round(kFactor(w.games_played) * (sw - ew));
  const dB = Math.round(kFactor(b.games_played) * ((1 - sw) - (1 - ew)));
  const mode = detectMode(tc);

  await admin.rpc("update_profile_stats", { p_id: w.id, p_elo_delta: dW, p_result: sw === 1 ? "w" : sw === 0 ? "b" : "d", p_mode: mode });
  await admin.rpc("update_profile_stats", { p_id: b.id, p_elo_delta: dB, p_result: (1 - sw) === 1 ? "w" : (1 - sw) === 0 ? "b" : "d", p_mode: mode });

  const coins = result === "w" ? [{ id: w.id, amount: 15 }, { id: b.id, amount: 3 }] : result === "b" ? [{ id: b.id, amount: 15 }, { id: w.id, amount: 3 }] : [{ id: w.id, amount: 7 }, { id: b.id, amount: 7 }];
  for (const c of coins) {
    const { data: p } = await admin.from("profiles").select("coins").eq("id", c.id).single();
    if (p) await admin.from("profiles").update({ coins: (p.coins || 0) + c.amount }).eq("id", c.id);
  }
  return { white: { id: w.id, delta: dW }, black: { id: b.id, delta: dB } };
}

// ДВИЖОК
const FILES = "abcdefgh";
const N_D = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const K_D = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const R_D = [[-1,0],[1,0],[0,-1],[0,1]];
const B_D = [[-1,-1],[-1,1],[1,-1],[1,1]];
function initState() { const b = Array(64).fill(null), back = "RNBQKBNR"; for (let c = 0; c < 8; c++) { b[c] = "b"+back[c]; b[8+c]="bP"; b[48+c]="wP"; b[56+c]="w"+back[c]; } return { b, turn: "w", cast: { wK:1,wQ:1,bK:1,bQ:1 }, ep: -1, half: 0, full: 1 }; }
function attacked(b: any[], sq: number, by: "w"|"b"): boolean { const r = sq>>3, c = sq&7; const pr = by==="w"?r+1:r-1; if (pr>=0 && pr<8) for (const dc of [-1,1]) { const cc = c+dc; if (cc>=0&&cc<8&&b[pr*8+cc]===by+"P") return true; } for (const [dr,dc] of N_D) { const rr=r+dr, cc=c+dc; if (rr>=0&&rr<8&&cc>=0&&cc<8&&b[rr*8+cc]===by+"N") return true; } for (const [dr,dc] of K_D) { const rr=r+dr, cc=c+dc; if (rr>=0&&rr<8&&cc>=0&&cc<8&&b[rr*8+cc]===by+"K") return true; } for (const [dr,dc] of R_D) { let rr=r+dr, cc=c+dc; while (rr>=0&&rr<8&&cc>=0&&cc<8) { const p=b[rr*8+cc]; if (p) { if (p[0]===by&&(p[1]==="R"||p[1]==="Q")) return true; break; } rr+=dr; cc+=dc; } } for (const [dr,dc] of B_D) { let rr=r+dr, cc=c+dc; while (rr>=0&&rr<8&&cc>=0&&cc<8) { const p=b[rr*8+cc]; if (p) { if (p[0]===by&&(p[1]==="B"||p[1]==="Q")) return true; break; } rr+=dr; cc+=dc; } } return false; }
function pseudo(s: any): any[] { const { b, turn, cast, ep } = s, out: any[] = [], opp = turn==="w"?"b":"w"; const add = (f: number, t: number, x?: any) => { const m: any = { f, t }; if (x) Object.assign(m, x); out.push(m); }; for (let f = 0; f < 64; f++) { const p = b[f]; if (!p || p[0] !== turn) continue; const t = p[1], r = f>>3, c = f&7; if (t === "P") { const d = turn==="w"?-1:1, start = turn==="w"?6:1, last = turn==="w"?0:7, r1 = r+d; if (r1<0||r1>7) continue; const t1 = r1*8+c; if (!b[t1]) { if (r1===last) for (const q of "QRBN") add(f,t1,{promo:q}); else { add(f,t1); if (r===start&&!b[t1+d*8]) add(f,t1+d*8,{dbl:1}); } } for (const dc of [-1,1]) { const cc = c+dc; if (cc<0||cc>7) continue; const t2 = r1*8+cc, q = b[t2]; if (q&&q[0]===opp) { if (r1===last) for (const x of "QRBN") add(f,t2,{promo:x,cap:q[1]}); else add(f,t2,{cap:q[1]}); } else if (!q&&t2===ep) add(f,t2,{cap:"P",ep:1}); } } else if (t==="N"||t==="K") { for (const [dr,dc] of (t==="N"?N_D:K_D)) { const rr=r+dr, cc=c+dc; if (rr<0||rr>7||cc<0||cc>7) continue; const q = b[rr*8+cc]; if (!q) add(f,rr*8+cc); else if (q[0]===opp) add(f,rr*8+cc,{cap:q[1]}); } if (t === "K") { const home = turn==="w"?60:4, base = turn==="w"?56:0; if (f===home) { if (cast[turn+"K"] && !b[home+1] && !b[home+2] && b[base+7]===turn+"R" && !attacked(b,home,opp) && !attacked(b,home+1,opp) && !attacked(b,home+2,opp)) add(f,home+2,{cs:1}); if (cast[turn+"Q"] && !b[home-1] && !b[home-2] && !b[home-3] && b[base]===turn+"R" && !attacked(b,home,opp) && !attacked(b,home-1,opp) && !attacked(b,home-2,opp)) add(f,home-2,{cs:2}); } } } else { const dirs = t==="R"?R_D:t==="B"?B_D:R_D.concat(B_D); for (const [dr,dc] of dirs) { let rr=r+dr, cc=c+dc; while (rr>=0&&rr<8&&cc>=0&&cc<8) { const q = b[rr*8+cc]; if (!q) add(f,rr*8+cc); else { if (q[0]===opp) add(f,rr*8+cc,{cap:q[1]}); break; } rr+=dr; cc+=dc; } } } } return out; }
function apply(s: any, m: any) { const b = s.b.slice(), p = b[m.f], turn = s.turn; b[m.f] = null; b[m.t] = m.promo ? turn+m.promo : p; if (m.ep) b[m.t+(turn==="w"?8:-8)] = null; if (m.cs) { const base = turn==="w"?56:0; if (m.cs===1) { b[base+5]=b[base+7]; b[base+7]=null; } else { b[base+3]=b[base]; b[base]=null; } } const cast = Object.assign({}, s.cast); if (p[1]==="K") { cast[turn+"K"]=0; cast[turn+"Q"]=0; } for (const q of [m.f,m.t]) { if (q===63) cast.wK=0; if (q===56) cast.wQ=0; if (q===7) cast.bK=0; if (q===0) cast.bQ=0; } return { b, turn: turn==="w"?"b":"w", cast, ep: m.dbl?(m.f+m.t)/2:-1, half: (p[1]==="P"||m.cap)?0:s.half+1, full: s.full + (turn==="b"?1:0) }; }
const kingSq = (b: any[], c: string) => b.indexOf(c+"K");
const inCheck = (s: any, c: string) => attacked(s.b, kingSq(s.b, c), c==="w"?"b":"w");
function legal(s: any): any[] { const res: any[] = []; for (const m of pseudo(s)) { const ns = apply(s, m); if (!attacked(ns.b, kingSq(ns.b, s.turn), ns.turn)) res.push(m); } return res; }
function posKey(s: any) { return s.b.map((x: any) => x||"-").join("") + s.turn + s.cast.wK + s.cast.wQ + s.cast.bK + s.cast.bQ + s.ep; }
function insufficient(b: any[]) { const rest = b.filter(x => x && x[1] !== "K"); if (!rest.length) return true; if (rest.length === 1 && (rest[0][1] === "B" || rest[0][1] === "N")) return true; return false; }
function sq(s: string): number { return "abcdefgh".indexOf(s[0]) + (8 - +s[1]) * 8; }
function parseMoves(str: string): any[] { if (!str) return []; return str.split(" ").filter(Boolean).map(x => ({ f: sq(x.slice(0,2)), t: sq(x.slice(2,4)), promo: x[4] ? x[4].toUpperCase() : "" })); }
function replay(movesStr: string): { state: any; allStates: any[] } { let state = initState(); const allStates = [state]; for (const mm of parseMoves(movesStr)) { const lm = legal(state).find(x => x.f===mm.f && x.t===mm.t && (x.promo||"")===(mm.promo||"")); if (!lm) throw new Error("bad_history"); state = apply(state, lm); allStates.push(state); } return { state, allStates }; }
function checkEnd(state: any, allStates: any[]) { const ms = legal(state); if (!ms.length) { if (inCheck(state, state.turn)) { const winner = state.turn === "w" ? "b" : "w"; return { over: true, result: winner as "w"|"b", title: "Мат" }; } return { over: true, result: "d" as const, title: "Пат" }; } if (state.half >= 100) return { over: true, result: "d" as const, title: "50 ходов" }; if (insufficient(state.b)) return { over: true, result: "d" as const, title: "Материал" }; const k = posKey(state); let n = 0; for (const x of allStates) if (posKey(x) === k) n++; if (n >= 3) return { over: true, result: "d" as const, title: "Повторение" }; return { over: false }; }

function parseTc(tc: string | null): { base: number; inc: number } | null { if (!tc || tc === "0") return null; const [b, i] = tc.split("+").map(Number); if (!isFinite(b) || b <= 0) return null; return { base: b * 1000, inc: (i || 0) * 1000 }; }
function calculateTimes(g: any) { if (g.white_time_ms === null || !g.last_move_at) return { expired: null, white_ms: g.white_time_ms, black_ms: g.black_time_ms, turn: "w" }; const elapsed = Date.now() - new Date(g.last_move_at).getTime(); const moveCount = g.moves ? g.moves.split(" ").filter(Boolean).length : 0; const turn = moveCount % 2 === 0 ? "w" : "b"; const turnTime = turn === "w" ? g.white_time_ms : g.black_time_ms; if (turnTime - elapsed < 0) return { expired: turn, white_ms: g.white_time_ms, black_ms: g.black_time_ms, turn }; return { expired: null, white_ms: g.white_time_ms, black_ms: g.black_time_ms, turn }; }

async function createGame(user: TgUser, color: "w"|"b", tc: string, inviteId?: number) {
  const { data: canCreate } = await admin.rpc("check_rate_limit", { p_user_id: user.id, p_action: "create_game", p_window_seconds: 600, p_max: 3 });
  if (!canCreate) throw new Error("rate_limit");
  const prof = await ensureProfile(user);
  const name = prof.display_name || user.first_name || "Игрок";
  const tcParsed = parseTc(tc);
  const insert: any = { time_control: tc, white_time_ms: tcParsed?.base ?? null, black_time_ms: tcParsed?.base ?? null, last_move_at: new Date().toISOString() };
  if (color === "w") { insert.white_id = user.id; insert.white_name = name; insert.white_elo = prof.elo; } else { insert.black_id = user.id; insert.black_name = name; insert.black_elo = prof.elo; }
  const { data, error } = await admin.from("games").insert(insert).select("*").single();
  if (error) throw error;
  return { id: data.id, color, status: data.status, moves: data.moves, time_control: data.time_control };
}

async function joinGame(user: TgUser, id: string) {
  const prof = await ensureProfile(user);
  const name = prof.display_name || user.first_name || "Игрок";
  const { data: g, error } = await admin.from("games").select("*").eq("id", id).single();
  if (error || !g) throw new Error("not_found");
  if (String(g.white_id) === String(user.id)) return { id: g.id, color: "w", status: g.status, moves: g.moves, time_control: g.time_control };
  if (String(g.black_id) === String(user.id)) return { id: g.id, color: "b", status: g.status, moves: g.moves, time_control: g.time_control };
  if (g.status !== "waiting") throw new Error("full");
  let color: "w"|"b", patch: any;
  if (!g.black_id) { color = "b"; patch = { black_id: user.id, black_name: name, black_elo: prof.elo, status: "active", last_move_at: new Date().toISOString() }; } else if (!g.white_id) { color = "w"; patch = { white_id: user.id, white_name: name, white_elo: prof.elo, status: "active", last_move_at: new Date().toISOString() }; } else throw new Error("full");
  patch.updated_at = new Date().toISOString();
  const { data, error: e2 } = await admin.from("games").update(patch).eq("id", id).is(color === "b" ? "black_id" : "white_id", null).select("*").single();
  if (e2 || !data) throw new Error("full");
  return { id: data.id, color, status: data.status, moves: data.moves, time_control: data.time_control };
}

async function makeMove(user: TgUser, id: string, move: string) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw new Error("bad_format");
  const { data: g, error } = await admin.from("games").select("*").eq("id", id).single();
  if (error || !g) throw new Error("not_found");
  if (g.status !== "active") throw new Error("not_active");
  const isWhite = String(g.white_id) === String(user.id);
  const isBlack = String(g.black_id) === String(user.id);
  if (!isWhite && !isBlack) throw new Error("forbidden");

  const times = calculateTimes(g);
  if (times.expired) {
    const winner = times.expired === "w" ? "b" : "w";
    await admin.from("games").update({ status: "finished", result: winner, updated_at: new Date().toISOString() }).eq("id", id);
    throw new Error("time_expired_" + times.expired);
  }

  const { state, allStates } = replay(g.moves || "");
  const turn = state.turn;
  if ((turn === "w" && !isWhite) || (turn === "b" && !isBlack)) throw new Error("not_your_turn");
  const mm = parseMoves(move)[0];
  const lm = legal(state).find(x => x.f === mm.f && x.t === mm.t && (x.promo || "") === (mm.promo || ""));
  if (!lm) throw new Error("illegal_move");

  const tcParsed = parseTc(g.time_control);
  const elapsed = g.last_move_at ? Date.now() - new Date(g.last_move_at).getTime() : 0;
  let newWhiteTime = g.white_time_ms;
  let newBlackTime = g.black_time_ms;
  if (newWhiteTime !== null && newBlackTime !== null) {
    if (turn === "w") newWhiteTime = Math.max(0, newWhiteTime - elapsed) + (tcParsed?.inc ?? 0);
    else newBlackTime = Math.max(0, newBlackTime - elapsed) + (tcParsed?.inc ?? 0);
  }

  const newState = apply(state, lm);
  const newMoves = g.moves ? `${g.moves} ${move}` : move;
  const end = checkEnd(newState, [...allStates, newState]);
  const patch: any = { moves: newMoves, white_time_ms: newWhiteTime, black_time_ms: newBlackTime, last_move_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  let eloRes = null;
  if (end.over) { patch.status = "finished"; patch.result = end.result; eloRes = await applyGameResult(g.white_id, g.black_id, end.result as "w"|"b"|"d", g.time_control); if (eloRes) { patch.white_elo_delta = eloRes.white.delta; patch.black_elo_delta = eloRes.black.delta; } }
  const { error: e2 } = await admin.from("games").update(patch).eq("id", id);
  if (e2) throw e2;
  if (!end.over) await notifyOpponentMove({ ...g, moves: newMoves }, user.id);
  else await notifyGameFinish({ ...g, result: end.result });
  return { ok: true, moves: newMoves, finished: end.over, result: end.result, title: end.title, elo: eloRes, white_time_ms: newWhiteTime, black_time_ms: newBlackTime };
}

async function resign(user: TgUser, id: string) {
  const { data: g, error } = await admin.from("games").select("*").eq("id", id).single();
  if (error || !g) throw new Error("not_found");
  if (g.status === "finished") return { ok: true, already: true };
  const isWhite = String(g.white_id) === String(user.id);
  const isBlack = String(g.black_id) === String(user.id);
  if (!isWhite && !isBlack) throw new Error("forbidden");
  const result: "w"|"b" = isWhite ? "b" : "w";
  const elo = await applyGameResult(g.white_id, g.black_id, result, g.time_control);
  await admin.from("games").update({ status: "finished", result, updated_at: new Date().toISOString(), white_elo_delta: elo?.white.delta, black_elo_delta: elo?.black.delta }).eq("id", id);
  await notifyGameFinish({ ...g, result });
  return { ok: true, elo };
}

async function getGame(id: string) {
  const { data, error } = await admin.from("games").select("*").eq("id", id).single();
  if (error || !data) throw new Error("not_found");
  return data;
}

async function history(user: TgUser, limit = 20) {
  const { data } = await admin.from("games").select("*").or(`white_id.eq.${user.id},black_id.eq.${user.id}`).eq("status", "finished").order("updated_at", { ascending: false }).limit(limit);
  return data || [];
}
async function leaderboard() {
  const { data } = await admin.from("profiles").select("id, display_name, first_name, photo_url, elo, games_played, wins, losses, draws").order("elo", { ascending: false }).limit(100);
  return data || [];
}
async function friendsList(user: TgUser) {
  const { data } = await admin.from("friends").select("friend_id, status").eq("user_id", user.id).eq("status", "accepted");
  if (!data || !data.length) return [];
  const ids = data.map(f => f.friend_id);
  const { data: profs } = await admin.from("profiles").select("id, display_name, first_name, photo_url, elo").in("id", ids);
  return profs || [];
}
async function addFriend(user: TgUser, friendId: number) {
  if (Number(friendId) === user.id) throw new Error("self");
  const { error } = await admin.from("friends").upsert({ user_id: user.id, friend_id: friendId, status: "pending" }, { onConflict: "user_id,friend_id" });
  if (error) throw error;
  return { ok: true };
}
async function getNotificationSettings(user: TgUser) {
  const { data } = await admin.from("notification_settings").select("*").eq("user_id", user.id).maybeSingle();
  return data || { user_id: user.id, notify_move: true, notify_invite: true, notify_finish: true };
}
async function setNotificationSettings(user: TgUser, patch: any) {
  const allowed = ["notify_move", "notify_invite", "notify_finish"];
  const clean: any = { user_id: user.id, updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in patch) clean[k] = !!patch[k];
  const { data, error } = await admin.from("notification_settings").upsert(clean, { onConflict: "user_id" }).select("*").single();
  if (error) throw error;
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const user = await verifyInitData(body.initData);
    if (!user) return json({ error: "unauthorized" }, 401);
    let res: unknown;
    switch (body.op) {
      case "create": res = await createGame(user, body.color === "b" ? "b" : "w", body.tc || "600+0", body.invite_id); break;
      case "join": res = await joinGame(user, String(body.id)); break;
      case "move": res = await makeMove(user, String(body.id), String(body.move)); break;
      case "resign": res = await resign(user, String(body.id)); break;
      case "get": res = await getGame(String(body.id)); break;
      case "profile_get": res = await ensureProfile(user); break;
      case "profile_update": res = await updateProfile(user, body.patch || {}); break;
      case "history": res = await history(user, body.limit || 20); break;
      case "leaderboard": res = await leaderboard(); break;
      case "friends": res = await friendsList(user); break;
      case "friend_add": res = await addFriend(user, Number(body.friend_id)); break;
      case "notifications_get": res = await getNotificationSettings(user); break;
      case "notifications_set": res = await setNotificationSettings(user, body.patch || {}); break;
      default: return json({ error: "bad_op" }, 400);
    }
    return json(res);
  } catch (e) { return json({ error: (e as Error).message }, 400); }
});

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } }); }