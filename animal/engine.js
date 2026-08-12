export const PLAYERS = Object.freeze({ FIRST: "P1", SECOND: "P2" });
export const PIECES = Object.freeze({
  LION: "lion",
  GIRAFFE: "giraffe",
  ELEPHANT: "elephant",
  CHICK: "chick",
  HEN: "hen",
});

export const PIECE_INFO = Object.freeze({
  lion: { name: "라이온", symbol: "🦁" },
  giraffe: { name: "기린", symbol: "🦒" },
  elephant: { name: "코끼리", symbol: "🐘" },
  chick: { name: "병아리", symbol: "🐥" },
  hen: { name: "닭", symbol: "🐔" },
});

const STATIC_DIRECTIONS = Object.freeze({
  lion: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
  giraffe: [[-1, 0], [0, -1], [0, 1], [1, 0]],
  elephant: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
});

export function initialState() {
  return {
    board: [
      piece("P2", "giraffe"), piece("P2", "lion"), piece("P2", "elephant"),
      null, piece("P2", "chick"), null,
      null, piece("P1", "chick"), null,
      piece("P1", "elephant"), piece("P1", "lion"), piece("P1", "giraffe"),
    ],
    hands: {
      P1: { chick: 0, elephant: 0, giraffe: 0 },
      P2: { chick: 0, elephant: 0, giraffe: 0 },
    },
    turn: "P1",
    ply: 0,
    pendingTry: null,
    winner: null,
    reason: null,
  };
}

export function piece(owner, type) {
  return { owner, type };
}

export function cloneState(state) {
  return {
    board: state.board.map((item) => item ? { ...item } : null),
    hands: {
      P1: { ...state.hands.P1 },
      P2: { ...state.hands.P2 },
    },
    turn: state.turn,
    ply: state.ply ?? 0,
    pendingTry: state.pendingTry ?? null,
    winner: state.winner ?? null,
    reason: state.reason ?? null,
  };
}

export function otherPlayer(player) {
  return player === "P1" ? "P2" : "P1";
}

export function rowCol(index) {
  return [Math.floor(index / 3), index % 3];
}

export function indexOf(row, column) {
  return row * 3 + column;
}

export function coordinate(index) {
  const [row, column] = rowCol(index);
  return `${String.fromCharCode(65 + column)}${row + 1}`;
}

export function directions(type, owner) {
  if (STATIC_DIRECTIONS[type]) return STATIC_DIRECTIONS[type];
  const forward = owner === "P1" ? -1 : 1;
  if (type === "chick") return [[forward, 0]];
  if (type === "hen") {
    return [[forward, -1], [forward, 0], [forward, 1], [0, -1], [0, 1], [-forward, 0]];
  }
  throw new Error(`알 수 없는 말 종류: ${type}`);
}

/**
 * 동물장기에는 왕이 잡히는 칸으로 이동할 수 없다는 금지 규칙이 없다.
 * 따라서 여기서는 말의 이동 방식과 내 말 점유 여부만 검사한다.
 */
export function legalMoves(state, player = state.turn) {
  if (state.winner || player !== state.turn) return [];
  const moves = [];

  for (let from = 0; from < 12; from += 1) {
    const moving = state.board[from];
    if (!moving || moving.owner !== player) continue;
    const [row, column] = rowCol(from);
    for (const [dr, dc] of directions(moving.type, player)) {
      const nextRow = row + dr;
      const nextColumn = column + dc;
      if (nextRow < 0 || nextRow >= 4 || nextColumn < 0 || nextColumn >= 3) continue;
      const to = indexOf(nextRow, nextColumn);
      const target = state.board[to];
      if (!target || target.owner !== player) moves.push({ type: "move", from, to });
    }
  }

  for (const type of ["chick", "elephant", "giraffe"]) {
    if (!state.hands[player][type]) continue;
    for (let to = 0; to < 12; to += 1) {
      if (!state.board[to]) moves.push({ type: "drop", piece: type, to });
    }
  }
  return moves;
}

export function sameMove(left, right) {
  return Boolean(left && right
    && left.type === right.type
    && left.to === right.to
    && left.from === right.from
    && left.piece === right.piece);
}

export function captureMoves(state, player = state.turn) {
  return legalMoves(state, player).filter((move) => (
    move.type === "move" && state.board[move.to]?.owner === otherPlayer(player)
  ));
}

export function lionCaptureMoves(state, player = state.turn) {
  return legalMoves(state, player).filter((move) => (
    move.type === "move" && state.board[move.to]?.type === "lion"
  ));
}

