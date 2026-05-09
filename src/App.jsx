import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, auth, uid } from './lib/db.js';
import { attach } from './lib/v2.js';
import { applyTheme, getStoredTheme, listThemes } from './lib/theme.js';
import {
  weekId, weekIdOffset, mondayOfWeek, fmtDate, fmtDateTime, relTime, lookbackWeeks,
} from './lib/dates.js';
import { COMPANY, FEATURES } from './config.js';
import {
  T, mono, sans, useIsMobile,
  Btn, Field, Input, Textarea, Select, Tag, StatusDot, Section, StatBox, Toast, Empty, Modal, Th, Td, Picker,
} from './components/ui.jsx';
import { AttachmentList, AttachmentPicker } from './components/Attachments.jsx';
import { ChatPanel } from './components/Chat.jsx';
import { AnalyticsView } from './components/Analytics.jsx';

function computeStreak(userReports) {
  const weeks = lookbackWeeks(12);
  let streak = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    const r = userReports.find(x => x.weekId === weeks[i]);
    if (r && !r.isLate) streak++;
    else break;
  }
  return streak;
}

function detectCarryOver(prevReport, currentPlanText) {
  if (!prevReport || !currentPlanText) return false;
  const plan = (prevReport.thisWeek || '').toLowerCase();
  const words = plan.split(/\s+/).filter(w => w.length > 3);
  if (words.length < 6) return false;
  const cur = (currentPlanText || '').toLowerCase();
  let hits = 0;
  for (const w of words) if (cur.includes(w)) hits++;
  return hits / words.length > 0.5;
}

function isMessageForUser(m, user) {
  if (m.toType === 'all') return true;
  if (m.toType === 'team') return user.teamIds.some(t => m.toIds.includes(t));
  if (m.toType === 'individual') return m.toIds.includes(user.id);
  return false;
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [reports, setReports] = useState([]);
  const [messages, setMessages] = useState([]);
  const [reportAttachments, setReportAttachments] = useState({});
  const [messageAttachments, setMessageAttachments] = useState({});
  const [toast, setToast] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [theme, setTheme] = useState(getStoredTheme());

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => { document.title = `${COMPANY.name} · Internal`; }, []);

  const showToast = useCallback((kind, msg) => setToast({ kind, msg }), []);

  const loadUsers = useCallback(async () => { setUsers(await db.listUsers()); }, []);
  const loadTeams = useCallback(async () => { setTeams(await db.listTeams()); }, []);

  const loadReports = useCallback(async () => {
    const rs = await db.listReports();
    setReports(rs);
    if (FEATURES.attachments && rs.length) {
      try {
        const all = await attach.listForReports(rs.map(r => r.id));
        const byId = {};
        for (const a of all) (byId[a.reportId] = byId[a.reportId] || []).push(a);
        setReportAttachments(byId);
      } catch (e) {}
    }
  }, []);

  const loadMessages = useCallback(async () => {
    const ms = await db.listMessages();
    setMessages(ms);
    if (FEATURES.attachments && ms.length) {
      try {
        const all = await attach.listForMessages(ms.map(m => m.id));
        const byId = {};
        for (const a of all) (byId[a.messageId] = byId[a.messageId] || []).push(a);
        setMessageAttachments(byId);
      } catch (e) {}
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadUsers(), loadTeams(), loadReports(), loadMessages()]);
  }, [loadUsers, loadTeams, loadReports, loadMessages]);

  useEffect(() => {
    let cancelled = false;
    const finishLogin = async (sess) => {
      try {
        const profile = await db.findProfileByAuthId(sess.user.id);
        if (!profile) {
          setAuthError('Your email is not authorized to access this workspace. Ask a founder to invite you, then try again.');
          await auth.signOut();
          if (!cancelled) { setSession(null); setCurrentUser(null); setBooted(true); }
          return;
        }
        if (profile.status !== 'active') {
          setAuthError('Your access has been revoked. Contact a founder.');
          await auth.signOut();
          if (!cancelled) { setSession(null); setCurrentUser(null); setBooted(true); }
          return;
        }
        if (cancelled) return;
        setCurrentUser(profile);
        setSession(sess);
        await refreshAll();
        setAuthError(null);
        setBooted(true);
      } catch (e) {
        console.error('Login finalize failed', e);
        setAuthError('Could not load your account. Please reload.');
        setBooted(true);
      }
    };

    (async () => {
      const sess = await auth.getSession();
      if (sess) await finishLogin(sess);
      else if (!cancelled) setBooted(true);
    })();

    const { data: subscription } = auth.onAuthStateChange((sess) => {
      if (sess) finishLogin(sess);
      else {
        setSession(null); setCurrentUser(null);
        setUsers([]); setTeams([]); setReports([]); setMessages([]);
        setReportAttachments({}); setMessageAttachments({});
      }
    });

    return () => {
      cancelled = true;
      subscription?.subscription?.unsubscribe?.();
    };
  }, [refreshAll]);

  const api = useMemo(() => ({
    async upsertReport(report, files = []) {
      await db.upsertReport(report);
      if (files.length && currentUser) {
        for (const f of files) {
          try { await attach.upload(f, { reportId: report.id }, currentUser.id); }
          catch (e) { showToast('err', `Upload failed: ${f.name} — ${e.message || e}`); }
        }
      }
      await loadReports();
    },
    async resolveBlocker(reportId) { await db.resolveBlocker(reportId); await loadReports(); },
    async deleteAttachment(att) {
      try { await attach.remove(att); }
      catch (e) { showToast('err', e.message || 'Delete failed.'); return; }
      await Promise.all([loadReports(), loadMessages()]);
    },
    async createMessage(message, files = []) {
      await db.createMessage(message);
      if (files.length && currentUser) {
        for (const f of files) {
          try { await attach.upload(f, { messageId: message.id }, currentUser.id); }
          catch (e) { showToast('err', `Upload failed: ${f.name} — ${e.message || e}`); }
        }
      }
      await loadMessages();
    },
    async markMessageRead(message, profileId) {
      await db.markMessageRead(message.id, message.readBy, profileId);
      await loadMessages();
    },
    async createUser(user) { await db.createUser(user); await loadUsers(); },
    async updateUser(user) { await db.updateUser(user); await loadUsers(); if (currentUser?.id === user.id) setCurrentUser(user); },
    async deleteUser(id) { await db.deleteUser(id); await loadUsers(); },
    async createTeam(t) { await db.createTeam(t); await loadTeams(); },
    async updateTeam(t) { await db.updateTeam(t); await loadTeams(); },
    async deleteTeam(id) {
      await db.deleteTeam(id);
      const affected = users.filter(u => u.teamIds.includes(id));
      for (const u of affected) await db.updateUser({ ...u, teamIds: u.teamIds.filter(t => t !== id) });
      await Promise.all([loadTeams(), loadUsers()]);
    },
    async toggleTeamMembership(team, userId) {
      const u = users.find(x => x.id === userId);
      if (!u) return;
      const isMember = u.teamIds.includes(team.id);
      const teamIds = isMember ? u.teamIds.filter(id => id !== team.id) : [...u.teamIds, team.id];
      await db.updateUser({ ...u, teamIds });
      await loadUsers();
    },
  }), [users, currentUser, showToast, loadReports, loadMessages, loadUsers, loadTeams]);

  const logout = async () => { await auth.signOut(); setAuthError(null); };

  if (!booted) {
    return (
      <div style={{
        minHeight: '100vh', background: T.bg, color: T.muted, ...mono, fontSize: 11,
        display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: '0.16em',
      }}>{COMPANY.textLogo} // BOOTING…</div>
    );
  }

  return (
    <>
      {!session || !currentUser ? (
        <Login authError={authError} setAuthError={setAuthError} theme={theme} setTheme={setTheme} />
      ) : currentUser.role === 'founder' ? (
        <FounderShell
          user={currentUser} users={users} teams={teams} reports={reports} messages={messages}
          reportAttachments={reportAttachments} messageAttachments={messageAttachments}
          api={api} onLogout={logout} showToast={showToast} theme={theme} setTheme={setTheme}
        />
      ) : (
        <TeamShell
          user={currentUser} users={users} teams={teams} reports={reports} messages={messages}
          reportAttachments={reportAttachments} messageAttachments={messageAttachments}
          api={api} onLogout={logout} showToast={showToast} theme={theme} setTheme={setTheme}
        />
      )}
      {toast && <Toast kind={toast.kind} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </>
  );
}

function CompanyLogo({ size = 'md' }) {
  const px = size === 'lg' ? 36 : size === 'sm' ? 14 : 18;
  if (COMPANY.logoUrl) return <img src={COMPANY.logoUrl} alt={COMPANY.name} style={{ height: px, width: 'auto', objectFit: 'contain' }} />;
  return <div style={{ ...mono, fontSize: px, letterSpacing: '0.05em', fontWeight: 600 }}>{COMPANY.textLogo}</div>;
}

function ThemeSwitcher({ theme, setTheme }) {
  return (
    <Select value={theme} onChange={setTheme}
      options={listThemes().map(t => ({ value: t.id, label: t.label }))}
      style={{ width: 'auto', fontSize: 11, padding: '4px 8px' }} />
  );
}

