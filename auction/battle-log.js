const LABELS = Object.freeze({ win: "승리", draw: "무승부", loss: "패배", error: "오류" });

export function fairSideSchedule(gameCount) {
  if (!Number.isInteger(gameCount) || gameCount < 2 || gameCount % 2 !== 0) throw new Error("공정한 대전을 위해 경기 수는 2 이상의 짝수여야 합니다.");
  return Array.from({ length: gameCount }, (_, index) => index % 2 === 0 ? "P1" : "P2");
}

export function formatBattleLog(log) {
  const lines = [
    "Starlight Auction AI 대전 로그",
    "================================",
    `규칙: starlight-auction / ${log.rulesVersion}`,
    `경기: #${log.sequence} · 시드 ${log.seed}`,
    `상대: ${log.opponentName} (${log.opponent})`,
    `내 AI 진영: ${log.customSide}`,
    `코드 파일: ${log.codeFileName || "my-auction-ai.js"}`,
    `결과: ${LABELS[log.result] ?? log.result}`,
    `종료 사유: ${log.reason || "—"}`,
    `총 행동: ${log.plies}`,
    `제한: ${log.timeoutMs}ms/행동 · 최대 ${log.maxPlies}행동`,
    "",
    "행동",
    "----",
  ];
  if (!log.actions.length) lines.push("행동 기록 없음");
  for (const action of log.actions) {
    const timing = Number.isFinite(action.elapsedMs) ? ` · ${action.elapsedMs}ms` : "";
    lines.push(`${action.ply}. ${action.side} ${action.actor} · ${action.text}${timing} · C ${action.credits} · F ${action.favor} · SCORE ${action.score}`);
  }
  if (log.error) lines.push("", `오류: ${log.error}`);
  return `${lines.join("\n")}\n`;
}

export function battleLogFilename(log) {
  const opponent = String(log.opponent || "ai").replace(/[^a-z0-9_-]/gi, "-");
  return `starlight-auction-${opponent}-${log.seed}-game-${String(log.sequence).padStart(2, "0")}-${log.result}.txt`;
}