export function applyMove(state, requestedMove, { validate = true } = {}) {
  if (state.winner) throw new Error("이미 끝난 대국입니다.");
  const player = state.turn;
  const move = validate
    ? legalMoves(state, player).find((candidate) => sameMove(candidate, requestedMove))
    : requestedMove;
  if (!move) throw new Error("합법 수가 아닙니다.");

  const next = cloneState(state);
  let capturedLion = false;

  if (move.type === "drop") {
    if (!next.hands[player][move.piece]) throw new Error("보유하지 않은 말입니다.");
    next.hands[player][move.piece] -= 1;
    next.board[move.to] = piece(player, move.piece);
  } else {
    const moving = next.board[move.from];
    const captured = next.board[move.to];
    next.board[move.from] = null;
    next.board[move.to] = moving;

    if (captured) {
      if (captured.type === "lion") {
        capturedLion = true;
      } else {
        const handType = captured.type === "hen" ? "chick" : captured.type;
        next.hands[player][handType] += 1;
      }
    }

    const [destinationRow] = rowCol(move.to);
    if (moving.type === "chick" && isFarRank(player, destinationRow)) moving.type = "hen";
  }

  next.ply += 1;
  next.turn = otherPlayer(player);

  if (capturedLion) {
    next.winner = player;
    next.reason = "상대 라이온을 잡았습니다.";
    next.pendingTry = null;
    return next;
  }

  // 상대가 직전 수에 트라이했는데 이번 수로 잡지 않았다면 상대의 승리다.
  if (state.pendingTry && state.pendingTry !== player) {
    next.winner = state.pendingTry;
    next.reason = "트라이한 라이온이 다음 수에도 살아남았습니다.";
    next.pendingTry = null;
    return next;
  }

  next.pendingTry = null;
  if (move.type === "move" && next.board[move.to]?.type === "lion") {
    const [destinationRow] = rowCol(move.to);
    if (isFarRank(player, destinationRow)) next.pendingTry = player;
  }

  // 잡을 방법이 전혀 없는 트라이는 기다릴 필요 없이 즉시 확정할 수 있다.
  if (next.pendingTry && lionCaptureMoves(next, next.turn).length === 0) {
    next.winner = next.pendingTry;
    next.reason = "안전한 트라이에 성공했습니다.";
    next.pendingTry = null;
  }
  return next;
}

export function withDraw(state, reason = "같은 국면이 세 번 반복되었습니다.") {
  const next = cloneState(state);
  next.winner = "DRAW";
  next.reason = reason;
  return next;
}

export function isFarRank(player, row) {
  return player === "P1" ? row === 0 : row === 3;
}

export function stateKey(state) {
  const board = state.board.map((item) => {
    if (!item) return "0";
    const owner = item.owner === "P1" ? "1" : "2";
    const type = { lion: "L", giraffe: "G", elephant: "E", chick: "C", hen: "H" }[item.type];
    return owner + type;
  }).join(".");
  const hand = (player) => ["chick", "elephant", "giraffe"]
    .map((type) => state.hands[player][type]).join("");
  return `${state.turn}|${board}|${hand("P1")}|${hand("P2")}|${state.pendingTry ?? "-"}`;
}

export function mirrorKey(state) {
  const mirrored = cloneState(state);
  for (let row = 0; row < 4; row += 1) {
    [mirrored.board[indexOf(row, 0)], mirrored.board[indexOf(row, 2)]] = [
      mirrored.board[indexOf(row, 2)], mirrored.board[indexOf(row, 0)],
    ];
  }
  const normal = stateKey(state);
  const mirror = stateKey(mirrored);
  return normal < mirror ? normal : mirror;
}

export function moveNotation(state, move) {
  if (!move) return "—";
  if (move.type === "drop") return `${PIECE_INFO[move.piece].name}*${coordinate(move.to)}`;
  const moving = state.board[move.from];
  const capture = state.board[move.to] ? "x" : "-";
  return `${PIECE_INFO[moving.type].name} ${coordinate(move.from)}${capture}${coordinate(move.to)}`;
}

export function assertValidState(state) {
  if (!Array.isArray(state.board) || state.board.length !== 12) throw new Error("보드는 12칸이어야 합니다.");
  for (const player of ["P1", "P2"]) {
    const lions = state.board.filter((item) => item?.owner === player && item.type === "lion").length;
    if (!state.winner && lions !== 1) throw new Error(`${player} 라이온 수가 올바르지 않습니다.`);
  }
  const totals = { chick: 0, elephant: 0, giraffe: 0 };
  for (const item of state.board) {
    if (!item || item.type === "lion") continue;
    totals[item.type === "hen" ? "chick" : item.type] += 1;
  }
  for (const player of ["P1", "P2"]) {
    for (const type of Object.keys(totals)) totals[type] += state.hands[player][type];
  }
  for (const type of Object.keys(totals)) {
    if (totals[type] !== 2) throw new Error(`${type} 말의 총수가 2가 아닙니다.`);
  }
  return true;
}