function Login({ authError, setAuthError, theme, setTheme }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const sendCode = async () => {
    setErr(''); setAuthError(null);
    if (!email.trim() || !email.includes('@')) { setErr('Enter a valid email.'); return; }
    setLoading(true);
    try {
      const allowed = await auth.isEmailRegistered(email);
      if (!allowed) { setErr('This email is not registered. Ask a founder to invite you first.'); setLoading(false); return; }
      await auth.sendOtp(email);
      setStep('otp');
    } catch (e) { setErr(e?.message || 'Could not send code. Try again.'); }
    finally { setLoading(false); }
  };

  const verify = async () => {
    setErr('');
    if (otp.length !== 6) { setErr('Enter the 6-digit code.'); return; }
    setLoading(true);
    try { await auth.verifyOtp(email, otp); }
    catch (e) {
      const msg = e?.message || 'Invalid or expired code.';
      if (/token has expired|invalid token|otp_expired/i.test(msg)) {
        setErr('That code is expired or invalid. Use the most recent email — older codes stop working.');
      } else { setErr(msg); }
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{
          borderBottom: `2px solid ${T.ink}`, paddingBottom: 12, marginBottom: 28,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <div style={{ ...mono, fontSize: 11, letterSpacing: '0.24em', color: T.muted }}>// INTERNAL TOOL</div>
            <div style={{ marginTop: 4 }}><CompanyLogo size="lg" /></div>
            <div style={{ ...mono, fontSize: 11, color: T.inkSoft, marginTop: 4, letterSpacing: '0.04em' }}>{COMPANY.tagline}</div>
          </div>
          <div style={{ ...mono, fontSize: 10, color: T.muted, textAlign: 'right', letterSpacing: '0.08em' }}>
            <div>{new Date().toLocaleDateString('en-US', { weekday: 'long' })}</div>
            <div>{fmtDate(Date.now())}</div>
            <div style={{ marginTop: 4 }}>WEEK {weekId().split('-W')[1]}</div>
          </div>
        </div>

        <div style={{ border: `1px solid ${T.ink}`, padding: 24, background: T.bg }}>
          {step === 'email' && (
            <>
              <div style={{ ...mono, fontSize: 11, letterSpacing: '0.12em', marginBottom: 14, color: T.muted }}>
                ── ACCESS BY EMAIL · ONE-TIME CODE
              </div>
              <Field label="email" required hint="we'll send a 6-digit code">
                <Input value={email} onChange={setEmail} placeholder="you@yourcompany.com" autoFocus
                       onKeyDown={(e) => e.key === 'Enter' && sendCode()} disabled={loading} />
              </Field>
              {err && <div style={{ ...mono, fontSize: 11, color: T.red, marginBottom: 12 }}>! {err}</div>}
              {authError && (
                <div style={{
                  ...mono, fontSize: 11, color: T.red, padding: '8px 10px',
                  border: `1px dashed ${T.red}`, background: T.redSoft, marginBottom: 12, lineHeight: 1.5,
                }}>! {authError}</div>
              )}
              <Btn variant="primary" size="lg" onClick={sendCode} disabled={loading}>
                {loading ? 'SENDING…' : 'SEND CODE →'}
              </Btn>
            </>
          )}
          {step === 'otp' && (
            <>
              <div style={{ ...mono, fontSize: 11, letterSpacing: '0.12em', marginBottom: 14, color: T.muted }}>
                ── CHECK YOUR INBOX · {email}
              </div>
              <div style={{
                ...mono, fontSize: 11, padding: '8px 10px',
                border: `1px dashed ${T.ruleSoft}`, marginBottom: 14, color: T.inkSoft, lineHeight: 1.55,
              }}>
                We sent a 6-digit code to <strong>{email}</strong>. Code expires in 1 hour. Check spam if you don't see it.
              </div>
              <Field label="6-digit code" required>
                <Input value={otp} onChange={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                       placeholder="000000" autoFocus disabled={loading}
                       onKeyDown={(e) => e.key === 'Enter' && verify()}
                       style={{ letterSpacing: '0.4em', fontSize: 18, textAlign: 'center' }} />
              </Field>
              {err && <div style={{ ...mono, fontSize: 11, color: T.red, marginBottom: 12 }}>! {err}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn variant="primary" size="lg" onClick={verify} disabled={loading}>
                  {loading ? 'VERIFYING…' : 'VERIFY →'}
                </Btn>
                <Btn variant="ghost" size="lg" onClick={() => { setStep('email'); setOtp(''); setErr(''); }} disabled={loading}>
                  ← USE DIFFERENT EMAIL
                </Btn>
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.08em' }}>{COMPANY.footerText}</div>
          <ThemeSwitcher theme={theme} setTheme={setTheme} />
        </div>
      </div>
    </div>
  );
}

function TopNav({ user, current, onNav, onLogout, role, badge, theme, setTheme }) {
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = role === 'founder'
    ? [
        { id: 'overview', label: 'OVERVIEW' },
        { id: 'reports', label: 'REPORTS' },
        { id: 'blockers', label: 'BLOCKERS', highlight: badge?.blockers },
        ...(FEATURES.analytics ? [{ id: 'analytics', label: 'ANALYTICS' }] : []),
        { id: 'messages', label: 'COMMS' },
        ...(FEATURES.chat ? [{ id: 'chat', label: 'CHAT' }] : []),
        { id: 'teams', label: 'TEAMS' },
        { id: 'admin', label: 'ADMIN' },
      ]
    : [
        { id: 'submit', label: 'SUBMIT' },
        { id: 'history', label: 'HISTORY' },
        { id: 'inbox', label: 'INBOX', count: badge?.unread },
        ...(FEATURES.chat ? [{ id: 'chat', label: 'CHAT' }] : []),
      ];

  if (isMobile) {
    return (
      <>
        <div style={{
          borderBottom: `2px solid ${T.ink}`, background: T.bg,
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <span onClick={() => setMenuOpen(true)} style={{
            ...mono, fontSize: 22, cursor: 'pointer', padding: '0 8px', userSelect: 'none',
          }}>≡</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <CompanyLogo size="sm" />
            <div style={{ ...mono, fontSize: 9, color: T.muted, letterSpacing: '0.1em' }}>
              {role === 'founder' ? 'FOUNDER' : 'TEAM'} · {items.find(i => i.id === current)?.label}
            </div>
          </div>
          {(badge?.blockers > 0 || badge?.unread > 0) && (
            <span style={{ background: T.red, color: T.bg, padding: '2px 6px', ...mono, fontSize: 10 }}>
              {badge?.blockers || badge?.unread}
            </span>
          )}
        </div>
        {menuOpen && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.35)' }}
               onClick={() => setMenuOpen(false)}>
            <div onClick={e => e.stopPropagation()} style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: '80%', maxWidth: 280,
              background: T.bg, borderRight: `2px solid ${T.ink}`, display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.ink}`, background: T.bgAlt }}>
                <CompanyLogo size="md" />
                <div style={{ ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.1em', marginTop: 4 }}>
                  {user.name} · {user.role === 'founder' ? user.title || 'FOUNDER' : (user.position || '').toUpperCase()}
                </div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {items.map(it => (
                  <div key={it.id} onClick={() => { onNav(it.id); setMenuOpen(false); }} style={{
                    padding: '14px 16px', cursor: 'pointer', borderBottom: `1px solid ${T.ruleSoft}`,
                    background: current === it.id ? T.bgAlt : 'transparent',
                    ...mono, fontSize: 12, letterSpacing: '0.12em', display: 'flex', justifyContent: 'space-between',
                  }}>
                    {it.label}
                    {it.highlight > 0 && <span style={{ background: T.red, color: T.bg, padding: '0 6px', fontSize: 10 }}>{it.highlight}</span>}
                    {it.count > 0 && <span style={{ background: T.ink, color: T.bg, padding: '0 6px', fontSize: 10 }}>{it.count}</span>}
                  </div>
                ))}
              </div>
              <div style={{ borderTop: `1px solid ${T.ink}`, padding: 14 }}>
                <div style={{ ...mono, fontSize: 10, letterSpacing: '0.1em', color: T.muted, marginBottom: 6 }}>THEME</div>
                <ThemeSwitcher theme={theme} setTheme={setTheme} />
                <div style={{ marginTop: 12 }}>
                  <Btn size="sm" variant="ghost" onClick={onLogout}>LOGOUT</Btn>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{
      borderBottom: `2px solid ${T.ink}`, background: T.bg,
      padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 16,
      position: 'sticky', top: 0, zIndex: 100, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <CompanyLogo />
        <div style={{ ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.16em' }}>
          {role === 'founder' ? '/ FOUNDER' : '/ TEAM'}
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, marginLeft: 8, flexWrap: 'wrap' }}>
        {items.map(it => {
          const active = current === it.id;
          return (
            <div key={it.id} onClick={() => onNav(it.id)} style={{
              ...mono, fontSize: 11, letterSpacing: '0.14em', padding: '6px 12px',
              cursor: 'pointer', borderBottom: active ? `2px solid ${T.ink}` : '2px solid transparent',
              marginBottom: -12, display: 'flex', alignItems: 'center', gap: 6,
              color: active ? T.ink : T.inkSoft,
            }}>
              {it.label}
              {it.highlight > 0 && <span style={{ background: T.red, color: T.bg, padding: '0 4px', fontSize: 9 }}>{it.highlight}</span>}
              {it.count > 0 && <span style={{ background: T.ink, color: T.bg, padding: '0 4px', fontSize: 9 }}>{it.count}</span>}
            </div>
          );
        })}
      </div>
      <ThemeSwitcher theme={theme} setTheme={setTheme} />
      <div style={{ ...mono, fontSize: 10, color: T.muted, textAlign: 'right' }}>
        <div style={{ color: T.ink, fontSize: 11 }}>{user.name}</div>
        <div style={{ letterSpacing: '0.08em' }}>{user.role === 'founder' ? user.title || 'FOUNDER' : (user.position || '').toUpperCase()}</div>
      </div>
      <Btn size="sm" variant="ghost" onClick={onLogout}>LOGOUT</Btn>
    </div>
  );
}

function TeamShell({ user, users, teams, reports, messages, reportAttachments, messageAttachments, api, onLogout, showToast, theme, setTheme }) {
  const [view, setView] = useState('submit');
  const myMessages = messages.filter(m => isMessageForUser(m, user));
  const unread = myMessages.filter(m => !m.readBy.includes(user.id)).length;

  useEffect(() => {
    if (view !== 'inbox') return;
    (async () => {
      for (const m of myMessages) {
        if (!m.readBy.includes(user.id)) await api.markMessageRead(m, user.id);
      }
    })();
  }, [view]); // eslint-disable-line

  return (
    <>
      <TopNav user={user} role="team" current={view} onNav={setView} onLogout={onLogout} badge={{ unread }} theme={theme} setTheme={setTheme} />
      <div style={{ padding: '20px 16px', maxWidth: 1200, margin: '0 auto' }}>
        {view === 'submit' && <TeamSubmit user={user} reports={reports} reportAttachments={reportAttachments} api={api} messages={myMessages} showToast={showToast} />}
        {view === 'history' && <TeamHistory reports={reports.filter(r => r.userId === user.id)} reportAttachments={reportAttachments} />}
        {view === 'inbox' && <TeamInbox user={user} messages={myMessages} teams={teams} messageAttachments={messageAttachments} />}
        {view === 'chat' && FEATURES.chat && <ChatPanel user={user} users={users} isFounder={false} showToast={showToast} />}
      </div>
    </>
  );
}

function TeamSubmit({ user, reports, reportAttachments, api, messages, showToast }) {
  const currentWeek = weekId();
  const myReports = reports.filter(r => r.userId === user.id);
  const existing = myReports.find(r => r.weekId === currentWeek);
  const lastWeekReport = myReports.find(r => r.weekId === weekIdOffset(-1));

  const [lastWeek, setLastWeek] = useState(existing?.lastWeek || '');
  const [thisWeek, setThisWeek] = useState(existing?.thisWeek || '');
  const [blockers, setBlockers] = useState(existing?.blockers || '');
  const [files, setFiles] = useState([]);
  const [editing, setEditing] = useState(!existing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing && !editing) {
      setLastWeek(existing.lastWeek);
      setThisWeek(existing.thisWeek);
      setBlockers(existing.blockers || '');
    }
  }, [existing?.id]); // eslint-disable-line

  const today = new Date();
  const monday = mondayOfWeek(today);
  const isLate = today.getTime() > monday.getTime() + 86400000;
  const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long' });
  const streak = computeStreak(myReports);
  const carryOver = useMemo(() => detectCarryOver(lastWeekReport, thisWeek), [lastWeekReport, thisWeek]);
  const recentTask = useMemo(
    () => messages.filter(m => m.type === 'task' && (!m.dueDate || m.dueDate > Date.now() - 14 * 86400000))
                  .sort((a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity))[0],
    [messages]
  );

  const submit = async () => {
    if (!lastWeek.trim() || !thisWeek.trim()) { showToast('err', 'Last week and this week are required.'); return; }
    setSaving(true);
    try {
      const report = {
        id: existing?.id || uid('rep'),
        userId: user.id, weekId: currentWeek,
        submittedAt: existing?.submittedAt || Date.now(),
        updatedAt: existing ? Date.now() : null,
        lastWeek: lastWeek.trim(), thisWeek: thisWeek.trim(), blockers: blockers.trim(),
        hasBlockers: !!blockers.trim(),
        isLate: existing ? existing.isLate : isLate,
        blockerResolved: existing?.blockerResolved || false,
      };
      await api.upsertReport(report, files);
      setFiles([]);
      setEditing(false);
      showToast('ok', existing ? 'Report updated.' : 'Submitted. Have a good week.');
    } catch (e) { showToast('err', e.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  const existingAttachments = existing ? (reportAttachments[existing.id] || []) : [];

  return (
    <div>
      <div style={{
        border: `1px solid ${T.ink}`,
        background: existing ? T.greenSoft : (isLate ? T.amberSoft : T.bg),
        padding: '14px 18px', marginBottom: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ ...mono, fontSize: 10, letterSpacing: '0.16em', color: T.muted, textTransform: 'uppercase' }}>
            // {dayOfWeek} · {fmtDate(Date.now())} · WEEK {currentWeek.split('-W')[1]}
          </div>
          <div style={{ ...mono, fontSize: 16, marginTop: 4, letterSpacing: '0.04em' }}>
            {existing ? (
              <><StatusDot color="green" /> Submitted {relTime(existing.submittedAt)} {existing.isLate && <Tag color="amber">LATE</Tag>}</>
            ) : isLate ? (
              <><StatusDot color="amber" /> Pending — your weekly is late. Submit now.</>
            ) : (
              <><StatusDot color="blue" /> Awaiting your weekly submission.</>
            )}
          </div>
        </div>
        <div style={{ ...mono, fontSize: 11, color: T.inkSoft, textAlign: 'right' }}>
          <div>STREAK</div>
          <div style={{ fontSize: 28, color: streak > 0 ? T.green : T.muted, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {streak}<span style={{ fontSize: 11, color: T.muted, marginLeft: 4 }}>wk</span>
          </div>
        </div>
      </div>

      {recentTask && (
        <div style={{
          border: `1px solid ${T.ruleSoft}`, padding: 12, marginBottom: 24,
          ...mono, fontSize: 11, color: T.inkSoft, background: T.bgAlt,
        }}>
          <span style={{ color: T.red, letterSpacing: '0.12em' }}>OPEN TASK ›</span>{' '}
          <strong style={{ color: T.ink }}>{recentTask.subject}</strong>
          {recentTask.dueDate && <span style={{ color: T.muted, marginLeft: 8 }}>· due {fmtDate(recentTask.dueDate)}</span>}
        </div>
      )}

      <Section title="Weekly Report"
        right={existing && !editing && <Btn size="sm" onClick={() => setEditing(true)}>EDIT</Btn>}>
        {(!existing || editing) ? (
          <>
            <Field label="What you did last week" required hint="be specific — outcomes, not activity">
              <Textarea value={lastWeek} onChange={setLastWeek} rows={5} placeholder="Shipped X. Closed Y tickets. Decided Z." />
            </Field>
            {carryOver && (
              <div style={{
                border: `1px solid ${T.amber}`, background: T.amberSoft, padding: '8px 12px', marginBottom: 14,
                ...mono, fontSize: 11, color: T.ink,
              }}>
                <span style={{ color: T.amber, letterSpacing: '0.1em' }}>⚠ CARRY-OVER DETECTED</span>{' '}
                Your plan looks like last week's plan. If something slipped, say so explicitly.
              </div>
            )}
            <Field label="What you'll do this week" required hint="3–5 concrete deliverables, in priority order">
              <Textarea value={thisWeek} onChange={setThisWeek} rows={5} placeholder={"1. ___\n2. ___\n3. ___"} />
            </Field>
            <Field label="Blockers" hint="leave empty if none. don't soften.">
              <Textarea value={blockers} onChange={setBlockers} rows={3} placeholder="What's preventing progress? Who/what do you need?" />
            </Field>
            {blockers.trim() && (
              <div style={{
                border: `1px dashed ${T.red}`, background: T.redSoft, padding: '8px 12px', marginBottom: 14,
                ...mono, fontSize: 11, color: T.ink,
              }}>
                <span style={{ color: T.red, letterSpacing: '0.1em' }}>● BLOCKER LOGGED</span>{' '}
                Founders see this on the blocker board immediately.
              </div>
            )}
            {FEATURES.attachments && (
              <Field label="attachments" hint="screenshots, docs, anything that helps">
                <AttachmentPicker files={files} setFiles={setFiles} />
              </Field>
            )}
            {existingAttachments.length > 0 && (
              <Field label="existing attachments">
                <AttachmentList attachments={existingAttachments} onRemove={async (a) => { await api.deleteAttachment(a); }} />
              </Field>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
              <Btn variant="primary" size="lg" onClick={submit} disabled={saving}>
                {saving ? 'SAVING…' : (existing ? 'UPDATE REPORT' : 'SUBMIT REPORT')}
              </Btn>
              {editing && existing && (
                <Btn size="lg" onClick={() => {
                  setLastWeek(existing.lastWeek); setThisWeek(existing.thisWeek); setBlockers(existing.blockers || '');
                  setFiles([]); setEditing(false);
                }}>CANCEL</Btn>
              )}
            </div>
          </>
        ) : (
          <ReportView report={existing} attachments={existingAttachments} />
        )}
      </Section>

      {lastWeekReport && !existing && (
        <Section title="Last Week's Plan" dense>
          <div style={{
            border: `1px solid ${T.ruleSoft}`, padding: 14, ...mono, fontSize: 12, color: T.inkSoft,
            lineHeight: 1.6, background: T.bgAlt, whiteSpace: 'pre-wrap',
          }}>{lastWeekReport.thisWeek}</div>
          <div style={{ ...mono, fontSize: 10, color: T.muted, marginTop: 6, letterSpacing: '0.08em' }}>
            // use this to guide what you write under "what you did last week"
          </div>
        </Section>
      )}
    </div>
  );
}

function ReportView({ report, attachments = [] }) {
  return (
    <div style={{ border: `1px solid ${T.ruleSoft}`, background: T.bg }}>
      <ReportField label="LAST WEEK" body={report.lastWeek} />
      <ReportField label="THIS WEEK" body={report.thisWeek} />
      {report.hasBlockers ? (
        <ReportField label="BLOCKERS" body={report.blockers} accent={T.red} />
      ) : (
        <div style={{ borderTop: `1px solid ${T.ruleSoft}`, padding: '10px 14px', ...mono, fontSize: 11, color: T.muted }}>
          // no blockers reported
        </div>
      )}
      {attachments.length > 0 && (
        <div style={{ borderTop: `1px solid ${T.ruleSoft}`, padding: '12px 14px' }}>
          <div style={{ ...mono, fontSize: 9, letterSpacing: '0.16em', color: T.muted, marginBottom: 6 }}>
            ATTACHMENTS · {attachments.length}
          </div>
          <AttachmentList attachments={attachments} dense />
        </div>
      )}
      <div style={{
        borderTop: `1px solid ${T.ruleSoft}`, padding: '8px 14px', ...mono, fontSize: 10, color: T.muted,
        letterSpacing: '0.08em', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4,
      }}>
        <span>SUBMITTED {fmtDateTime(report.submittedAt)}</span>
        <span>{report.isLate ? 'LATE' : 'ON-TIME'} · {report.weekId}</span>
      </div>
    </div>
  );
}

function ReportField({ label, body, accent }) {
  return (
    <div style={{ borderTop: `1px solid ${T.ruleSoft}`, padding: '12px 14px' }}>
      <div style={{ ...mono, fontSize: 9, letterSpacing: '0.16em', color: accent || T.muted, marginBottom: 6 }}>{label}</div>
      <div style={{ ...sans, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: T.ink }}>{body}</div>
    </div>
  );
}

function TeamHistory({ reports, reportAttachments }) {
  const [filter, setFilter] = useState('all');
  const sorted = [...reports].sort((a, b) => b.submittedAt - a.submittedAt);
  const filtered = sorted.filter(r => {
    if (filter === 'blocked') return r.hasBlockers;
    if (filter === 'late') return r.isLate;
    return true;
  });
  const totalSubmitted = reports.length;
  const lateCount = reports.filter(r => r.isLate).length;
  const blockedCount = reports.filter(r => r.hasBlockers).length;
  const onTimeRate = totalSubmitted ? Math.round(((totalSubmitted - lateCount) / totalSubmitted) * 100) : 0;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatBox label="REPORTS LOGGED" value={totalSubmitted} />
        <StatBox label="ON-TIME RATE" value={`${onTimeRate}%`} color={onTimeRate >= 80 ? 'green' : onTimeRate >= 50 ? 'amber' : 'red'} />
        <StatBox label="LATE" value={lateCount} color={lateCount ? 'amber' : 'ink'} />
        <StatBox label="BLOCKED WEEKS" value={blockedCount} color={blockedCount ? 'red' : 'ink'} />
      </div>
      <Section title="Report History" right={
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'blocked', 'late'].map(f => (
              <Btn key={f} size="sm" variant={filter === f ? 'primary' : 'ghost'} onClick={() => setFilter(f)}>{f.toUpperCase()}</Btn>
            ))}
          </div>
        }>
        {filtered.length === 0 ? <Empty>No reports match this filter yet.</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {filtered.map(r => (
              <div key={r.id}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', marginBottom: 4,
                  ...mono, fontSize: 11, color: T.muted, letterSpacing: '0.08em', flexWrap: 'wrap', gap: 4,
                }}>
                  <span>{r.weekId} · {fmtDate(r.submittedAt)}</span>
                  <span>{r.isLate && <Tag color="amber">LATE</Tag>} {r.hasBlockers && <Tag color="red">BLOCKER</Tag>}</span>
                </div>
                <ReportView report={r} attachments={reportAttachments[r.id] || []} />
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function TeamInbox({ user, messages, teams, messageAttachments }) {
  const [filter, setFilter] = useState('all');
  const sorted = [...messages].sort((a, b) => b.createdAt - a.createdAt);
  const filtered = sorted.filter(m => {
    if (filter === 'tasks') return m.type === 'task';
    if (filter === 'unread') return !m.readBy.includes(user.id);
    return true;
  });
  return (
    <div>
      <Section title="Inbox" right={
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'unread', 'tasks'].map(f => (
              <Btn key={f} size="sm" variant={filter === f ? 'primary' : 'ghost'} onClick={() => setFilter(f)}>{f.toUpperCase()}</Btn>
            ))}
          </div>
        }>
        {filtered.length === 0 ? <Empty>No messages.</Empty> : (
          <div>{filtered.map(m => (
            <MessageRow key={m.id} m={m} user={user} teams={teams} attachments={messageAttachments[m.id] || []} />
          ))}</div>
        )}
      </Section>
    </div>
  );
}

function MessageRow({ m, user, teams, attachments = [] }) {
  const [open, setOpen] = useState(false);
  const isUnread = !m.readBy.includes(user.id);
  const target = m.toType === 'all' ? 'EVERYONE' :
    m.toType === 'team' ? `TEAM: ${m.toIds.map(id => teams.find(t => t.id === id)?.name || '?').join(', ').toUpperCase()}` :
    `DM`;
  return (
    <div style={{ borderTop: `1px solid ${T.ruleSoft}` }}>
      <div onClick={() => setOpen(!open)} style={{
        padding: '12px 14px', cursor: 'pointer', background: isUnread ? T.bg : 'transparent',
        display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 10, alignItems: 'center',
      }}>
        <div style={{ width: 8, height: 8, background: isUnread ? T.ink : 'transparent', border: isUnread ? 'none' : `1px solid ${T.ruleSoft}` }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ ...mono, fontSize: 9, letterSpacing: '0.14em', color: T.muted, marginBottom: 2 }}>
            {target} · {m.fromName} · {relTime(m.createdAt)}
          </div>
          <div style={{ ...mono, fontSize: 13, color: T.ink, fontWeight: isUnread ? 600 : 400 }}>
            {m.subject}{attachments.length > 0 && <span style={{ color: T.muted, marginLeft: 6 }}>· 📎{attachments.length}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {m.type === 'task' && <Tag color="blue">TASK</Tag>}
          {m.type === 'announcement' && <Tag color="ink">ANNOUNCEMENT</Tag>}
          {m.priority === 'high' && <Tag color="red">HIGH</Tag>}
        </div>
      </div>
      {open && (
        <div style={{ padding: '0 14px 14px 36px', ...sans, fontSize: 13, color: T.inkSoft, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {m.body}
          {m.dueDate && (
            <div style={{ ...mono, fontSize: 11, color: T.red, marginTop: 8, letterSpacing: '0.08em' }}>
              DUE {fmtDate(m.dueDate)}
            </div>
          )}
          {attachments.length > 0 && <AttachmentList attachments={attachments} dense />}
        </div>
      )}
    </div>
  );
}

function FounderShell({ user, users, teams, reports, messages, reportAttachments, messageAttachments, api, onLogout, showToast, theme, setTheme }) {
  const [view, setView] = useState('overview');
  const currentWeek = weekId();
  const activeBlockers = reports.filter(r => r.weekId === currentWeek && r.hasBlockers && !r.blockerResolved).length;

  return (
    <>
      <TopNav user={user} role="founder" current={view} onNav={setView} onLogout={onLogout}
              badge={{ blockers: activeBlockers }} theme={theme} setTheme={setTheme} />
      <div style={{ padding: '20px 16px', maxWidth: 1400, margin: '0 auto' }}>
        {view === 'overview' && <FounderOverview user={user} users={users} teams={teams} reports={reports} api={api} onNav={setView} />}
        {view === 'reports' && <FounderReports users={users} teams={teams} reports={reports} reportAttachments={reportAttachments} />}
        {view === 'blockers' && <FounderBlockers users={users} reports={reports} api={api} founder={user} showToast={showToast} />}
        {view === 'analytics' && FEATURES.analytics && <AnalyticsView users={users} teams={teams} reports={reports} />}
        {view === 'messages' && <FounderMessages user={user} users={users} teams={teams} messages={messages} messageAttachments={messageAttachments} api={api} showToast={showToast} />}
        {view === 'chat' && FEATURES.chat && <ChatPanel user={user} users={users} isFounder={true} showToast={showToast} />}
        {view === 'teams' && <FounderTeams users={users} teams={teams} reports={reports} api={api} showToast={showToast} />}
        {view === 'admin' && <AdminPanel user={user} users={users} teams={teams} api={api} showToast={showToast} />}
      </div>
    </>
  );
}

function FounderOverview({ user, users, teams, reports, api, onNav }) {
  const currentWeek = weekId();
  const teamUsers = users.filter(u => u.role === 'team' && u.status === 'active');
  const today = new Date();
  const monday = mondayOfWeek(today);
  const isAfterMonday = today.getTime() > monday.getTime() + 86400000;

  const userStatuses = teamUsers.map(u => {
    const report = reports.find(r => r.userId === u.id && r.weekId === currentWeek);
    let status = 'pending';
    if (report) status = report.isLate ? 'late' : 'submitted';
    else if (isAfterMonday) status = 'missing';
    return { user: u, status, report };
  });

  const submittedCount = userStatuses.filter(s => s.status === 'submitted' || s.status === 'late').length;
  const lateCount = userStatuses.filter(s => s.status === 'late').length;
  const missingCount = userStatuses.filter(s => s.status === 'missing').length;
  const pendingCount = userStatuses.filter(s => s.status === 'pending').length;
  const submissionRate = teamUsers.length ? Math.round((submittedCount / teamUsers.length) * 100) : 0;

  const activeBlockers = reports.filter(r => r.weekId === currentWeek && r.hasBlockers && !r.blockerResolved);
  const olderBlockers = reports.filter(r => r.hasBlockers && !r.blockerResolved && r.weekId !== currentWeek);

  return (
    <div>
      <div style={{
        borderBottom: `1px solid ${T.ink}`, paddingBottom: 12, marginBottom: 24,
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ ...mono, fontSize: 11, color: T.muted, letterSpacing: '0.16em' }}>
            // OVERVIEW · WEEK {currentWeek.split('-W')[1]} · {today.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()}
          </div>
          <h1 style={{ ...sans, margin: '4px 0 0', fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em' }}>
            Good {today.getHours() < 12 ? 'morning' : today.getHours() < 17 ? 'afternoon' : 'evening'}, {user.name.split(' ')[0]}.
          </h1>
        </div>
        <div style={{ ...mono, fontSize: 11, color: T.muted, textAlign: 'right' }}>
          <div>{fmtDate(Date.now())}</div>
          <div>WEEK STARTS {fmtDate(monday)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 28 }}>
        <StatBox label="TEAM SIZE" value={teamUsers.length} sub="active" />
        <StatBox label="SUBMITTED" value={submittedCount} color="green" sub={`${submissionRate}%`} />
        <StatBox label="PENDING" value={pendingCount} color="amber" />
        <StatBox label="MISSING" value={missingCount} color={missingCount ? 'red' : 'ink'} />
        <StatBox label="LATE" value={lateCount} color={lateCount ? 'amber' : 'ink'} />
        <StatBox label="BLOCKERS" value={activeBlockers.length} color={activeBlockers.length ? 'red' : 'ink'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 28 }}>
        <div>
          <Section title={`Week ${currentWeek.split('-W')[1]} · Submissions`}
            right={<Btn size="sm" variant="ghost" onClick={() => onNav('reports')}>OPEN REPORTS →</Btn>}>
            <SubmissionTable userStatuses={userStatuses} teams={teams} />
          </Section>
          <Section title="Submission Heatmap · Last 8 Weeks" dense>
            <Heatmap users={teamUsers} reports={reports} />
          </Section>
        </div>
        <div>
          <Section title={`Active Blockers (${activeBlockers.length})`}
            right={activeBlockers.length > 0 && <Tag color="red">PRIORITY</Tag>}>
            {activeBlockers.length === 0 ? <Empty>No active blockers reported this week.</Empty> : (
              <div>
                {activeBlockers.map(r => {
                  const u = users.find(x => x.id === r.userId);
                  return <BlockerCard key={r.id} report={r} user={u} compact onResolve={() => api.resolveBlocker(r.id)} />;
                })}
              </div>
            )}
          </Section>
          {olderBlockers.length > 0 && (
            <Section title={`Lingering (${olderBlockers.length})`} dense>
              <div style={{ ...mono, fontSize: 11, color: T.muted, marginBottom: 8, letterSpacing: '0.04em' }}>
                Blockers from past weeks not marked resolved.
              </div>
              {olderBlockers.slice(0, 3).map(r => {
                const u = users.find(x => x.id === r.userId);
                return <BlockerCard key={r.id} report={r} user={u} compact lingering onResolve={() => api.resolveBlocker(r.id)} />;
              })}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function SubmissionTable({ userStatuses, teams }) {
  const [openId, setOpenId] = useState(null);
  return (
    <div style={{ border: `1px solid ${T.ink}`, overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', ...mono, fontSize: 12 }}>
        <thead>
          <tr style={{ background: T.bgAlt, borderBottom: `1px solid ${T.ink}` }}>
            <Th w="40%">NAME</Th><Th w="25%">TEAM</Th><Th w="15%">STATUS</Th><Th w="20%">SUBMITTED</Th>
          </tr>
        </thead>
        <tbody>
          {userStatuses.map(({ user, status, report }) => {
            const teamNames = user.teamIds.map(id => teams.find(t => t.id === id)?.name).filter(Boolean);
            const isOpen = openId === user.id;
            const statusColor = { submitted: 'green', late: 'amber', missing: 'red', pending: 'muted' }[status];
            const statusLabel = { submitted: 'SUBMITTED', late: 'LATE', missing: 'MISSING', pending: 'PENDING' }[status];
            return (
              <React.Fragment key={user.id}>
                <tr onClick={() => report && setOpenId(isOpen ? null : user.id)}
                  style={{
                    borderBottom: `1px solid ${T.ruleSoft}`,
                    cursor: report ? 'pointer' : 'default',
                    background: isOpen ? T.bgAlt : 'transparent',
                  }}>
                  <Td>
                    <div style={{ ...sans, fontSize: 13, fontWeight: 500 }}>{user.name}</div>
                    <div style={{ ...mono, fontSize: 10, color: T.muted }}>{user.email}</div>
                  </Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {teamNames.map(n => <Tag key={n} color="muted">{n}</Tag>)}
                    </div>
                  </Td>
                  <Td><StatusDot color={statusColor} />{statusLabel} {report?.hasBlockers && <Tag color="red">●</Tag>}</Td>
                  <Td>{report ? fmtDateTime(report.submittedAt) : <span style={{ color: T.muted }}>—</span>}</Td>
                </tr>
                {isOpen && report && (
                  <tr><td colSpan={4} style={{ padding: 0, background: T.bgAlt }}>
                    <div style={{ padding: 14 }}><ReportView report={report} /></div>
                  </td></tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Heatmap({ users, reports }) {
  const weeks = lookbackWeeks(8);
  return (
    <div style={{ border: `1px solid ${T.ink}`, background: T.bg, overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', ...mono, fontSize: 11 }}>
        <thead>
          <tr style={{ background: T.bgAlt, borderBottom: `1px solid ${T.ink}` }}>
            <Th w="22%">MEMBER</Th>
            {weeks.map(w => (
              <th key={w} style={{ ...mono, fontSize: 9, padding: '6px 4px', textAlign: 'center', color: T.inkSoft, letterSpacing: '0.06em', fontWeight: 500 }}>
                W{w.split('-W')[1]}
              </th>
            ))}
            <th style={{ ...mono, fontSize: 9, padding: '6px 8px', textAlign: 'center', color: T.inkSoft, letterSpacing: '0.06em', fontWeight: 500 }}>STREAK</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => {
            const userReports = reports.filter(r => r.userId === u.id);
            const streak = computeStreak(userReports);
            return (
              <tr key={u.id} style={{ borderBottom: `1px solid ${T.ruleSoft}` }}>
                <Td><div style={{ ...sans, fontSize: 12 }}>{u.name}</div></Td>
                {weeks.map(w => {
                  const r = userReports.find(x => x.weekId === w);
                  let bg = T.bgAlt, label = '·';
                  if (r) {
                    if (r.hasBlockers) { bg = T.redSoft; label = 'B'; }
                    else if (r.isLate) { bg = T.amberSoft; label = 'L'; }
                    else { bg = T.greenSoft; label = '✓'; }
                  } else { label = '×'; bg = T.bg; }
                  return (
                    <td key={w} style={{ padding: 0, textAlign: 'center' }}>
                      <div title={`${u.name} · ${w} · ${r ? (r.hasBlockers ? 'BLOCKER' : r.isLate ? 'LATE' : 'ON-TIME') : 'MISSING'}`}
                        style={{
                          background: bg, borderLeft: `1px solid ${T.ruleSoft}`, borderRight: `1px solid ${T.ruleSoft}`,
                          padding: '8px 0', ...mono, fontSize: 11, color: T.inkSoft,
                        }}>{label}</div>
                    </td>
                  );
                })}
                <Td align="center">
                  <span style={{ ...mono, color: streak > 0 ? T.green : T.muted, fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{streak}</span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ borderTop: `1px solid ${T.ruleSoft}`, padding: '6px 12px', ...mono, fontSize: 10, color: T.muted, display: 'flex', gap: 14, letterSpacing: '0.06em', flexWrap: 'wrap' }}>
        <span><span style={{ background: T.greenSoft, padding: '0 6px', border: `1px solid ${T.ruleSoft}` }}>✓</span> ON-TIME</span>
        <span><span style={{ background: T.amberSoft, padding: '0 6px', border: `1px solid ${T.ruleSoft}` }}>L</span> LATE</span>
        <span><span style={{ background: T.redSoft, padding: '0 6px', border: `1px solid ${T.ruleSoft}` }}>B</span> BLOCKER</span>
        <span><span style={{ background: T.bg, padding: '0 6px', border: `1px solid ${T.ruleSoft}` }}>×</span> MISSING</span>
      </div>
    </div>
  );
}

function BlockerCard({ report, user, compact, lingering, onResolve, onMessage }) {
  if (!user) return null;
  const ageDays = Math.floor((Date.now() - report.submittedAt) / 86400000);
  return (
    <div style={{
      border: `1px solid ${T.ruleSoft}`, borderLeft: `3px solid ${lingering ? T.amber : T.red}`,
      padding: 12, background: T.bg, marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
        <div style={{ ...sans, fontSize: 13, fontWeight: 500 }}>{user.name}</div>
        <div style={{ ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.06em' }}>{report.weekId} · {ageDays}d old</div>
      </div>
      <div style={{ ...sans, fontSize: 13, color: T.ink, lineHeight: 1.5, marginBottom: 8 }}>{report.blockers}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {onResolve && <Btn size="sm" onClick={onResolve}>MARK RESOLVED</Btn>}
        {onMessage && <Btn size="sm" variant="ghost" onClick={onMessage}>MESSAGE →</Btn>}
      </div>
    </div>
  );
}

function FounderReports({ users, teams, reports, reportAttachments }) {
  const [weekFilter, setWeekFilter] = useState(weekId());
  const [teamFilter, setTeamFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const teamUsers = users.filter(u => u.role === 'team' && u.status === 'active');
  const filteredUsers = teamFilter === 'all' ? teamUsers : teamUsers.filter(u => u.teamIds.includes(teamFilter));
  const allWeeks = Array.from(new Set(reports.map(r => r.weekId))).sort().reverse();
  const weeks = [weekId(), ...allWeeks.filter(w => w !== weekId())];

  let rows = filteredUsers.map(u => {
    const r = reports.find(x => x.userId === u.id && x.weekId === weekFilter);
    return { user: u, report: r };
  });
  if (statusFilter === 'submitted') rows = rows.filter(r => r.report && !r.report.isLate);
  if (statusFilter === 'late') rows = rows.filter(r => r.report && r.report.isLate);
  if (statusFilter === 'blocked') rows = rows.filter(r => r.report && r.report.hasBlockers);
  if (statusFilter === 'missing') rows = rows.filter(r => !r.report);

  if (search.trim()) {
    const q = search.toLowerCase();
    rows = rows.filter(r =>
      r.user.name.toLowerCase().includes(q) ||
      r.user.email.toLowerCase().includes(q) ||
      (r.report && (r.report.lastWeek + r.report.thisWeek + r.report.blockers).toLowerCase().includes(q))
    );
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24, alignItems: 'end' }}>
        <Field label="week">
          <Select value={weekFilter} onChange={setWeekFilter}
            options={weeks.map(w => ({ value: w, label: w === weekId() ? `${w} (current)` : w }))} />
        </Field>
        <Field label="team">
          <Select value={teamFilter} onChange={setTeamFilter}
            options={[{ value: 'all', label: 'All teams' }, ...teams.map(t => ({ value: t.id, label: t.name }))]} />
        </Field>
        <Field label="status">
          <Select value={statusFilter} onChange={setStatusFilter} options={[
            { value: 'all', label: 'All' },
            { value: 'submitted', label: 'On-time' },
            { value: 'late', label: 'Late' },
            { value: 'blocked', label: 'With blockers' },
            { value: 'missing', label: 'Missing' },
          ]} />
        </Field>
        <Field label="search"><Input value={search} onChange={setSearch} placeholder="search names, content…" /></Field>
      </div>

      <div style={{ ...mono, fontSize: 11, color: T.muted, marginBottom: 10, letterSpacing: '0.06em' }}>
        SHOWING {rows.length} OF {filteredUsers.length} MEMBERS · WEEK {weekFilter}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rows.map(({ user, report }) => (
          <div key={user.id} style={{ border: `1px solid ${T.ink}`, background: T.bg }}>
            <div style={{
              padding: '10px 14px', borderBottom: `1px solid ${T.ruleSoft}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.bgAlt,
              flexWrap: 'wrap', gap: 6,
            }}>
              <div>
                <div style={{ ...sans, fontSize: 14, fontWeight: 500 }}>{user.name}</div>
                <div style={{ ...mono, fontSize: 10, color: T.muted, marginTop: 2 }}>
                  {user.position} · {user.teamIds.map(id => teams.find(t => t.id === id)?.name).filter(Boolean).join(' / ')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {report ? (
                  <>
                    {!report.isLate && <Tag color="green">ON-TIME</Tag>}
                    {report.isLate && <Tag color="amber">LATE</Tag>}
                    {report.hasBlockers && <Tag color="red">BLOCKER</Tag>}
                  </>
                ) : <Tag color="red">NO REPORT</Tag>}
              </div>
            </div>
            {report ? <ReportView report={report} attachments={reportAttachments[report.id] || []} /> : (
              <div style={{ padding: 18, ...mono, fontSize: 12, color: T.muted, textAlign: 'center' }}>
                // {user.name.split(' ')[0]} did not submit for {weekFilter}
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <Empty>No reports match your filters.</Empty>}
      </div>
    </div>
  );
}

function FounderBlockers({ users, reports, api, founder, showToast }) {
  const [showResolved, setShowResolved] = useState(false);
  const [composeFor, setComposeFor] = useState(null);

  let blockerReports = reports.filter(r => r.hasBlockers);
  if (!showResolved) blockerReports = blockerReports.filter(r => !r.blockerResolved);
  blockerReports.sort((a, b) => a.submittedAt - b.submittedAt);

  const byAge = {
    fresh: blockerReports.filter(r => Date.now() - r.submittedAt < 4 * 86400000),
    aging: blockerReports.filter(r => {
      const age = Date.now() - r.submittedAt;
      return age >= 4 * 86400000 && age < 10 * 86400000;
    }),
    stale: blockerReports.filter(r => Date.now() - r.submittedAt >= 10 * 86400000),
  };

  const send = async (targetUser, subject, body) => {
    const m = {
      id: uid('msg'), fromUserId: founder.id, fromName: founder.name,
      toType: 'individual', toIds: [targetUser.id],
      type: 'message', priority: 'normal', subject, body,
      readBy: [], dueDate: null,
    };
    await api.createMessage(m);
    showToast('ok', `Message sent to ${targetUser.name.split(' ')[0]}.`);
  };

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        borderBottom: `1px solid ${T.ink}`, paddingBottom: 12, marginBottom: 24, gap: 8, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ ...mono, fontSize: 11, color: T.muted, letterSpacing: '0.16em' }}>// BLOCKER BOARD</div>
          <h1 style={{ ...sans, margin: '4px 0 0', fontSize: 24, fontWeight: 500 }}>What's stopping the team</h1>
        </div>
        <Btn size="sm" variant={showResolved ? 'primary' : 'ghost'} onClick={() => setShowResolved(!showResolved)}>
          {showResolved ? 'HIDING NOTHING' : 'SHOW RESOLVED'}
        </Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatBox label="FRESH (< 4d)" value={byAge.fresh.length} color="amber" />
        <StatBox label="AGING (4–10d)" value={byAge.aging.length} color={byAge.aging.length ? 'red' : 'ink'} />
        <StatBox label="STALE (10d+)" value={byAge.stale.length} color={byAge.stale.length ? 'red' : 'ink'} />
      </div>

      {blockerReports.length === 0 ? (
        <Empty>No blockers. {showResolved ? 'No resolved blockers either.' : 'Try toggling resolved.'}</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {[
            { key: 'stale', title: 'STALE — escalate', color: T.red, items: byAge.stale },
            { key: 'aging', title: 'AGING — pressure', color: T.amber, items: byAge.aging },
            { key: 'fresh', title: 'FRESH — observe', color: T.green, items: byAge.fresh },
          ].map(col => (
            <div key={col.key}>
              <div style={{
                ...mono, fontSize: 10, letterSpacing: '0.16em', color: col.color,
                paddingBottom: 6, borderBottom: `1px solid ${col.color}`, marginBottom: 10,
              }}>{col.title} · {col.items.length}</div>
              <div>
                {col.items.length === 0 && <div style={{ ...mono, fontSize: 11, color: T.muted, padding: '8px 0' }}>// none</div>}
                {col.items.map(r => {
                  const u = users.find(x => x.id === r.userId);
                  if (!u) return null;
                  return (
                    <BlockerCard key={r.id} user={u} report={r}
                      onResolve={async () => { await api.resolveBlocker(r.id); showToast('ok', 'Marked resolved.'); }}
                      onMessage={() => setComposeFor({ user: u, report: r })} />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {composeFor && (
        <Modal onClose={() => setComposeFor(null)} title={`MESSAGE → ${composeFor.user.name.toUpperCase()}`}>
          <BlockerComposer user={composeFor.user} report={composeFor.report}
            onSend={async (subject, body) => { await send(composeFor.user, subject, body); setComposeFor(null); }} />
        </Modal>
      )}
    </div>
  );
}

function BlockerComposer({ user, report, onSend }) {
  const [subject, setSubject] = useState(`Re: blocker — ${report.weekId}`);
  const [body, setBody] = useState(`I saw your blocker on ${report.weekId}:\n\n> ${report.blockers}\n\nLet me unblock you. `);
  return (
    <div>
      <Field label="subject"><Input value={subject} onChange={setSubject} /></Field>
      <Field label="body"><Textarea value={body} onChange={setBody} rows={8} /></Field>
      <Btn variant="primary" size="lg" onClick={() => onSend(subject, body)}>SEND →</Btn>
    </div>
  );
}

function FounderMessages({ user, users, teams, messages, messageAttachments, api, showToast }) {
  const [tab, setTab] = useState('compose');
  const [type, setType] = useState('message');
  const [toType, setToType] = useState('all');
  const [toIds, setToIds] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const [dueDate, setDueDate] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!subject.trim() || !body.trim()) { showToast('err', 'Subject and body required.'); return; }
    if (toType !== 'all' && toIds.length === 0) { showToast('err', 'Choose at least one recipient.'); return; }
    setSending(true);
    try {
      const m = {
        id: uid('msg'), fromUserId: user.id, fromName: user.name,
        toType, toIds: toType === 'all' ? [] : toIds,
        type, subject: subject.trim(), body: body.trim(), priority,
        readBy: [], dueDate: dueDate ? new Date(dueDate).getTime() : null,
      };
      await api.createMessage(m, files);
      setSubject(''); setBody(''); setToIds([]); setDueDate(''); setFiles([]);
      showToast('ok', 'Message broadcast.');
      setTab('sent');
    } catch (e) { showToast('err', e.message || 'Send failed.'); }
    finally { setSending(false); }
  };

  const sentMessages = [...messages].filter(m => m.fromUserId === user.id).sort((a, b) => b.createdAt - a.createdAt);
  const allMessages = [...messages].sort((a, b) => b.createdAt - a.createdAt);
  const teamUsers = users.filter(u => u.status === 'active');

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${T.ink}`, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { id: 'compose', label: 'COMPOSE' },
          { id: 'sent', label: `SENT BY YOU · ${sentMessages.length}` },
          { id: 'all', label: `ALL · ${allMessages.length}` },
        ].map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{
            ...mono, fontSize: 11, letterSpacing: '0.12em', padding: '8px 16px', cursor: 'pointer',
            borderBottom: tab === t.id ? `2px solid ${T.ink}` : '2px solid transparent',
            marginBottom: -1, color: tab === t.id ? T.ink : T.muted,
          }}>{t.label}</div>
        ))}
      </div>

      {tab === 'compose' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
          <div>
            <Field label="type">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[{ v: 'message', l: 'MESSAGE' }, { v: 'announcement', l: 'ANNOUNCEMENT' }, { v: 'task', l: 'TASK' }].map(o => (
                  <Btn key={o.v} size="sm" variant={type === o.v ? 'primary' : 'default'} onClick={() => setType(o.v)}>{o.l}</Btn>
                ))}
              </div>
            </Field>
            <Field label="recipients">
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {[{ v: 'all', l: 'EVERYONE' }, { v: 'team', l: 'TEAM(S)' }, { v: 'individual', l: 'INDIVIDUAL(S)' }].map(o => (
                  <Btn key={o.v} size="sm" variant={toType === o.v ? 'primary' : 'default'}
                    onClick={() => { setToType(o.v); setToIds([]); }}>{o.l}</Btn>
                ))}
              </div>
              {toType === 'team' && (
                <Picker
                  items={teams.map(t => ({ id: t.id, label: t.name, sub: `${users.filter(u => u.teamIds.includes(t.id) && u.status === 'active').length} members` }))}
                  selected={toIds} onChange={setToIds} />
              )}
              {toType === 'individual' && (
                <Picker
                  items={teamUsers.map(u => ({ id: u.id, label: u.name, sub: u.email }))}
                  selected={toIds} onChange={setToIds} />
              )}
              {toType === 'all' && (
                <div style={{ ...mono, fontSize: 11, color: T.muted, padding: '8px 0' }}>
                  → {teamUsers.length} active members will receive this.
                </div>
              )}
            </Field>
            <Field label="subject" required><Input value={subject} onChange={setSubject} placeholder="brief, descriptive" /></Field>
            <Field label="body" required><Textarea value={body} onChange={setBody} rows={6} placeholder="say what you mean. say it once." /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="priority">
                <Select value={priority} onChange={setPriority} options={[
                  { value: 'low', label: 'Low' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High — surfaces with red tag' },
                ]} />
              </Field>
              {type === 'task' && <Field label="due date"><Input type="date" value={dueDate} onChange={setDueDate} /></Field>}
            </div>
            {FEATURES.attachments && (
              <Field label="attachments">
                <AttachmentPicker files={files} setFiles={setFiles} />
              </Field>
            )}
            <Btn variant="primary" size="lg" onClick={send} disabled={sending}>
              {sending ? 'SENDING…' : 'BROADCAST →'}
            </Btn>
          </div>

          <div>
            <div style={{ ...mono, fontSize: 10, letterSpacing: '0.16em', color: T.muted, marginBottom: 8 }}>// PREVIEW</div>
            <div style={{ border: `1px solid ${T.ink}`, padding: 14, background: T.bg, minHeight: 200 }}>
              <div style={{ ...mono, fontSize: 9, letterSpacing: '0.14em', color: T.muted, marginBottom: 4 }}>
                FROM {user.name.toUpperCase()} · {new Date().toLocaleDateString()}
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {type === 'task' && <Tag color="blue">TASK</Tag>}
                {type === 'announcement' && <Tag color="ink">ANNOUNCEMENT</Tag>}
                {priority === 'high' && <Tag color="red">HIGH</Tag>}
              </div>
              <div style={{ ...sans, fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
                {subject || <span style={{ color: T.muted }}>(subject)</span>}
              </div>
              <div style={{ ...sans, fontSize: 13, color: T.inkSoft, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                {body || <span style={{ color: T.muted }}>(message body)</span>}
              </div>
              {dueDate && type === 'task' && (
                <div style={{ ...mono, fontSize: 11, color: T.red, marginTop: 10, letterSpacing: '0.08em' }}>
                  DUE {fmtDate(new Date(dueDate).getTime())}
                </div>
              )}
              {files.length > 0 && (
                <div style={{ ...mono, fontSize: 10, color: T.muted, marginTop: 10, letterSpacing: '0.06em' }}>
                  📎 {files.length} ATTACHMENT{files.length === 1 ? '' : 'S'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {(tab === 'sent' || tab === 'all') && (
        <div>
          {(tab === 'sent' ? sentMessages : allMessages).map(m => (
            <SentMessageRow key={m.id} m={m} users={users} teams={teams} attachments={messageAttachments[m.id] || []} />
          ))}
          {(tab === 'sent' ? sentMessages : allMessages).length === 0 && <Empty>Nothing here.</Empty>}
        </div>
      )}
    </div>
  );
}

function SentMessageRow({ m, users, teams, attachments }) {
  const [open, setOpen] = useState(false);
  const recipients = m.toType === 'all' ? users.filter(u => u.status === 'active') :
    m.toType === 'team' ? users.filter(u => u.status === 'active' && u.teamIds.some(t => m.toIds.includes(t))) :
    users.filter(u => m.toIds.includes(u.id));
  const readCount = recipients.filter(u => m.readBy.includes(u.id)).length;
  const target = m.toType === 'all' ? 'EVERYONE' :
    m.toType === 'team' ? `TEAMS: ${m.toIds.map(id => teams.find(t => t.id === id)?.name).filter(Boolean).join(', ').toUpperCase()}` :
    `INDIVIDUALS: ${m.toIds.map(id => users.find(u => u.id === id)?.name).filter(Boolean).join(', ').toUpperCase()}`;
  return (
    <div style={{ borderBottom: `1px solid ${T.ruleSoft}` }}>
      <div onClick={() => setOpen(!open)} style={{
        padding: '14px 0', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto', gap: 14,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...mono, fontSize: 9, letterSpacing: '0.14em', color: T.muted, marginBottom: 3 }}>
            {fmtDateTime(m.createdAt)} · FROM {m.fromName.toUpperCase()} · {target}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div style={{ ...sans, fontSize: 14, fontWeight: 500 }}>{m.subject}</div>
            {m.type === 'task' && <Tag color="blue">TASK</Tag>}
            {m.type === 'announcement' && <Tag color="ink">ANNOUNCEMENT</Tag>}
            {m.priority === 'high' && <Tag color="red">HIGH</Tag>}
            {attachments.length > 0 && <span style={{ ...mono, fontSize: 10, color: T.muted }}>📎{attachments.length}</span>}
          </div>
        </div>
        <div style={{ ...mono, fontSize: 11, color: T.muted, textAlign: 'right' }}>
          <div>READ {readCount}/{recipients.length}</div>
          <div style={{ marginTop: 4, height: 4, width: 80, background: T.bgAlt, position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, width: `${(readCount / Math.max(recipients.length, 1)) * 100}%`, background: T.ink }} />
          </div>
        </div>
      </div>
      {open && (
        <div style={{ paddingBottom: 14, ...sans, fontSize: 13, color: T.inkSoft, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          <div style={{ borderLeft: `2px solid ${T.ruleSoft}`, paddingLeft: 12, marginBottom: 14 }}>{m.body}</div>
          {attachments.length > 0 && <div style={{ marginBottom: 14 }}><AttachmentList attachments={attachments} dense /></div>}
          <div style={{ ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.08em' }}>── READ BY ──</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {recipients.map(u => (
              <Tag key={u.id} color={m.readBy.includes(u.id) ? 'green' : 'muted'}>
                {m.readBy.includes(u.id) ? '✓ ' : '○ '}{u.name}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FounderTeams({ users, teams, reports, api, showToast }) {
  const [editingTeam, setEditingTeam] = useState(null);
  const [newTeam, setNewTeam] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  const startNew = () => { setNewTeam(true); setEditingTeam(null); setName(''); setDesc(''); };
  const startEdit = (t) => { setEditingTeam(t); setNewTeam(false); setName(t.name); setDesc(t.description || ''); };

  const saveTeam = async () => {
    if (!name.trim()) return;
    try {
      if (newTeam) {
        await api.createTeam({ id: uid('team'), name: name.trim(), description: desc.trim() });
        showToast('ok', 'Team created.');
      } else {
        await api.updateTeam({ ...editingTeam, name: name.trim(), description: desc.trim() });
        showToast('ok', 'Team updated.');
      }
      setEditingTeam(null); setNewTeam(false);
    } catch (e) { showToast('err', e.message || 'Save failed.'); }
  };
  const deleteTeam = async (t) => {
    if (!confirm(`Delete team "${t.name}"? Members keep their accounts.`)) return;
    try { await api.deleteTeam(t.id); showToast('ok', 'Team deleted.'); }
    catch (e) { showToast('err', e.message || 'Delete failed.'); }
  };

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        borderBottom: `1px solid ${T.ink}`, paddingBottom: 12, marginBottom: 24, gap: 8, flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ ...mono, fontSize: 11, color: T.muted, letterSpacing: '0.16em' }}>// TEAMS</div>
          <h1 style={{ ...sans, margin: '4px 0 0', fontSize: 24, fontWeight: 500 }}>Org structure</h1>
        </div>
        <Btn variant="primary" size="lg" onClick={startNew}>+ NEW TEAM</Btn>
      </div>

      {(newTeam || editingTeam) && (
        <div style={{ border: `1px solid ${T.ink}`, padding: 18, marginBottom: 24, background: T.bg }}>
          <div style={{ ...mono, fontSize: 11, color: T.muted, marginBottom: 12, letterSpacing: '0.12em' }}>
            {newTeam ? 'NEW TEAM' : `EDIT TEAM · ${editingTeam.name}`}
          </div>
          <Field label="name" required><Input value={name} onChange={setName} placeholder="e.g. Engineering" /></Field>
          <Field label="description"><Input value={desc} onChange={setDesc} placeholder="optional" /></Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="primary" onClick={saveTeam}>SAVE</Btn>
            <Btn variant="ghost" onClick={() => { setNewTeam(false); setEditingTeam(null); }}>CANCEL</Btn>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        {teams.map(t => {
          const members = users.filter(u => u.teamIds.includes(t.id) && u.status === 'active');
          const founders = members.filter(m => m.role === 'founder');
          const teamMembers = members.filter(m => m.role === 'team');
          const teamReports = reports.filter(r => members.some(m => m.id === r.userId) && r.weekId === weekId());
          return (
            <div key={t.id} style={{ border: `1px solid ${T.ink}`, background: T.bg }}>
              <div style={{
                padding: '12px 14px', borderBottom: `1px solid ${T.ruleSoft}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
              }}>
                <div>
                  <div style={{ ...sans, fontSize: 16, fontWeight: 500 }}>{t.name}</div>
                  <div style={{ ...mono, fontSize: 10, color: T.muted }}>
                    {teamMembers.length} TEAM · {founders.length} FOUNDER · {teamReports.length}/{teamMembers.length} SUBMITTED
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Btn size="sm" onClick={() => startEdit(t)}>EDIT</Btn>
                  <Btn size="sm" variant="danger" onClick={() => deleteTeam(t)}>DEL</Btn>
                </div>
              </div>
              <div style={{ padding: '8px 14px' }}>
                <div style={{ ...mono, fontSize: 9, letterSpacing: '0.14em', color: T.muted, margin: '6px 0' }}>MEMBERS</div>
                <div>
                  {users.filter(u => u.status === 'active').map(u => {
                    const isMember = u.teamIds.includes(t.id);
                    return (
                      <div key={u.id} onClick={() => api.toggleTeamMembership(t, u.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0',
                          cursor: 'pointer', borderBottom: `1px solid ${T.ruleSoft}`,
                        }}>
                        <div style={{
                          width: 14, height: 14, border: `1px solid ${T.ink}`,
                          background: isMember ? T.ink : T.bg, color: T.bg,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0,
                        }}>{isMember ? '✓' : ''}</div>
                        <div style={{ flex: 1, ...sans, fontSize: 13, color: isMember ? T.ink : T.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {u.name}
                        </div>
                        <Tag color={u.role === 'founder' ? 'blue' : 'muted'}>
                          {u.role === 'founder' ? 'FOUNDER' : (u.position || '').toUpperCase()}
                        </Tag>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdminPanel({ user, users, teams, api, showToast }) {
  const [tab, setTab] = useState('users');
  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        borderBottom: `1px solid ${T.ink}`, paddingBottom: 12, marginBottom: 24,
      }}>
        <div>
          <div style={{ ...mono, fontSize: 11, color: T.red, letterSpacing: '0.16em' }}>// ADMIN PANEL · DESTRUCTIVE</div>
          <h1 style={{ ...sans, margin: '4px 0 0', fontSize: 24, fontWeight: 500 }}>System control</h1>
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: `1px solid ${T.ruleSoft}`, marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { id: 'users', label: 'TEAM MEMBERS' },
          { id: 'founders', label: 'FOUNDERS' },
          { id: 'self', label: 'SELF · YOU' },
        ].map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{
            ...mono, fontSize: 11, letterSpacing: '0.12em', padding: '8px 16px', cursor: 'pointer',
            borderBottom: tab === t.id ? `2px solid ${T.ink}` : '2px solid transparent',
            marginBottom: -1, color: tab === t.id ? T.ink : T.muted,
          }}>{t.label}</div>
        ))}
      </div>

      {tab === 'users' && <AdminUsers users={users} teams={teams} role="team" api={api} showToast={showToast} currentUser={user} />}
      {tab === 'founders' && <AdminUsers users={users} teams={teams} role="founder" api={api} showToast={showToast} currentUser={user} />}
      {tab === 'self' && <AdminSelf user={user} api={api} showToast={showToast} />}
    </div>
  );
}

function AdminUsers({ users, teams, role, api, showToast, currentUser }) {
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = users.filter(u => u.role === role);

  const blank = role === 'founder'
    ? { name: '', email: '', title: '', teamIds: [] }
    : { name: '', email: '', position: 'Employee', teamIds: [] };
  const [form, setForm] = useState(blank);

  const start = (u) => { setEditing(u); setCreating(false); setForm({ ...u }); };
  const startNew = () => { setEditing(null); setCreating(true); setForm({ ...blank }); };
  const cancel = () => { setEditing(null); setCreating(false); };

  const save = async () => {
    if (!form.name.trim() || !form.email.trim()) { showToast('err', 'Name and email required.'); return; }
    try {
      if (creating) {
        await api.createUser({
          id: uid(role === 'founder' ? 'founder' : 'user'),
          role, status: 'active', teamIds: form.teamIds || [], ...form,
        });
        showToast('ok', `Invited. ${form.name.split(' ')[0]} can now sign in with ${form.email}.`);
      } else {
        await api.updateUser({ ...editing, ...form });
        showToast('ok', 'User updated.');
      }
      cancel();
    } catch (e) { showToast('err', e.message || 'Save failed.'); }
  };

  const toggleStatus = async (u) => {
    try {
      await api.updateUser({ ...u, status: u.status === 'active' ? 'inactive' : 'active' });
      showToast('ok', `${u.name} ${u.status === 'active' ? 'deactivated' : 'reactivated'}.`);
    } catch (e) { showToast('err', e.message || 'Update failed.'); }
  };
  const remove = async (u) => {
    if (!confirm(`Permanently delete ${u.name}? Their reports will be removed too.`)) return;
    try { await api.deleteUser(u.id); showToast('ok', 'User deleted.'); }
    catch (e) {
      console.error('Delete failed:', e);
      const detail = e?.message || e?.details || JSON.stringify(e);
      showToast('err', `Delete failed: ${detail}`);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <div style={{ ...mono, fontSize: 12, color: T.muted, letterSpacing: '0.06em' }}>
          {list.length} {role === 'founder' ? 'FOUNDER' : 'TEAM MEMBER'}{list.length !== 1 ? 'S' : ''}
        </div>
        <Btn variant="primary" onClick={startNew}>+ ADD {role === 'founder' ? 'FOUNDER' : 'MEMBER'}</Btn>
      </div>

      <div style={{ border: `1px solid ${T.ink}`, marginBottom: 18, overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', ...mono, fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.bgAlt, borderBottom: `1px solid ${T.ink}` }}>
              <Th w="22%">NAME</Th>
              <Th w="24%">EMAIL</Th>
              <Th w="14%">{role === 'founder' ? 'TITLE' : 'POSITION'}</Th>
              <Th w="20%">TEAMS</Th>
              <Th w="10%">STATUS</Th>
              <Th w="10%">ACTIONS</Th>
            </tr>
          </thead>
          <tbody>
            {list.map(u => (
              <tr key={u.id} style={{ borderBottom: `1px solid ${T.ruleSoft}`, background: u.status === 'inactive' ? T.bgAlt : 'transparent', opacity: u.status === 'inactive' ? 0.6 : 1 }}>
                <Td><div style={{ ...sans, fontSize: 13 }}>{u.name}</div></Td>
                <Td>{u.email}</Td>
                <Td>{u.title || u.position}</Td>
                <Td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {u.teamIds.map(id => {
                      const t = teams.find(x => x.id === id);
                      return t ? <Tag key={id} color="muted">{t.name}</Tag> : null;
                    })}
                  </div>
                </Td>
                <Td><Tag color={u.status === 'active' ? 'green' : 'muted'}>{u.status.toUpperCase()}</Tag></Td>
                <Td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <Btn size="sm" onClick={() => start(u)}>EDIT</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => toggleStatus(u)} disabled={u.id === currentUser?.id}>{u.status === 'active' ? 'OFF' : 'ON'}</Btn>
                    {list.length > 1 && u.id !== currentUser?.id && <Btn size="sm" variant="danger" onClick={() => remove(u)}>×</Btn>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <div style={{ border: `1px solid ${T.ink}`, padding: 18, background: T.bg }}>
          <div style={{ ...mono, fontSize: 11, color: T.muted, marginBottom: 14, letterSpacing: '0.12em' }}>
            {creating ? `INVITE ${role.toUpperCase()}` : `EDIT · ${editing.name.toUpperCase()}`}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Field label="full name" required><Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} /></Field>
            <Field label="email" required hint={creating ? "they'll sign in with this email + OTP" : ''}>
              <Input value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            </Field>
            {role === 'founder' ? (
              <Field label="title"><Input value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="CEO, CTO…" /></Field>
            ) : (
              <Field label="position">
                <Select value={form.position} onChange={(v) => setForm({ ...form, position: v })}
                  options={['Employee', 'Contractor', 'Intern', 'Part-time'].map(x => ({ value: x, label: x }))} />
              </Field>
            )}
          </div>
          <Field label="team memberships">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {teams.map(t => {
                const on = (form.teamIds || []).includes(t.id);
                return (
                  <span key={t.id} onClick={() => setForm({
                    ...form,
                    teamIds: on ? form.teamIds.filter(id => id !== t.id) : [...(form.teamIds || []), t.id],
                  })} style={{
                    ...mono, fontSize: 11, padding: '4px 10px', cursor: 'pointer',
                    border: `1px solid ${on ? T.ink : T.ruleSoft}`,
                    background: on ? T.ink : T.bg, color: on ? T.bg : T.ink,
                    letterSpacing: '0.06em',
                  }}>{t.name}</span>
                );
              })}
            </div>
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="primary" onClick={save}>SAVE</Btn>
            <Btn variant="ghost" onClick={cancel}>CANCEL</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminSelf({ user, api, showToast }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [title, setTitle] = useState(user.title || '');

  const save = async () => {
    if (!name.trim() || !email.trim()) { showToast('err', 'Name and email required.'); return; }
    try {
      await api.updateUser({ ...user, name: name.trim(), email: email.trim(), title: title.trim() });
      showToast('ok', 'Profile updated.');
    } catch (e) { showToast('err', e.message || 'Update failed.'); }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ ...mono, fontSize: 11, color: T.muted, marginBottom: 14, letterSpacing: '0.12em' }}>
        // YOUR FOUNDER ACCOUNT · {user.email}
      </div>
      <Field label="name" required><Input value={name} onChange={setName} /></Field>
      <Field label="email" required hint="changing this changes how you sign in"><Input value={email} onChange={setEmail} /></Field>
      <Field label="title"><Input value={title} onChange={setTitle} placeholder="CEO, CTO, Founder…" /></Field>
      <div style={{
        ...mono, fontSize: 11, color: T.muted, padding: '10px 12px', border: `1px dashed ${T.ruleSoft}`,
        marginBottom: 14, lineHeight: 1.5,
      }}>
        // PASSWORDS REMOVED. Auth is email+OTP — no passwords to leak.
      </div>
      <Btn variant="primary" size="lg" onClick={save}>SAVE CHANGES</Btn>
    </div>
  );
}
