import {
  COUNTRIES,
  COUNTRY_ORDER,
  PLAYER_COLORS,
  STARTING_GOLD,
  STARTING_MILITARY,
  NEUTRAL_MILITARY_MIN,
  NEUTRAL_MILITARY_MAX,
  MAX_MILITARY,
  MILITARY_COST,
} from "./countries";

/* ======================= Types ======================= */

interface Player {
  id: string;
  name: string;
  color: string;
  gold: number;
  isHost: boolean;
  connected: boolean;
  eliminated: boolean;
  isBot: boolean;
}

interface CountryState {
  id: string;
  ownerId: string | null;
  military: number;
}

interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  color: string;
  text: string;
  ts: number;
}

interface LogEntry {
  id: string;
  text: string;
  ts: number;
}

interface GameState {
  gameId: string;
  phase: "lobby" | "playing" | "finished";
  players: Player[];
  currentPlayerIndex: number;
  turnNumber: number;
  countries: Record<string, CountryState>;
  log: LogEntry[];
  chat: ChatMessage[];
  winnerId: string | null;
}

type ClientMessage =
  | { type: "join"; name: string; color: string }
  | { type: "start_game" }
  | { type: "add_bot" }
  | { type: "build_military"; countryId: string; amount: number }
  | { type: "attack"; fromCountryId: string; targetCountryId: string }
  | { type: "end_turn" }
  | { type: "vote_skip_disconnected" }
  | { type: "chat"; text: string };

type ServerMessage = { type: "state"; state: GameState; you: string } | { type: "error"; message: string };

const BOT_STEP_DELAY_MS = 1000;

/* ======================= Durable Object ======================= */

