function chooseMove(state, me) {
  const capture = state.legalMoves.find((move) =>
    move.type === "move" && state.board[move.to] !== null
  );
  return capture || state.legalMoves[0];
}
