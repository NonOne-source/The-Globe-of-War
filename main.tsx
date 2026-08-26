import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Globe } from "./globe";
import { COUNTRIES, PLAYER_COLORS, MILITARY_COST, MAX_MILITARY } from "./countries";

/* ======================= Types (mirrors worker.ts) ======================= */

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

export interface GameState {
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

/* ======================= WebSocket hook ======================= */

function useGameSocket(gameId: string | null, name: string, color: string) {
  const [state, setState] = useState<GameState | null>(null);
  const [youId, setYouId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    let ws: WebSocket;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/room/${gameId}`);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (cancelled) return;
        setConnected(true);
        setError(null);
        ws.send(JSON.stringify({ type: "join", name, color } satisfies ClientMessage));
      });

      ws.addEventListener("message", (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        if (msg.type === "state") {
          setState(msg.state);
          setYouId(msg.you);
        } else if (msg.type === "error") {
          setError(msg.message);
        }
      });

      ws.addEventListener("close", () => {
        if (cancelled) return;
        setConnected(false);
        setTimeout(() => { if (!cancelled) connect(); }, 1500);
      });

      ws.addEventListener("error", () => ws.close());
    }

    connect();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);

  return { state, youId, connected, error, send };
}

/* ======================= Lobby ======================= */

function Lobby({
  onEnterRoom,
  game,
  youId,
  connected,
  onStartGame,
  onAddBot,
}: {
  onEnterRoom: (id: string, name: string, color: string) => void;
  game: GameState | null;
  youId: string | null;
  connected: boolean;
  onStartGame: () => void;
  onAddBot: () => void;
}) {
  const [roomInput, setRoomInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [colorInput, setColorInput] = useState(PLAYER_COLORS[0]);

  const inRoom = !!game;
  const you = game?.players.find((p) => p.id === youId);

  if (!inRoom) {
    return (
      <div className="lobby-screen">
        <div className="lobby-card card">
          <span className="deed-eyebrow">Mini-Weltmacht</span>
          <h1 className="display">Erobere die Welt</h1>
          <p className="lobby-hint">Baue Militär auf, greife Nachbarländer an und kontrolliere die Mehrheit der Welt.</p>
          <label className="lobby-label">Dein Name</label>
          <input className="lobby-input" value={nameInput} maxLength={20} onChange={(e) => setNameInput(e.target.value)} placeholder="Napoleon" />
          <label className="lobby-label">Farbe</label>
          <div className="color-swatches">
            {PLAYER_COLORS.map((c) => (
              <button key={c} className={`color-swatch${c === colorInput ? " is-selected" : ""}`} style={{ background: c }} onClick={() => setColorInput(c)} />
            ))}
          </div>
          <label className="lobby-label">Raumcode</label>
          <input className="lobby-input mono" value={roomInput} maxLength={8} onChange={(e) => setRoomInput(e.target.value.toUpperCase())} placeholder="z. B. ERDE1" />
          <button
            className="btn btn-primary"
            disabled={!nameInput.trim() || !roomInput.trim()}
            onClick={() => onEnterRoom(roomInput.trim(), nameInput.trim(), colorInput)}
          >
            Raum betreten
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-screen">
      <div className="lobby-card card">
        <span className="deed-eyebrow">Raum {game.gameId}</span>
        <h1 className="display">Warteraum</h1>
        {!connected && <p className="lobby-hint">Verbinde…</p>}
        <ul className="lobby-players">
          {game.players.map((p) => (
            <li key={p.id}>
              <span className="ledger-swatch" style={{ background: p.color }} />
              {p.name} {p.isBot && "🤖"} {p.isHost && <span className="lobby-host-tag">Host</span>}
            </li>
          ))}
        </ul>
        {you?.isHost && (
          <div className="lobby-buttons">
            <button className="btn" disabled={game.players.length >= PLAYER_COLORS.length} onClick={onAddBot}>
              🤖 Bot hinzufügen
            </button>
          </div>
        )}
        {you?.isHost ? (
          <button className="btn btn-primary" disabled={game.players.length < 2} onClick={onStartGame}>
            {game.players.length < 2 ? "Warte auf weitere Spieler…" : "Spiel starten"}
          </button>
        ) : (
          <p className="lobby-hint">Warte, bis der Host das Spiel startet…</p>
        )}
      </div>
    </div>
  );
}

/* ======================= LedgerBar ======================= */

function LedgerBar({
  game,
  youId,
  onEndTurn,
  onSkipDisconnected,
}: {
  game: GameState;
  youId: string;
  onEndTurn: () => void;
  onSkipDisconnected: () => void;
}) {
  const current = game.players[game.currentPlayerIndex];
  const isYourTurn = current?.id === youId;

  function countryCount(playerId: string) {
    return Object.values(game.countries).filter((c) => c.ownerId === playerId).length;
  }

  return (
    <div className="ledger-bar card">
      <div className="ledger-players">
        {game.players.map((p) => (
          <div key={p.id} className={`ledger-player${p.id === current?.id ? " is-current" : ""}${p.eliminated ? " is-bankrupt" : ""}`}>
            <span className="ledger-swatch" style={{ background: p.color }} />
            <span className="ledger-name">
              {p.name}{p.isBot && " 🤖"}{!p.connected && !p.isBot && " (getrennt)"}
            </span>
            <span className="ledger-money mono">€{p.gold.toLocaleString("de-DE")} · {countryCount(p.id)} 🌍</span>
          </div>
        ))}
      </div>
      <div className="ledger-action">
        <span className="ledger-waiting">Runde {game.turnNumber}</span>
        {isYourTurn && <button className="btn btn-primary" onClick={onEndTurn}>Zug beenden</button>}
        {!isYourTurn && !current?.connected && !current?.isBot && (
          <button className="btn" onClick={onSkipDisconnected}>Zug überspringen (getrennt)</button>
        )}
        {!isYourTurn && (current?.connected || current?.isBot) && (
          <span className="ledger-waiting">Warte auf {current?.name}{current?.isBot && " (Bot)"}…</span>
        )}
      </div>
    </div>
  );
}

/* ======================= CountryPanel ======================= */

function CountryPanel({
  game,
  youId,
  countryId,
  onBuild,
  onAttack,
  onClose,
}: {
  game: GameState;
  youId: string;
  countryId: string;
  onBuild: (amount: number) => void;
  onAttack: (fromCountryId: string) => void;
  onClose: () => void;
}) {
  const [buildAmount, setBuildAmount] = useState(1);
  const isYourTurn = game.players[game.currentPlayerIndex]?.id === youId;
  const countryDef = COUNTRIES[countryId];
  const countryState = game.countries[countryId];
  const owner = game.players.find((p) => p.id === countryState.ownerId);
  const isMine = countryState.ownerId === youId;

  const affordable = Math.floor((game.players.find((p) => p.id === youId)?.gold ?? 0) / MILITARY_COST);
  const maxBuild = Math.max(0, Math.min(affordable, MAX_MILITARY - countryState.military));

  // Eigene Länder, von denen aus dieses Land angegriffen werden könnte.
  const attackSources = isMine
    ? []
    : Object.values(game.countries).filter(
        (c) => c.ownerId === youId && c.military > 0 && COUNTRIES[c.id].neighbors.includes(countryId),
      );

  return (
    <div className="deed-overlay" onClick={onClose}>
      <div className="deed card" onClick={(e) => e.stopPropagation()}>
        <span className="deed-eyebrow">{owner ? owner.name : "Neutral"}</span>
        <h2 className="display" style={{ marginTop: 0 }}>{countryDef.name}</h2>
        <p className="lobby-hint">
          ⚔️ Militär: {countryState.military} · Einkommen: €{countryDef.income}/Zug
        </p>

        {isMine && isYourTurn && (
          <div className="build-row" style={{ borderColor: owner?.color }}>
            <div className="build-row-info">
              <strong>Militär verstärken</strong>
              <span className="lobby-hint">€{MILITARY_COST} pro Punkt · max. {MAX_MILITARY}</span>
            </div>
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input
                className="lobby-input mono"
                style={{ width: 64 }}
                type="number"
                min={1}
                max={Math.max(1, maxBuild)}
                value={buildAmount}
                onChange={(e) => setBuildAmount(Math.max(1, Math.min(maxBuild || 1, Number(e.target.value) || 1)))}
              />
              <button className="btn btn-primary" disabled={maxBuild <= 0} onClick={() => onBuild(buildAmount)}>
                Bauen
              </button>
            </div>
          </div>
        )}

        {!isMine && isYourTurn && (
          <div className="build-list">
            {attackSources.length === 0 && (
              <p className="lobby-hint">Kein eigenes Nachbarland mit Truppen, von dem aus du angreifen könntest.</p>
            )}
            {attackSources.map((c) => (
              <div key={c.id} className="build-row" style={{ borderColor: "#b8543f" }}>
                <div className="build-row-info">
                  <strong>Angriff von {COUNTRIES[c.id].name}</strong>
                  <span className="lobby-hint">Eigene Streitkräfte dort: {c.military}</span>
                </div>
                <button className="btn btn-primary" onClick={() => onAttack(c.id)}>⚔️ Angreifen</button>
              </div>
            ))}
          </div>
        )}

        {!isYourTurn && <p className="lobby-hint">Du bist nicht am Zug.</p>}

        <div className="deed-actions">
          <button className="btn" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}

/* ======================= LogPanel / ChatPanel ======================= */

function LogPanel({ game }: { game: GameState }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [game.log.length]);
  return (
    <div className="card log-panel">
      <span className="deed-eyebrow">Ereignisse</span>
      <div className="chat-list" ref={listRef}>
        {game.log.map((entry) => (
          <p key={entry.id} className="lobby-hint" style={{ margin: "0.15rem 0" }}>{entry.text}</p>
        ))}
      </div>
    </div>
  );
}

function ChatPanel({ game, youId, onSend, onClose }: { game: GameState; youId: string; onSend: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [game.chat.length]);

  function submit() {
    const clean = text.trim();
    if (!clean) return;
    onSend(clean);
    setText("");
  }

  return (
    <div className="chat-panel card">
      <div className="chat-header">
        <span className="deed-eyebrow">Chat</span>
        <button className="btn chat-close" onClick={onClose}>Schließen</button>
      </div>
      <div className="chat-list" ref={listRef}>
        {game.chat.length === 0 && <p className="lobby-hint">Noch keine Nachrichten.</p>}
        {game.chat.map((m) => (
          <div key={m.id} className={`chat-message${m.playerId === youId ? " is-you" : ""}`}>
            <span className="chat-author" style={{ color: m.color }}>{m.name}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          className="lobby-input"
          value={text}
          maxLength={240}
          placeholder="Nachricht schreiben…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <button className="btn btn-primary" onClick={submit}>Senden</button>
      </div>
    </div>
  );
}

/* ======================= Win screen ======================= */

function WinScreen({ game }: { game: GameState }) {
  const winner = game.players.find((p) => p.id === game.winnerId);
  const ranking = [...game.players].sort((a, b) => {
    const ac = Object.values(game.countries).filter((c) => c.ownerId === a.id).length;
    const bc = Object.values(game.countries).filter((c) => c.ownerId === b.id).length;
    return bc - ac;
  });
  return (
    <div className="lobby-screen">
      <div className="lobby-card card">
        <span className="deed-eyebrow">Spiel beendet</span>
        <h1 className="display">{winner ? `${winner.name} regiert die Welt!` : "Spiel beendet"}</h1>
        <ul className="lobby-players">
          {ranking.map((p) => {
            const owned = Object.values(game.countries).filter((c) => c.ownerId === p.id).length;
            return (
              <li key={p.id}>
                <span className="ledger-swatch" style={{ background: p.color }} />
                {p.name} — {owned} Länder{p.eliminated && " (eliminiert)"}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ======================= App ======================= */

function App() {
  const [gameId, setGameId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PLAYER_COLORS[0]);
  const [selectedCountryId, setSelectedCountryId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const { state, youId, connected, error, send } = useGameSocket(gameId, name, color);

  function handleEnterRoom(id: string, playerName: string, playerColor: string) {
    setName(playerName);
    setColor(playerColor);
    setGameId(id.toUpperCase());
  }

  if (!state || !youId || state.phase === "lobby") {
    return (
      <Lobby
        onEnterRoom={handleEnterRoom}
        game={state}
        youId={youId}
        connected={connected}
        onStartGame={() => send({ type: "start_game" })}
        onAddBot={() => send({ type: "add_bot" })}
      />
    );
  }

  if (state.phase === "finished") {
    return <WinScreen game={state} />;
  }

  return (
    <div className="game-shell">
      <header className="topbar">
        <span className="topbar-title">Mini-Weltmacht</span>
        <span className="topbar-code mono">Raum {state.gameId}</span>
        <div className="topbar-actions">
          <button className="btn" onClick={() => setChatOpen((v) => !v)}>💬 Chat</button>
        </div>
      </header>
      <div className="game-main">
        <Globe game={state} selectedCountryId={selectedCountryId} onSelectCountry={setSelectedCountryId} />
        {chatOpen ? (
          <ChatPanel game={state} youId={youId} onSend={(text) => send({ type: "chat", text })} onClose={() => setChatOpen(false)} />
        ) : (
          <LogPanel game={state} />
        )}
      </div>
      <LedgerBar
        game={state}
        youId={youId}
        onEndTurn={() => send({ type: "end_turn" })}
        onSkipDisconnected={() => send({ type: "vote_skip_disconnected" })}
      />
      {selectedCountryId && (
        <CountryPanel
          game={state}
          youId={youId}
          countryId={selectedCountryId}
          onBuild={(amount) => send({ type: "build_military", countryId: selectedCountryId, amount })}
          onAttack={(fromCountryId) => send({ type: "attack", fromCountryId, targetCountryId: selectedCountryId })}
          onClose={() => setSelectedCountryId(null)}
        />
      )}
      {error && <div className="deed-warning" style={{ position: "fixed", bottom: 90, left: 16 }}>{error}</div>}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