export class GameRoom {
  state: DurableObjectState;
  env: unknown;
  sessions: { ws: WebSocket; playerId: string }[] = [];
  game: GameState | null = null;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/ws")) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      await this.handleSession(server as WebSocket, url);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not found", { status: 404 });
  }

  private async ensureGame(gameId: string) {
    if (this.game) return;
    const stored = await this.state.storage.get<GameState>("game");
    if (stored) {
      this.game = stored;
      return;
    }
    this.game = {
      gameId,
      phase: "lobby",
      players: [],
      currentPlayerIndex: 0,
      turnNumber: 1,
      countries: Object.fromEntries(COUNTRY_ORDER.map((id) => [id, { id, ownerId: null, military: 0 }])),
      log: [],
      chat: [],
      winnerId: null,
    };
  }

  private async persist() {
    if (this.game) await this.state.storage.put("game", this.game);
  }

  private addLog(text: string) {
    this.game!.log.push({ id: crypto.randomUUID(), text, ts: Date.now() });
    this.game!.log = this.game!.log.slice(-80);
  }

  private currentPlayer(): Player | undefined {
    const game = this.game!;
    return game.players[game.currentPlayerIndex];
  }

  private sendTo(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket already closed — ignore
    }
  }

  private broadcast() {
    if (!this.game) return;
    for (const session of this.sessions) {
      this.sendTo(session.ws, { type: "state", state: this.game, you: session.playerId });
    }
  }

  private async handleSession(ws: WebSocket, url: URL) {
    ws.accept();
    const gameId = url.searchParams.get("gameId") || "ROOM";
    await this.ensureGame(gameId);

    let playerId = "";

    ws.addEventListener("message", async (event) => {
      try {
        const msg: ClientMessage = JSON.parse(event.data as string);

        if (msg.type === "join") {
          playerId = await this.handleJoin(ws, msg.name, msg.color);
          return;
        }

        switch (msg.type) {
          case "start_game": this.handleStartGame(playerId); break;
          case "add_bot": this.handleAddBot(playerId); break;
          case "build_military": this.handleBuildMilitary(playerId, msg.countryId, msg.amount); break;
          case "attack": this.handleAttack(playerId, msg.fromCountryId, msg.targetCountryId); break;
          case "end_turn": this.handleEndTurn(playerId); break;
          case "vote_skip_disconnected": this.handleSkipDisconnected(playerId); break;
          case "chat": this.handleChat(playerId, msg.text); break;
        }
        await this.persist();
        this.broadcast();
        await this.scheduleNextAlarm();
      } catch {
        this.sendTo(ws, { type: "error", message: "Ungültige Nachricht." });
      }
    });

    ws.addEventListener("close", () => {
      this.sessions = this.sessions.filter((s) => s.ws !== ws);
      if (playerId && this.game) {
        const p = this.game.players.find((pl) => pl.id === playerId);
        if (p) p.connected = false;
        this.persist();
        this.broadcast();
      }
    });
  }

  private async handleJoin(ws: WebSocket, name: string, color: string): Promise<string> {
    const game = this.game!;
    const cleanName = (name || "Spieler").trim().slice(0, 20) || "Spieler";

    let player = game.players.find((p) => p.name === cleanName && !p.connected && !p.isBot);
    let playerId: string;

    if (player && game.phase !== "lobby") {
      player.connected = true;
      playerId = player.id;
      this.addLog(`${cleanName} ist wieder verbunden.`);
    } else {
      const usedColors = new Set(game.players.map((p) => p.color));
      const freeColor = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? color;
      const newPlayer: Player = {
        id: crypto.randomUUID(),
        name: cleanName,
        color: freeColor,
        gold: STARTING_GOLD,
        isHost: game.players.length === 0,
        connected: true,
        eliminated: false,
        isBot: false,
      };
      game.players.push(newPlayer);
      playerId = newPlayer.id;
      this.addLog(`${cleanName} ist dem Spiel beigetreten.`);
    }

    this.sessions.push({ ws, playerId });
    await this.persist();
    this.broadcast();
    return playerId;
  }

  private handleAddBot(playerId: string) {
    const game = this.game!;
    const requester = game.players.find((p) => p.id === playerId);
    if (!requester?.isHost || game.phase !== "lobby") return;
    if (game.players.length >= PLAYER_COLORS.length) return;
    const usedColors = new Set(game.players.map((p) => p.color));
    const freeColor = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];
    const botNumber = game.players.filter((p) => p.isBot).length + 1;
    const bot: Player = {
      id: crypto.randomUUID(),
      name: `Bot ${botNumber}`,
      color: freeColor,
      gold: STARTING_GOLD,
      isHost: false,
      connected: true,
      eliminated: false,
      isBot: true,
    };
    game.players.push(bot);
    this.addLog(`${bot.name} ist dem Spiel beigetreten.`);
  }

  private handleStartGame(playerId: string) {
    const game = this.game!;
    const player = game.players.find((p) => p.id === playerId);
    if (!player?.isHost || game.phase !== "lobby") return;
    if (game.players.length < 2) return;

    // Jedes Land startet neutral mit kleiner Verteidigungsbesatzung.
    for (const id of COUNTRY_ORDER) {
      game.countries[id].military = NEUTRAL_MILITARY_MIN + Math.floor(Math.random() * (NEUTRAL_MILITARY_MAX - NEUTRAL_MILITARY_MIN + 1));
      game.countries[id].ownerId = null;
    }

    // Jeder Spieler bekommt ein zufälliges, noch unbesetztes Startland.
    const pool = [...COUNTRY_ORDER].sort(() => Math.random() - 0.5);
    game.players.forEach((p, i) => {
      const countryId = pool[i % pool.length];
      game.countries[countryId].ownerId = p.id;
      game.countries[countryId].military = STARTING_MILITARY;
    });

    game.phase = "playing";
    game.turnNumber = 1;
    game.currentPlayerIndex = 0;
    this.addLog("Das Spiel hat begonnen. Jeder Spieler kontrolliert ein Startland.");
    this.collectIncome(game.players[0]);
  }

  private collectIncome(player: Player) {
    const game = this.game!;
    const owned = Object.values(game.countries).filter((c) => c.ownerId === player.id);
    const income = owned.reduce((sum, c) => sum + COUNTRIES[c.id].income, 0);
    player.gold += income;
    if (income > 0) this.addLog(`${player.name} kassiert €${income} Einkommen aus ${owned.length} Land/Ländern.`);
  }

  private handleBuildMilitary(playerId: string, countryId: string, amount: number) {
    const game = this.game!;
    const player = this.currentPlayer();
    const country = game.countries[countryId];
    if (game.phase !== "playing" || !player || player.id !== playerId || !country) return;
    if (country.ownerId !== player.id) return;
    const buyable = Math.max(0, Math.min(Math.floor(amount), MAX_MILITARY - country.military, Math.floor(player.gold / MILITARY_COST)));
    if (buyable <= 0) return;
    const cost = buyable * MILITARY_COST;
    player.gold -= cost;
    country.military += buyable;
    this.addLog(`${player.name} verstärkt ${COUNTRIES[countryId].name} um ${buyable} Militär (€${cost}).`);
  }

  private handleAttack(playerId: string, fromCountryId: string, targetCountryId: string) {
    const game = this.game!;
    const player = this.currentPlayer();
    const from = game.countries[fromCountryId];
    const target = game.countries[targetCountryId];
    const fromDef = COUNTRIES[fromCountryId];
    if (game.phase !== "playing" || !player || player.id !== playerId || !from || !target || !fromDef) return;
    if (from.ownerId !== player.id) return;
    if (target.ownerId === player.id) return;
    if (!fromDef.neighbors.includes(targetCountryId)) return;
    if (from.military <= 0) return;

    const attackerMilitary = from.military;
    const defenderMilitary = target.military;
    const attackerRoll = attackerMilitary * (0.75 + Math.random() * 0.5);
    const defenderRoll = defenderMilitary * (0.75 + Math.random() * 0.5);
    const defenderName = target.ownerId ? game.players.find((p) => p.id === target.ownerId)?.name ?? "Unbekannt" : "neutrale Truppen";

    if (attackerRoll > defenderRoll) {
      const previousOwner = target.ownerId ? game.players.find((p) => p.id === target.ownerId) : null;
      target.ownerId = player.id;
      target.military = Math.max(1, Math.round(attackerMilitary * 0.5));
      from.military = Math.max(0, attackerMilitary - target.military);
      this.addLog(`${player.name} erobert ${COUNTRIES[targetCountryId].name} von ${defenderName}!`);
      if (previousOwner) this.checkElimination(previousOwner);
    } else {
      from.military = Math.max(0, Math.round(attackerMilitary * 0.3));
      target.military = Math.max(1, Math.round(defenderMilitary * 0.8));
      this.addLog(`${player.name}s Angriff auf ${COUNTRIES[targetCountryId].name} scheitert — Truppen von ${fromDef.name} dezimiert.`);
    }

    this.checkVictory();
  }

  private checkElimination(player: Player) {
    const game = this.game!;
    const stillOwns = Object.values(game.countries).some((c) => c.ownerId === player.id);
    if (!stillOwns && !player.eliminated) {
      player.eliminated = true;
      this.addLog(`${player.name} wurde eliminiert — kein Land mehr übrig.`);
      if (game.players[game.currentPlayerIndex]?.id === player.id) this.advanceTurn();
    }
  }

  private checkVictory() {
    const game = this.game!;
    const active = game.players.filter((p) => !p.eliminated);
    const totalCountries = COUNTRY_ORDER.length;
    for (const p of active) {
      const owned = Object.values(game.countries).filter((c) => c.ownerId === p.id).length;
      if (owned >= Math.ceil(totalCountries * 0.6)) {
        game.phase = "finished";
        game.winnerId = p.id;
        this.addLog(`${p.name} kontrolliert die Mehrheit der Welt und gewinnt!`);
        return;
      }
    }
    if (active.length === 1) {
      game.phase = "finished";
      game.winnerId = active[0].id;
      this.addLog(`${active[0].name} ist der letzte verbliebene Herrscher und gewinnt!`);
    }
  }

  private handleEndTurn(playerId: string) {
    const game = this.game!;
    const player = this.currentPlayer();
    if (game.phase !== "playing" || !player || player.id !== playerId) return;
    this.advanceTurn();
  }

  private advanceTurn() {
    const game = this.game!;
    if (game.phase !== "playing") return;
    const active = game.players.filter((p) => !p.eliminated);
    if (active.length <= 1) {
      this.checkVictory();
      return;
    }
    let next = game.currentPlayerIndex;
    for (let i = 0; i < game.players.length; i++) {
      next = (next + 1) % game.players.length;
      if (!game.players[next].eliminated) break;
    }
    if (next <= game.currentPlayerIndex) game.turnNumber += 1;
    game.currentPlayerIndex = next;
    this.collectIncome(game.players[next]);
  }

  private handleSkipDisconnected(playerId: string) {
    const game = this.game!;
    const current = this.currentPlayer();
    const requester = game.players.find((p) => p.id === playerId);
    if (game.phase !== "playing" || !current || !requester || current.connected || current.isBot) return;
    this.addLog(`${current.name} wurde wegen Verbindungsabbruch übersprungen.`);
    this.advanceTurn();
  }

  private handleChat(playerId: string, text: string) {
    const game = this.game!;
    const player = game.players.find((p) => p.id === playerId);
    const clean = (text || "").trim().slice(0, 240);
    if (!player || !clean) return;
    game.chat.push({ id: crypto.randomUUID(), playerId: player.id, name: player.name, color: player.color, text: clean, ts: Date.now() });
    game.chat = game.chat.slice(-100);
  }

  /* ---- Bot-KI: ein kleiner, skriptierter Schritt pro Alarm-Tick ---- */

  async alarm() {
    const stored = await this.state.storage.get<GameState>("game");
    if (!stored) return;
    this.game = stored;
    const game = this.game;

    if (game.phase === "playing") {
      const current = this.currentPlayer();
      if (current && current.isBot && !current.eliminated) {
        this.runBotStep(current);
      }
    }

    await this.persist();
    this.broadcast();
    await this.scheduleNextAlarm();
  }

  private async scheduleNextAlarm() {
    const game = this.game;
    if (!game) return;
    if (game.phase === "playing") {
      const current = this.currentPlayer();
      if (current && current.isBot && !current.eliminated) {
        await this.state.storage.setAlarm(Date.now() + BOT_STEP_DELAY_MS);
        return;
      }
    }
    try {
      await this.state.storage.deleteAlarm();
    } catch {
      // kein Alarm gesetzt — ignorieren
    }
  }

  private runBotStep(bot: Player) {
    const game = this.game!;
    const ownedCountries = Object.values(game.countries).filter((c) => c.ownerId === bot.id);

    // 1) Schwächstes eigenes Land verstärken, solange Gold reicht.
    const weakest = [...ownedCountries].sort((a, b) => a.military - b.military)[0];
    if (weakest && weakest.military < MAX_MILITARY && bot.gold >= MILITARY_COST) {
      const affordable = Math.floor(bot.gold / MILITARY_COST);
      const amount = Math.min(3, affordable, MAX_MILITARY - weakest.military);
      if (amount > 0 && Math.random() < 0.6) {
        this.handleBuildMilitary(bot.id, weakest.id, amount);
        return;
      }
    }

    // 2) Günstigsten erreichbaren Nachbarn angreifen (klar überlegene Militärstärke).
    let bestAttack: { from: string; target: string; edge: number } | null = null;
    for (const owned of ownedCountries) {
      if (owned.military <= 2) continue;
      for (const neighborId of COUNTRIES[owned.id].neighbors) {
        const neighbor = game.countries[neighborId];
        if (neighbor.ownerId === bot.id) continue;
        const edge = owned.military - neighbor.military;
        if (edge > 2 && (!bestAttack || edge > bestAttack.edge)) {
          bestAttack = { from: owned.id, target: neighborId, edge };
        }
      }
    }
    if (bestAttack) {
      this.handleAttack(bot.id, bestAttack.from, bestAttack.target);
      return;
    }

    // 3) Nichts Sinnvolles zu tun — Zug beenden.
    this.handleEndTurn(bot.id);
  }
}

/* ======================= Worker entry point ======================= */

interface Env {
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/room/")) {
      const gameId = url.pathname.split("/")[2] ?? "ROOM";
      const id = env.GAME_ROOM.idFromName(gameId.toUpperCase());
      const stub = env.GAME_ROOM.get(id);
      const roomUrl = new URL(request.url);
      roomUrl.pathname = "/ws";
      roomUrl.searchParams.set("gameId", gameId.toUpperCase());
      return stub.fetch(new Request(roomUrl.toString(), request));
    }

    return env.ASSETS.fetch(request);
  },
};
