import React, { useState, useMemo } from 'react';
import {
  T, mono, sans, Btn, Field, Input, Select, Tag, Section, Empty, StatBox, Th, Td,
} from './ui.jsx';
import { fmtDate, fmtDateTime, weekId, weekIdOffset, lookbackWeeks } from '../lib/dates.js';

/* ============================================================
   ANALYTICS VIEW — founders only
   ============================================================ */

export function AnalyticsView({ users, teams, reports }) {
  const today = new Date();
  const [rangeMode, setRangeMode] = useState('last4'); // last4 | thisMonth | custom
  const [customStart, setCustomStart] = useState(toIso(addDays(today, -28)));
  const [customEnd, setCustomEnd] = useState(toIso(today));
  const [teamFilter, setTeamFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');

  const range = useMemo(() => {
    if (rangeMode === 'last4') {
      const start = new Date(); start.setDate(start.getDate() - 28); start.setHours(0,0,0,0);
      return { start: start.getTime(), end: Date.now() };
    }
    if (rangeMode === 'last12') {
      const start = new Date(); start.setDate(start.getDate() - 84); start.setHours(0,0,0,0);
      return { start: start.getTime(), end: Date.now() };
    }
    if (rangeMode === 'thisMonth') {
      const s = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
      return { start: s, end: Date.now() };
    }
    if (rangeMode === 'lastMonth') {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1).getTime();
      const e = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59).getTime();
      return { start: s, end: e };
    }
    // custom
    const s = new Date(customStart + 'T00:00:00').getTime();
    const e = new Date(customEnd + 'T23:59:59').getTime();
    return { start: s, end: e };
  }, [rangeMode, customStart, customEnd]); // eslint-disable-line

  const teamUsers = users.filter(u => u.role === 'team' && u.status === 'active');
  const filteredUsers = teamUsers.filter(u => {
    if (teamFilter !== 'all' && !u.teamIds.includes(teamFilter)) return false;
    if (userFilter !== 'all' && u.id !== userFilter) return false;
    return true;
  });
  const userIdSet = new Set(filteredUsers.map(u => u.id));

  const filteredReports = reports.filter(r =>
    r.submittedAt >= range.start && r.submittedAt <= range.end && userIdSet.has(r.userId)
  );

  // High-level stats
  const totalReports = filteredReports.length;
  const lateCount = filteredReports.filter(r => r.isLate).length;
  const blockedCount = filteredReports.filter(r => r.hasBlockers).length;
  const onTimeRate = totalReports ? Math.round(((totalReports - lateCount) / totalReports) * 100) : 0;
  // expected reports = users * weeks in range
  const weeksInRange = Math.max(1, Math.ceil((range.end - range.start) / (7 * 86400000)));
  const expected = filteredUsers.length * weeksInRange;
  const completionRate = expected ? Math.round((totalReports / expected) * 100) : 0;

  // Per-user breakdown
  const perUser = filteredUsers.map(u => {
    const rs = filteredReports.filter(r => r.userId === u.id);
    return {
      user: u,
      total: rs.length,
      late: rs.filter(r => r.isLate).length,
      blocked: rs.filter(r => r.hasBlockers).length,
      onTime: rs.filter(r => !r.isLate).length,
      lastSubmitted: rs.length ? Math.max(...rs.map(r => r.submittedAt)) : null,
    };
  }).sort((a, b) => b.total - a.total);

  // Active blockers across the range
  const activeBlockers = filteredReports.filter(r => r.hasBlockers && !r.blockerResolved);

  const exportCsv = () => {
    downloadCsv(filteredReports, users, teams, range);
  };

  const exportJson = () => {
    downloadJson(filteredReports, users, teams, range);
  };

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        borderBottom: `1px solid ${T.ink}`, paddingBottom: 12, marginBottom: 24,
        flexWrap: 'wrap', gap: 8,
      }}>
        <div>
          <div style={{ ...mono, fontSize: 11, color: T.muted, letterSpacing: '0.16em' }}>// ANALYTICS</div>
          <h1 style={{ ...sans, margin: '4px 0 0', fontSize: 24, fontWeight: 500 }}>Reports analytics</h1>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn onClick={exportCsv} disabled={!totalReports}>↓ EXPORT CSV</Btn>
          <Btn variant="ghost" onClick={exportJson} disabled={!totalReports}>↓ JSON</Btn>
        </div>
      </div>

      {/* Filters row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Field label="range">
          <Select value={rangeMode} onChange={setRangeMode} options={[
            { value: 'last4', label: 'Last 4 weeks' },
            { value: 'last12', label: 'Last 12 weeks' },
            { value: 'thisMonth', label: 'This month' },
            { value: 'lastMonth', label: 'Last month' },
            { value: 'custom', label: 'Custom range' },
          ]} />
        </Field>
        {rangeMode === 'custom' && <>
          <Field label="from"><Input type="date" value={customStart} onChange={setCustomStart} /></Field>
          <Field label="to"><Input type="date" value={customEnd} onChange={setCustomEnd} /></Field>
        </>}
        <Field label="team">
          <Select value={teamFilter} onChange={setTeamFilter}
            options={[{ value: 'all', label: 'All teams' }, ...teams.map(t => ({ value: t.id, label: t.name }))]} />
        </Field>
        <Field label="user">
          <Select value={userFilter} onChange={setUserFilter}
            options={[{ value: 'all', label: 'All users' }, ...teamUsers.map(u => ({ value: u.id, label: u.name }))]} />
        </Field>
      </div>

      <div style={{ ...mono, fontSize: 11, color: T.muted, marginBottom: 14, letterSpacing: '0.06em' }}>
        {fmtDate(range.start)} → {fmtDate(range.end)} · {weeksInRange} WEEK{weeksInRange === 1 ? '' : 'S'} · {filteredUsers.length} USER{filteredUsers.length === 1 ? '' : 'S'}
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatBox label="REPORTS" value={totalReports} sub={expected ? `of ${expected} expected` : undefined} />
        <StatBox label="COMPLETION" value={`${completionRate}%`}
                 color={completionRate >= 80 ? 'green' : completionRate >= 50 ? 'amber' : 'red'} />
        <StatBox label="ON-TIME" value={`${onTimeRate}%`}
                 color={onTimeRate >= 80 ? 'green' : onTimeRate >= 50 ? 'amber' : 'red'} />
        <StatBox label="LATE" value={lateCount} color={lateCount ? 'amber' : 'ink'} />
        <StatBox label="BLOCKERS" value={blockedCount} color={blockedCount ? 'red' : 'ink'} />
        <StatBox label="UNRESOLVED" value={activeBlockers.length} color={activeBlockers.length ? 'red' : 'green'} />
      </div>

      {/* Per-user breakdown */}
      <Section title={`Per User · ${perUser.length}`} dense>
        <div style={{ border: `1px solid ${T.ink}`, overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', ...mono, fontSize: 12 }}>
            <thead>
              <tr style={{ background: T.bgAlt, borderBottom: `1px solid ${T.ink}` }}>
                <Th w="22%">USER</Th>
                <Th w="18%">TEAMS</Th>
                <Th w="10%">REPORTS</Th>
                <Th w="10%">ON-TIME</Th>
                <Th w="10%">LATE</Th>
                <Th w="10%">BLOCKED</Th>
                <Th w="20%">LAST SUBMITTED</Th>
              </tr>
            </thead>
            <tbody>
              {perUser.map(({ user, total, late, blocked, onTime, lastSubmitted }) => {
                const teamNames = user.teamIds.map(id => teams.find(t => t.id === id)?.name).filter(Boolean);
                return (
                  <tr key={user.id} style={{ borderBottom: `1px solid ${T.ruleSoft}` }}>
                    <Td>
                      <div style={{ ...sans, fontSize: 13, fontWeight: 500 }}>{user.name}</div>
                      <div style={{ ...mono, fontSize: 10, color: T.muted }}>{user.email}</div>
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {teamNames.map(n => <Tag key={n} color="muted">{n}</Tag>)}
                      </div>
                    </Td>
                    <Td><span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>{total}</span></Td>
                    <Td><span style={{ color: T.green, fontVariantNumeric: 'tabular-nums' }}>{onTime}</span></Td>
                    <Td><span style={{ color: late ? T.amber : T.muted, fontVariantNumeric: 'tabular-nums' }}>{late}</span></Td>
                    <Td><span style={{ color: blocked ? T.red : T.muted, fontVariantNumeric: 'tabular-nums' }}>{blocked}</span></Td>
                    <Td>{lastSubmitted ? fmtDateTime(lastSubmitted) : <span style={{ color: T.muted }}>—</span>}</Td>
                  </tr>
                );
              })}
              {perUser.length === 0 && (
                <tr><td colSpan={7}><Empty>No users match these filters.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* All blockers in range — quick scan */}
      <Section title={`Blockers in range · ${filteredReports.filter(r => r.hasBlockers).length}`} dense>
        {filteredReports.filter(r => r.hasBlockers).length === 0 ? (
          <Empty>No blockers reported in this range.</Empty>
        ) : (
          <div>
            {filteredReports.filter(r => r.hasBlockers)
              .sort((a, b) => b.submittedAt - a.submittedAt)
              .map(r => {
                const u = users.find(x => x.id === r.userId);
                return (
                  <div key={r.id} style={{
                    border: `1px solid ${T.ruleSoft}`, borderLeft: `3px solid ${r.blockerResolved ? T.green : T.red}`,
                    padding: 10, marginBottom: 8, background: T.bg,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ ...sans, fontSize: 13, fontWeight: 500 }}>{u?.name || 'Unknown'}</div>
                      <div style={{ ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.06em' }}>
                        {r.weekId} · {fmtDate(r.submittedAt)}
                        {r.blockerResolved && <> · <Tag color="green">RESOLVED</Tag></>}
                      </div>
                    </div>
                    <div style={{ ...sans, fontSize: 13, lineHeight: 1.5, color: T.ink }}>{r.blockers}</div>
                  </div>
                );
              })}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ---------- HELPERS ---------- */

function toIso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function csvEscape(s) {
  if (s == null) return '';
  const v = String(s);
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function downloadCsv(reports, users, teams, range) {
  const headers = [
    'week_id', 'submitted_at', 'user_name', 'user_email', 'role', 'teams',
    'last_week', 'this_week', 'blockers', 'has_blockers', 'is_late', 'blocker_resolved',
  ];
  const lines = [headers.join(',')];
  for (const r of reports) {
    const u = users.find(x => x.id === r.userId);
    const teamNames = u ? u.teamIds.map(id => teams.find(t => t.id === id)?.name).filter(Boolean).join(' | ') : '';
    lines.push([
      csvEscape(r.weekId),
      csvEscape(new Date(r.submittedAt).toISOString()),
      csvEscape(u?.name || ''),
      csvEscape(u?.email || ''),
      csvEscape(u?.role || ''),
      csvEscape(teamNames),
      csvEscape(r.lastWeek),
      csvEscape(r.thisWeek),
      csvEscape(r.blockers || ''),
      csvEscape(r.hasBlockers),
      csvEscape(r.isLate),
      csvEscape(r.blockerResolved),
    ].join(','));
  }
  const filename = `katagoge-reports-${toIso(new Date(range.start))}-to-${toIso(new Date(range.end))}.csv`;
  triggerDownload(lines.join('\r\n'), filename, 'text/csv;charset=utf-8');
}

function downloadJson(reports, users, teams, range) {
  const enriched = reports.map(r => {
    const u = users.find(x => x.id === r.userId);
    return {
      ...r,
      user: u ? { id: u.id, name: u.name, email: u.email, role: u.role, teamIds: u.teamIds } : null,
    };
  });
  const payload = {
    generated_at: new Date().toISOString(),
    range: { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() },
    teams: teams.map(t => ({ id: t.id, name: t.name })),
    reports: enriched,
  };
  const filename = `katagoge-reports-${toIso(new Date(range.start))}-to-${toIso(new Date(range.end))}.json`;
  triggerDownload(JSON.stringify(payload, null, 2), filename, 'application/json');
}

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
