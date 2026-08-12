const RESULT_LABELS = Object.freeze({ win: "승리", draw: "무승부", loss: "패배" });

export function battleResultLabel(result) {
  return RESULT_LABELS[result] ?? result;
}

export function fairSideSchedule(gameCount) {
  if (!Number.isInteger(gameCount) || gameCount < 2 || gameCount % 2 !== 0) {
    throw new Error("공정한 대전을 위해 경기 수는 2 이상의 짝수여야 합니다.");
  }
  return Array.from({ length: gameCount }, (_, index) => index % 2 === 0 ? "P1" : "P2");
}

export function formatBattleLog(log) {
  const sideLabel = log.customSide === "P1" ? "P1 · 선공(아래쪽)" : "P2 · 후공(위쪽)";
  const lines = [
    "동물장기 AI 대전 로그",
    "=====================",
    `경기: #${log.sequence}`,
    `상대: ${log.opponentName} (${log.opponent})`,
    `내 AI: ${sideLabel}`,
    `코드 파일: ${log.codeFileName || "my-animal-ai.js"}`,
    `결과: ${battleResultLabel(log.result)}`,
    `종료 사유: ${log.reason || "—"}`,
    `총 수: ${log.plies}수`,
    `시각: ${log.playedAt}`,
    "",
    "수순",
    "----",
  ];

  if (!log.moves.length) lines.push("착수 기록 없음");
  for (const move of log.moves) {
    const timing = Number.isFinite(move.elapsedMs) ? ` · ${move.elapsedMs}ms` : "";
    lines.push(`${move.ply}. ${move.side} ${move.actor} · ${move.notation}${timing}`);
  }
  if (log.error) lines.push("", `오류: ${log.error}`);
  return `${lines.join("\n")}\n`;
}

export function battleLogFilename(log) {
  const level = String(log.opponent || "ai").replace(/[^a-z0-9_-]/gi, "-");
  const number = String(log.sequence).padStart(2, "0");
  return `animal-shogi-${level}-game-${number}-${log.result}.txt`;
}
