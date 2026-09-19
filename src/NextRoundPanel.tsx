import { useMemo } from 'react';
import type { DraftPair, Player, Round } from './types';
import {
  computeStandings,
  generatePairing,
  points2Label,
  type PairingPlan,
  type PlanPair,
  type Standing,
} from './engine';
import { uid } from './uid';

interface Props {
  players: Player[];
  rounds: Round[];
  manual: DraftPair[];
  onManualChange: (rows: DraftPair[]) => void;
  absentIds: string[];
  onAbsentChange: (ids: string[]) => void;
  onCommit: (plan: PairingPlan) => void;
}

export function NextRoundPanel({
  players,
  rounds,
  manual,
  onManualChange,
  absentIds,
  onAbsentChange,
  onCommit,
}: Props) {
  const roundNo = rounds.length + 1;
  const standings = useMemo(() => computeStandings(players, rounds), [players, rounds]);
  const standingById = useMemo(() => new Map(standings.map((s) => [s.player.id, s])), [standings]);

  // 缺席名单只过滤本轮出席者：不删除选手、不改动历史积分
  const absentSet = useMemo(() => new Set(absentIds), [absentIds]);
  const activePlayers = useMemo(() => players.filter((p) => !absentSet.has(p.id)), [players, absentSet]);

  // 未填写完整的锁定行不参与引擎，单独提示
  const incomplete = manual.filter((r) => r.locked && (!r.aId || !r.bId));
  const completeManual = useMemo(() => manual.filter((r) => r.locked && r.aId && r.bId), [manual]);
  const plan = useMemo(
    () => generatePairing({ players, rounds, manual: completeManual, absentIds }),
    [players, rounds, completeManual, absentIds],
  );

  // 未填写完整的锁定行不进引擎：若其已选一方恰好被标记缺席，仍要立即阻止确认并指出冲突
  const extraConflicts = useMemo(() => {
    const out: { message: string }[] = [];
    for (const r of manual) {
      if (!r.locked || (r.aId && r.bId)) continue;
      const absentPid = [r.aId, r.bId].find((pid) => pid && absentSet.has(pid));
      if (!absentPid) continue;
      const present = [r.aId, r.bId].find((pid) => pid && pid !== absentPid);
      const na = standingById.get(absentPid)?.player.name ?? absentPid;
      const other = present ? standingById.get(present)?.player.name ?? present : null;
      out.push({
        message: other
          ? `锁定对局中「${na}」已被标记为本轮缺席，无法确认：请取消其缺席，或移除与「${other}」的该条锁定（该行尚未填写完整）。`
          : `锁定对局中的「${na}」已被标记为本轮缺席，无法确认：请取消其缺席或移除该锁定行。`,
      });
    }
    return out;
  }, [manual, absentSet, standingById]);

  const blocked = extraConflicts.length > 0;

  const lastRound = rounds[rounds.length - 1];
  const pendingResults = lastRound
    ? lastRound.matches.some((m) => !m.bye && m.playerBId !== null && m.resultA === null)
    : false;

  const updateRow = (id: string, patch: Partial<DraftPair>) => {
    onManualChange(manual.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRow = (id: string) => onManualChange(manual.filter((r) => r.id !== id));
  const addRow = () =>
    onManualChange([...manual, { id: uid('lock'), aId: '', bId: '', locked: true }]);

  /** 切换某选手本轮出席/缺席；取消缺席后配对、轮空候选与锁定校验即时重算 */
  const toggleAbsent = (id: string) => {
    onAbsentChange(absentSet.has(id) ? absentIds.filter((x) => x !== id) : [...absentIds, id]);
  };

  /** 锁定引擎给出的一条自由对局 */
  const lockPlanPair = (p: PlanPair) => {
    onManualChange([
      ...manual,
      { id: uid('lock'), aId: p.aId, bId: p.bId, locked: true },
    ]);
  };

  const usedIds = new Set<string>();
  for (const r of manual) {
    if (r.aId) usedIds.add(r.aId);
    if (r.bId) usedIds.add(r.bId);
  }
  if (plan.byeId) usedIds.add(plan.byeId);

  return (
    <section className="card highlight">
      <div className="card-head">
        <h2>第 {roundNo} 轮对阵工作区</h2>
        <span className="pill">规则自动重算</span>
      </div>

      {players.length < 2 ? (
        <p className="hint">至少添加 2 名选手后才能生成对阵。</p>
      ) : (
        <>
          {pendingResults && (
            <p className="hint warn">
              ⚠ 上一轮仍有赛果未录入，当前积分与配对可能不符合预期，请先补录上一轮赛果。
            </p>
          )}

          <AbsencePicker
            standings={standings}
            absentSet={absentSet}
            activeCount={activePlayers.length}
            onToggle={toggleAbsent}
          />

          <div className="row wrap">
            <button className="btn primary" onClick={() => onManualChange([])}>
              {manual.length > 0 ? '清除全部锁定并重新生成' : '重新生成对阵'}
            </button>
            <button className="btn" onClick={addRow}>
              ＋ 添加人工指定对局
            </button>
            {plan.ok && !blocked && (
              <button
                className="btn success"
                onClick={() => onCommit(plan)}
                title="将当前方案（含轮空与缺席名单）写入新一轮"
              >
                ✓ 确认方案，进入第 {roundNo} 轮
              </button>
            )}
          </div>

          {/* 人工锁定行 */}
          {manual.length > 0 && (
            <div className="manual-box">
              <h3>人工锁定对局</h3>
              {manual.map((row) => (
                <ManualRow
                  key={row.id}
                  row={row}
                  players={players}
                  usedIds={usedIds}
                  absentSet={absentSet}
                  standingById={standingById}
                  onChange={(patch) => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </div>
          )}
          {incomplete.length > 0 && (
            <p className="hint warn">有 {incomplete.length} 条锁定对局未选择双方，暂未参与计算。</p>
          )}

          {/* 冲突 */}
          {(!plan.ok || blocked) && (
            <div className="conflicts">
              <h3>✕ 当前约束无可行配对，冲突原因：</h3>
              <ol>
                {extraConflicts.map((c, i) => (
                  <li key={`x${i}`}>{c.message}</li>
                ))}
                {plan.conflicts.map((c, i) => (
                  <li key={i}>{c.message}</li>
                ))}
              </ol>
            </div>
          )}

          {/* 方案展示 */}
          {plan.ok && (
            <>
              <div className="stats">
                <span className="stat">
                  出席 <b>{activePlayers.length}</b>
                  {absentIds.length > 0 && (
                    <span className="muted"> / 缺席 {absentIds.length}</span>
                  )}
                </span>
                <span className="stat">
                  对局数 <b>{plan.pairs.length}</b>
                </span>
                <span className="stat">
                  同队对局{' '}
                  <b className={plan.teamConflictCount > 0 ? 'danger-text' : ''}>
                    {plan.teamConflictCount}
                  </b>
                </span>
                <span className="stat">
                  跨积分组对局 <b className={plan.crossCount > 0 ? 'accent' : ''}>{plan.crossCount}</b>
                </span>
                <span className="stat">
                  总积分差 <b>{points2Label(plan.totalDiff2)}</b>
                </span>
                {plan.optimal ? (
                  <span className="tag ok">已最小化（最优）</span>
                ) : (
                  <span className="tag warn">可行方案（未证明最优）</span>
                )}
              </div>

              <p className="hint">
                目标顺序：① 禁止重复交手 → ② 同队对局数最少 → ③ 跨积分组对局数最少 → ④ 双方总积分差之和最小。
                人工锁定的同队对局允许保留，且计入方案指标。
              </p>

              {plan.teamConflictCount > 0 && (
                <div className="team-conflict-box">
                  ⚠ 无法完全回避同队对局，最少需要{' '}
                  <b>{plan.teamConflictCount}</b> 场（涉及选手见下方红色「同队」标记）。
                  {plan.note && <div className="muted">{plan.note}</div>}
                </div>
              )}

              {plan.byeId && (
                <div className="bye-box">
                  本轮轮空（出席人数为奇数）：
                  <b>{standingById.get(plan.byeId)?.player.name}</b>
                  <span className="muted">
                    （{points2Label(standingById.get(plan.byeId)?.points2 ?? 0)} 分
                    {standingById.get(plan.byeId)?.hadBye ? '' : '，此前未轮空'}，计 1 分）
                  </span>
                </div>
              )}

              {absentIds.length > 0 && (
                <div className="absent-box">
                  本轮缺席（共 {absentIds.length} 人，不参与配对与轮空，积分不变）：
                  <span className="absent-names">
                    {absentIds
                      .map(
                        (id) =>
                          players.find((p) => p.id === id)?.name ?? '（已删除选手）',
                      )
                      .join('、')}
                  </span>
                </div>
              )}

              <ul className="plan-list">
                {plan.pairs.map((p, i) => {
                  const sa = standingById.get(p.aId)!;
                  const sb = standingById.get(p.bId)!;
                  return (
                    <li
                      key={`${p.aId}-${p.bId}`}
                      className={`${p.locked ? 'locked' : ''} ${p.sameTeam ? 'team-conflict' : ''}`}
                    >
                      <span className="idx">{i + 1}</span>
                      <span className="plan-names">
                        <PlayerChip s={sa} />
                        <span className="vs">vs</span>
                        <PlayerChip s={sb} />
                      </span>
                      <span className="plan-tags">
                        {p.sameTeam && (
                          <span className="tag team">同队 · {sa.player.team?.trim()}</span>
                        )}
                        {p.crossGroup && <span className="tag cross">跨组</span>}
                        {p.diff2 > 0 && (
                          <span className="tag">Δ {points2Label(p.diff2)}</span>
                        )}
                        {!p.crossGroup && p.diff2 === 0 && !p.sameTeam && (
                          <span className="tag ok">同分组</span>
                        )}
                        {p.locked ? (
                          <span className="tag lock">🔒 锁定</span>
                        ) : (
                          <button
                            className="btn tiny"
                            onClick={() => lockPlanPair(p)}
                            title="锁定此对局后，其余选手将在此约束下重新配对"
                          >
                            🔒 锁定此场
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {plan.warnings.length > 0 && (
                <ul className="warnings">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function PlayerChip({ s }: { s: Standing }) {
  const team = s.player.team?.trim();
  return (
    <span className="chip">
      {s.player.name}
      {team && <em className="chip-team">{team}</em>}
      <em>{points2Label(s.points2)}</em>
    </span>
  );
}

/** 本轮出席勾选区：勾选即缺席；缺席只作用于下一轮，不删除选手也不改动历史积分 */
function AbsencePicker({
  standings,
  absentSet,
  activeCount,
  onToggle,
}: {
  standings: Standing[];
  absentSet: Set<string>;
  activeCount: number;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="absent-picker">
      <div className="absent-picker-head">
        <h3>本轮出席</h3>
        <span className="pill">
          出席 {activeCount} · 缺席 {absentSet.size}
        </span>
      </div>
      <p className="hint">
        取消勾选即标记为「本轮缺席」：不参与配对、轮空候选与人工锁定；选手不会被删除，历史积分不变，下一轮默认重新出席。
      </p>
      <ul className="absent-list">
        {standings.map((s) => {
          const absent = absentSet.has(s.player.id);
          return (
            <li key={s.player.id} className={absent ? 'absent' : ''}>
              <label>
                <input
                  type="checkbox"
                  checked={!absent}
                  onChange={() => onToggle(s.player.id)}
                />
                <span className="absent-name">{s.player.name}</span>
                <em className="muted">{points2Label(s.points2)} 分</em>
                {absent && <span className="tag warn">本轮缺席</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ManualRow({
  row,
  players,
  usedIds,
  absentSet,
  standingById,
  onChange,
  onRemove,
}: {
  row: DraftPair;
  players: Player[];
  usedIds: Set<string>;
  absentSet: Set<string>;
  standingById: Map<string, Standing>;
  onChange: (patch: Partial<DraftPair>) => void;
  onRemove: () => void;
}) {
  const sorted = [...players].sort((a, b) => {
    const sa = standingById.get(a.id);
    const sb = standingById.get(b.id);
    if (!sa || !sb) return 0;
    if (sb.points2 !== sa.points2) return sb.points2 - sa.points2;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

  // 缺席者不出现在下拉候选中（已被选中的除外，该行会以红色标出冲突）
  const optionsFor = (self: string, other: string | null) =>
    sorted.filter(
      (p) =>
        p.id === self ||
        (other !== null && p.id === other) ||
        (!usedIds.has(p.id) && !absentSet.has(p.id)),
    );

  const warn =
    !row.aId ||
    !row.bId ||
    (!!row.aId && absentSet.has(row.aId)) ||
    (!!row.bId && absentSet.has(row.bId));

  return (
    <div className={`manual-row ${warn ? 'incomplete' : ''}`}>
      <span className="tag lock">🔒</span>
      <select
        value={row.aId}
        onChange={(e) => onChange({ aId: e.target.value })}
        className={row.aId && absentSet.has(row.aId) ? 'absent-select' : ''}
      >
        <option value="">选择选手 A…</option>
        {optionsFor(row.aId, row.bId ?? null).map((p) => (
          <option key={p.id} value={p.id}>
            {standingById.get(p.id)?.player.name ?? p.name}
            {p.team?.trim() ? `（${p.team.trim()}）` : ''}
            {absentSet.has(p.id) ? '（本轮缺席）' : ''}
          </option>
        ))}
      </select>
      <span className="vs">vs</span>
      <select
        value={row.bId ?? ''}
        onChange={(e) => onChange({ bId: e.target.value })}
        className={row.bId && absentSet.has(row.bId) ? 'absent-select' : ''}
      >
        <option value="">选择选手 B…</option>
        {optionsFor(row.bId ?? '', row.aId).map((p) => (
          <option key={p.id} value={p.id}>
            {standingById.get(p.id)?.player.name ?? p.name}
            {p.team?.trim() ? `（${p.team.trim()}）` : ''}
            {absentSet.has(p.id) ? '（本轮缺席）' : ''}
          </option>
        ))}
      </select>
      <button className="btn tiny danger" onClick={onRemove}>
        移除
      </button>
    </div>
  );
}
