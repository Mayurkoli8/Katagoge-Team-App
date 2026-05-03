import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, auth, uid } from './lib/db.js';

/* ============================================================
   KATAGOGE — production build
   Same UI as the artifact, but:
     - real Supabase email-OTP auth (no password mode)
     - all reads/writes go through Postgres with RLS
     - founder/team role comes from the profiles table
   ============================================================ */

/* ---------- DESIGN TOKENS ---------- */
const T = {
  bg:        '#F4F2E9',
  bgAlt:     '#EBE8DB',
  ink:       '#141414',
  inkSoft:   '#3A3A35',
  muted:     '#7A7972',
  rule:      '#141414',
  ruleSoft:  '#C8C4B5',
  red:       '#A8321B',
  redSoft:   '#F2D9CF',
  green:     '#2F5D3A',
  greenSoft: '#D4DCC9',
  amber:     '#9C6A14',
  amberSoft: '#EFE0B8',
  blue:      '#1F4368',
  blueSoft:  '#D2DCE6',
};
const mono = { fontFamily: "'IBM Plex Mono', 'JetBrains Mono', 'Menlo', 'Consolas', monospace" };
const sans = { fontFamily: "'IBM Plex Sans', 'Helvetica Neue', system-ui, sans-serif" };

/* ---------- DATE / WEEK HELPERS ---------- */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNum };
}
function weekId(date = new Date()) {
  const { year, week } = getISOWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
function weekIdOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  return weekId(d);
}
function mondayOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}
function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' · ' +
         d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function relTime(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (days < 7) return `${days}d ago`;
  return fmtDate(ts);
}

function lookbackWeeks(n = 8) {
  return Array.from({ length: n }, (_, i) => weekIdOffset(-(n - 1 - i)));
}
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

/* ============================================================
   UI PRIMITIVES
   ============================================================ */

function Btn({ children, onClick, variant = 'default', disabled, type = 'button', size = 'md', title, style }) {
  const base = {
    ...mono,
    border: `1px solid ${T.ink}`,
    background: T.bg,
    color: T.ink,
    padding: size === 'sm' ? '4px 10px' : size === 'lg' ? '10px 18px' : '6px 14px',
    fontSize: size === 'sm' ? 11 : size === 'lg' ? 14 : 12,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    fontWeight: 500,
    transition: 'background 80ms linear, color 80ms linear',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };
  const variants = {
    default:  { background: T.bg, color: T.ink },
    primary:  { background: T.ink, color: T.bg },
    danger:   { background: T.bg, color: T.red, borderColor: T.red },
    ghost:    { background: 'transparent', color: T.ink, borderColor: 'transparent' },
    subtle:   { background: T.bgAlt, color: T.ink, borderColor: T.ruleSoft },
  };
  return (
    <button
      type={type} title={title} onClick={onClick} disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (variant === 'primary') e.currentTarget.style.background = T.inkSoft;
        else if (variant === 'danger') { e.currentTarget.style.background = T.red; e.currentTarget.style.color = T.bg; }
        else e.currentTarget.style.background = T.bgAlt;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        const v = variants[variant];
        e.currentTarget.style.background = v.background;
        e.currentTarget.style.color = v.color;
      }}>
      {children}
    </button>
  );
}

function Field({ label, hint, children, required }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{
        ...mono, fontSize: 10, letterSpacing: '0.12em',
        color: T.muted, textTransform: 'uppercase', marginBottom: 4,
      }}>
        {label}{required && <span style={{ color: T.red, marginLeft: 4 }}>*</span>}
        {hint && <span style={{ color: T.ruleSoft, marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>// {hint}</span>}
      </div>
      {children}
    </label>
  );
}

function Input({ value, onChange, placeholder, type = 'text', autoFocus, style, onKeyDown, disabled }) {
  const [focus, setFocus] = useState(false);
  return (
    <input
      type={type} value={value} placeholder={placeholder} autoFocus={autoFocus} disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      onKeyDown={onKeyDown}
      style={{
        ...mono, width: '100%', padding: '8px 10px', fontSize: 13,
        background: T.bg, color: T.ink,
        border: `1px solid ${focus ? T.ink : T.ruleSoft}`,
        outline: 'none', borderRadius: 0, ...style,
      }}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 4, autoFocus, style }) {
  const [focus, setFocus] = useState(false);
  return (
    <textarea
      value={value} placeholder={placeholder} rows={rows} autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={{
        ...mono, width: '100%', padding: '8px 10px', fontSize: 13, lineHeight: 1.55,
        background: T.bg, color: T.ink, resize: 'vertical',
        border: `1px solid ${focus ? T.ink : T.ruleSoft}`,
        outline: 'none', borderRadius: 0, fontFamily: mono.fontFamily, ...style,
      }}
    />
  );
}

function Select({ value, onChange, options, style }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{
        ...mono, width: '100%', padding: '8px 10px', fontSize: 13,
        background: T.bg, color: T.ink, border: `1px solid ${T.ruleSoft}`,
        borderRadius: 0, outline: 'none', ...style,
      }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Tag({ children, color = 'ink' }) {
  const palette = {
    ink:   { bg: T.bg, fg: T.ink, b: T.ink },
    green: { bg: T.greenSoft, fg: T.green, b: T.green },
    red:   { bg: T.redSoft, fg: T.red, b: T.red },
    amber: { bg: T.amberSoft, fg: T.amber, b: T.amber },
    blue:  { bg: T.blueSoft, fg: T.blue, b: T.blue },
    muted: { bg: T.bgAlt, fg: T.muted, b: T.ruleSoft },
  };
  const p = palette[color] || palette.ink;
  return (
    <span style={{
      ...mono, display: 'inline-block', padding: '1px 6px', fontSize: 10,
      background: p.bg, color: p.fg, border: `1px solid ${p.b}`,
      letterSpacing: '0.08em', textTransform: 'uppercase',
    }}>{children}</span>
  );
}

function StatusDot({ color }) {
  const c = { green: T.green, red: T.red, amber: T.amber, blue: T.blue, muted: T.muted, ink: T.ink }[color] || color;
  return <span style={{ display: 'inline-block', width: 8, height: 8, background: c, marginRight: 6, verticalAlign: 'baseline' }} />;
}

function Section({ title, right, children, dense }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        borderBottom: `1px solid ${T.ink}`, paddingBottom: 6, marginBottom: dense ? 8 : 14,
      }}>
        <h2 style={{ ...mono, margin: 0, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {title}
        </h2>
        <div>{right}</div>
      </div>
      {children}
    </section>
  );
}

function StatBox({ label, value, sub, color = 'ink', wide }) {
  const c = { green: T.green, red: T.red, amber: T.amber, blue: T.blue, ink: T.ink }[color] || T.ink;
  return (
    <div style={{
      border: `1px solid ${T.ink}`, padding: '10px 14px', background: T.bg,
      gridColumn: wide ? 'span 2' : 'span 1', minHeight: 72, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    }}>
      <div style={{ ...mono, fontSize: 9, letterSpacing: '0.16em', color: T.muted, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ ...mono, fontSize: 32, color: c, lineHeight: 1, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </div>
        {sub && <div style={{ ...mono, fontSize: 10, color: T.muted }}>{sub}</div>}
      </div>
    </div>
  );
}

function Toast({ kind, children, onClose }) {
  const palette = { ok: T.green, err: T.red, info: T.blue, warn: T.amber }[kind] || T.ink;
  useEffect(() => {
    if (!onClose) return;
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 1000,
      background: T.bg, border: `2px solid ${palette}`, padding: '10px 14px',
      ...mono, fontSize: 12, maxWidth: 360, boxShadow: '4px 4px 0 rgba(0,0,0,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ width: 8, height: 8, background: palette, marginTop: 5 }} />
        <div style={{ flex: 1, color: T.ink }}>{children}</div>
        {onClose && <span onClick={onClose} style={{ cursor: 'pointer', color: T.muted }}>✕</span>}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{
      border: `1px dashed ${T.ruleSoft}`, padding: 32, textAlign: 'center',
      ...mono, fontSize: 12, color: T.muted, letterSpacing: '0.04em',
    }}>{children}</div>
  );
}

function Modal({ children, onClose, title }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(20, 20, 20, 0.4)',
      zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.bg, border: `1px solid ${T.ink}`, padding: 0, maxWidth: 560, width: '100%',
        maxHeight: '85vh', overflowY: 'auto',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${T.ink}`, display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', background: T.bgAlt,
        }}>
          <div style={{ ...mono, fontSize: 11, letterSpacing: '0.14em' }}>{title}</div>
          <span onClick={onClose} style={{ cursor: 'pointer', ...mono, color: T.muted, fontSize: 14 }}>✕</span>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

/* ============================================================
   APP — auth, data, routing
   ============================================================ */

export default function App() {
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [reports, setReports] = useState([]);
  const [messages, setMessages] = useState([]);
  const [toast, setToast] = useState(null);
  const [authError, setAuthError] = useState(null);

  const showToast = useCallback((kind, msg) => setToast({ kind, msg }), []);

  /* ----- DATA LOADERS ----- */
  const loadUsers    = useCallback(async () => { setUsers(await db.listUsers()); }, []);
  const loadTeams    = useCallback(async () => { setTeams(await db.listTeams()); }, []);
  const loadReports  = useCallback(async () => { setReports(await db.listReports()); }, []);
  const loadMessages = useCallback(async () => { setMessages(await db.listMessages()); }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadUsers(), loadTeams(), loadReports(), loadMessages()]);
  }, [loadUsers, loadTeams, loadReports, loadMessages]);

  /* ----- BOOT ----- */
  useEffect(() => {
    let cancelled = false;

    const finishLogin = async (sess) => {
      try {
        const profile = await db.findProfileByAuthId(sess.user.id);
        if (!profile) {
          // Auth user exists but no profile row matched - reject them.
          setAuthError(
            'Your email is not authorized to access this workspace. ' +
            'Ask a founder to invite you, then try again.'
          );
          await auth.signOut();
          if (!cancelled) {
            setSession(null);
            setCurrentUser(null);
            setBooted(true);
          }
          return;
        }
        if (profile.status !== 'active') {
          setAuthError('Your access has been revoked. Contact a founder.');
          await auth.signOut();
          if (!cancelled) {
            setSession(null);
            setCurrentUser(null);
            setBooted(true);
          }
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
        setSession(null);
        setCurrentUser(null);
        setUsers([]); setTeams([]); setReports([]); setMessages([]);
      }
    });

    return () => {
      cancelled = true;
      subscription?.subscription?.unsubscribe?.();
    };
  }, [refreshAll]);

  /* ----- API (mutations + reload) ----- */
  const api = useMemo(() => ({
    async upsertReport(report)     { await db.upsertReport(report);  await loadReports(); },
    async resolveBlocker(reportId) { await db.resolveBlocker(reportId); await loadReports(); },
    async createMessage(message)   { await db.createMessage(message); await loadMessages(); },
    async markMessageRead(message, profileId) {
      await db.markMessageRead(message.id, message.readBy, profileId);
      await loadMessages();
    },
    async createUser(user)        { await db.createUser(user);   await loadUsers(); },
    async updateUser(user)        { await db.updateUser(user);   await loadUsers(); if (currentUser?.id === user.id) setCurrentUser(user); },
    async deleteUser(userId)      { await db.deleteUser(userId); await loadUsers(); },
    async createTeam(team)        { await db.createTeam(team);   await loadTeams(); },
    async updateTeam(team)        { await db.updateTeam(team);   await loadTeams(); },
    async deleteTeam(teamId) {
      await db.deleteTeam(teamId);
      // Clean team_id from any user that has it
      const affected = users.filter(u => u.teamIds.includes(teamId));
      for (const u of affected) {
        await db.updateUser({ ...u, teamIds: u.teamIds.filter(id => id !== teamId) });
      }
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
  }), [users, currentUser, loadReports, loadMessages, loadUsers, loadTeams]);

  const logout = async () => {
    await auth.signOut();
    setAuthError(null);
  };

  /* ----- RENDER ----- */

  const baseStyle = {
    minHeight: '100vh', background: T.bg, color: T.ink, ...sans, fontSize: 14,
  };

  if (!booted) {
    return (
      <div style={{ ...baseStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', ...mono, color: T.muted, fontSize: 11, letterSpacing: '0.16em' }}>
        KATAGOGE // BOOTING…
      </div>
    );
  }

  return (
    <div style={baseStyle}>
      {!session || !currentUser ? (
        <Login authError={authError} setAuthError={setAuthError} />
      ) : currentUser.role === 'founder' ? (
        <FounderShell
          user={currentUser}
          users={users} teams={teams} reports={reports} messages={messages}
          api={api} onLogout={logout} showToast={showToast}
        />
      ) : (
        <TeamShell
          user={currentUser}
          users={users} teams={teams} reports={reports} messages={messages}
          api={api} onLogout={logout} showToast={showToast}
        />
      )}
      {toast && <Toast kind={toast.kind} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </div>
  );
}

/* ============================================================
   LOGIN — single email-OTP flow for everyone
   ============================================================ */

function Login({ authError, setAuthError }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const sendCode = async () => {
    setErr('');
    setAuthError(null);
    if (!email.trim() || !email.includes('@')) {
      setErr('Enter a valid email.');
      return;
    }
    setLoading(true);
    try {
      await auth.sendOtp(email);
      setStep('otp');
    } catch (e) {
      setErr(e.message || 'Could not send code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setErr('');
    if (otp.length !== 6) { setErr('Enter the 6-digit code.'); return; }
    setLoading(true);
    try {
      await auth.verifyOtp(email, otp);
      // App's onAuthStateChange will pick up the session and finalize login.
    } catch (e) {
      setErr(e.message || 'Invalid or expired code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{
          borderBottom: `2px solid ${T.ink}`, paddingBottom: 12, marginBottom: 28,
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ ...mono, fontSize: 11, letterSpacing: '0.24em', color: T.muted }}>// INTERNAL TOOL</div>
            <h1 style={{ ...mono, margin: '4px 0 0', fontSize: 36, letterSpacing: '0.05em', fontWeight: 500 }}>
              KATAGOGE
            </h1>
            <div style={{ ...mono, fontSize: 11, color: T.inkSoft, marginTop: 2, letterSpacing: '0.04em' }}>
              Weekly accountability · Internal comms
            </div>
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
                We sent a 6-digit code to <strong>{email}</strong>. Code expires in 1 hour.
                Check spam if you don't see it within a minute.
              </div>
              <Field label="6-digit code" required>
                <Input value={otp} onChange={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                       placeholder="000000" autoFocus disabled={loading}
                       onKeyDown={(e) => e.key === 'Enter' && verify()}
                       style={{ letterSpacing: '0.4em', fontSize: 18, textAlign: 'center' }} />
              </Field>
              {err && <div style={{ ...mono, fontSize: 11, color: T.red, marginBottom: 12 }}>! {err}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
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

        <div style={{ marginTop: 32, ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.08em', textAlign: 'center' }}>
          KATAGOGE INTERNAL · ALL ACCESS LOGGED · UNAUTHORIZED USE PROHIBITED
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TOP NAV
   ============================================================ */

function TopNav({ user, current, onNav, onLogout, role, badge }) {
  const items = role === 'founder'
    ? [
        { id: 'overview', label: 'OVERVIEW' },
        { id: 'reports',  label: 'REPORTS' },
        { id: 'blockers', label: 'BLOCKERS', highlight: badge?.blockers },
        { id: 'messages', label: 'COMMS' },
        { id: 'teams',    label: 'TEAMS' },
        { id: 'admin',    label: 'ADMIN' },
      ]
    : [
        { id: 'submit',   label: 'SUBMIT' },
        { id: 'history',  label: 'HISTORY' },
        { id: 'inbox',    label: 'INBOX', count: badge?.unread },
      ];
  return (
    <div style={{
      borderBottom: `2px solid ${T.ink}`, background: T.bg,
      padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 24, position: 'sticky', top: 0, zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <div style={{ ...mono, fontSize: 18, letterSpacing: '0.06em', fontWeight: 600 }}>KATAGOGE</div>
        <div style={{ ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.16em' }}>
          {role === 'founder' ? '/ FOUNDER CONSOLE' : '/ TEAM TERMINAL'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 0, flex: 1, marginLeft: 12 }}>
        {items.map(it => {
          const active = current === it.id;
          return (
            <div key={it.id} onClick={() => onNav(it.id)}
              style={{
                ...mono, fontSize: 11, letterSpacing: '0.14em', padding: '6px 14px',
                cursor: 'pointer', borderBottom: active ? `2px solid ${T.ink}` : '2px solid transparent',
                marginBottom: -12, position: 'relative', display: 'flex', alignItems: 'center', gap: 6,
                color: active ? T.ink : T.inkSoft,
              }}>
              {it.label}
              {it.highlight > 0 && (
                <span style={{ background: T.red, color: T.bg, padding: '0px 4px', fontSize: 9, marginLeft: 2 }}>
                  {it.highlight}
                </span>
              )}
              {it.count > 0 && (
                <span style={{ background: T.ink, color: T.bg, padding: '0px 4px', fontSize: 9, marginLeft: 2 }}>
                  {it.count}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ ...mono, fontSize: 10, color: T.muted, textAlign: 'right' }}>
        <div style={{ color: T.ink, fontSize: 11, letterSpacing: '0.04em' }}>{user.name}</div>
        <div style={{ letterSpacing: '0.08em' }}>{user.role === 'founder' ? user.title || 'FOUNDER' : (user.position || '').toUpperCase()}</div>
      </div>
      <Btn size="sm" variant="ghost" onClick={onLogout}>LOGOUT</Btn>
    </div>
  );
}

/* ============================================================
   TEAM SHELL & VIEWS
   ============================================================ */

function isMessageForUser(m, user) {
  if (m.toType === 'all') return true;
  if (m.toType === 'team') return user.teamIds.some(t => m.toIds.includes(t));
  if (m.toType === 'individual') return m.toIds.includes(user.id);
  return false;
}

function TeamShell({ user, users, teams, reports, messages, api, onLogout, showToast }) {
  const [view, setView] = useState('submit');

  const myMessages = messages.filter(m => isMessageForUser(m, user));
  const unread = myMessages.filter(m => !m.readBy.includes(user.id)).length;

  // Mark messages read when inbox opens
  useEffect(() => {
    if (view !== 'inbox') return;
    (async () => {
      for (const m of myMessages) {
        if (!m.readBy.includes(user.id)) {
          await api.markMessageRead(m, user.id);
        }
      }
    })();
  }, [view]); // eslint-disable-line

  return (
    <>
      <TopNav user={user} role="team" current={view} onNav={setView} onLogout={onLogout} badge={{ unread }} />
      <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
        {view === 'submit'  && <TeamSubmit user={user} reports={reports} api={api} messages={myMessages} showToast={showToast} />}
        {view === 'history' && <TeamHistory reports={reports.filter(r => r.userId === user.id)} />}
        {view === 'inbox'   && <TeamInbox user={user} messages={myMessages} teams={teams} />}
      </div>
    </>
  );
}

function TeamSubmit({ user, reports, api, messages, showToast }) {
  const currentWeek = weekId();
  const myReports = reports.filter(r => r.userId === user.id);
  const existing = myReports.find(r => r.weekId === currentWeek);
  const lastWeekReport = myReports.find(r => r.weekId === weekIdOffset(-1));

  const [lastWeek, setLastWeek] = useState(existing?.lastWeek || '');
  const [thisWeek, setThisWeek] = useState(existing?.thisWeek || '');
  const [blockers, setBlockers] = useState(existing?.blockers || '');
  const [editing, setEditing] = useState(!existing);
  const [saving, setSaving] = useState(false);

  // Sync local state when remote `existing` changes (e.g. after refresh)
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
  const carryOver = useMemo(
    () => detectCarryOver(lastWeekReport, thisWeek),
    [lastWeekReport, thisWeek]
  );
  const recentTask = useMemo(
    () => messages
      .filter(m => m.type === 'task' && (!m.dueDate || m.dueDate > Date.now() - 14 * 86400000))
      .sort((a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity))[0],
    [messages]
  );

  const submit = async () => {
    if (!lastWeek.trim() || !thisWeek.trim()) {
      showToast('err', 'Last week and this week are required.');
      return;
    }
    setSaving(true);
    try {
      const report = {
        id: existing?.id || uid('rep'),
        userId: user.id,
        weekId: currentWeek,
        submittedAt: existing?.submittedAt || Date.now(),
        updatedAt: existing ? Date.now() : null,
        lastWeek: lastWeek.trim(),
        thisWeek: thisWeek.trim(),
        blockers: blockers.trim(),
        hasBlockers: !!blockers.trim(),
        isLate: existing ? existing.isLate : isLate,
        blockerResolved: existing?.blockerResolved || false,
      };
      await api.upsertReport(report);
      setEditing(false);
      showToast('ok', existing ? 'Report updated.' : 'Submitted. Have a good week.');
    } catch (e) {
      showToast('err', e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{
        border: `1px solid ${T.ink}`,
        background: existing ? T.greenSoft : (isLate ? T.amberSoft : T.bg),
        padding: '14px 18px', marginBottom: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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

      <Section
        title="Weekly Report"
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
              <Textarea value={thisWeek} onChange={setThisWeek} rows={5}
                placeholder="1. ___&#10;2. ___&#10;3. ___" />
            </Field>
            <Field label="Blockers" hint="leave empty if none. don't soften.">
              <Textarea value={blockers} onChange={setBlockers} rows={3}
                placeholder="What's preventing progress? Who/what do you need?" />
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
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <Btn variant="primary" size="lg" onClick={submit} disabled={saving}>
                {saving ? 'SAVING…' : (existing ? 'UPDATE REPORT' : 'SUBMIT REPORT')}
              </Btn>
              {editing && existing && (
                <Btn size="lg" onClick={() => {
                  setLastWeek(existing.lastWeek); setThisWeek(existing.thisWeek); setBlockers(existing.blockers || '');
                  setEditing(false);
                }}>CANCEL</Btn>
              )}
            </div>
          </>
        ) : (
          <ReportView report={existing} />
        )}
      </Section>

      {lastWeekReport && !existing && (
        <Section title="Last Week's Plan" dense>
          <div style={{
            border: `1px solid ${T.ruleSoft}`, padding: 14, ...mono, fontSize: 12, color: T.inkSoft,
            lineHeight: 1.6, background: T.bgAlt, whiteSpace: 'pre-wrap',
          }}>
            {lastWeekReport.thisWeek}
          </div>
          <div style={{ ...mono, fontSize: 10, color: T.muted, marginTop: 6, letterSpacing: '0.08em' }}>
            // use this to guide what you write under "what you did last week"
          </div>
        </Section>
      )}
    </div>
  );
}

function ReportView({ report }) {
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
      <div style={{ borderTop: `1px solid ${T.ruleSoft}`, padding: '8px 14px', ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.08em', display: 'flex', justifyContent: 'space-between' }}>
        <span>SUBMITTED {fmtDateTime(report.submittedAt)}</span>
        <span>{report.isLate ? 'LATE' : 'ON-TIME'} · {report.weekId}</span>
      </div>
    </div>
  );
}
function ReportField({ label, body, accent }) {
  return (
    <div style={{ borderTop: `1px solid ${T.ruleSoft}`, padding: '12px 14px' }}>
      <div style={{ ...mono, fontSize: 9, letterSpacing: '0.16em', color: accent || T.muted, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ ...sans, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: T.ink }}>
        {body}
      </div>
    </div>
  );
}

function TeamHistory({ reports }) {
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, ...mono, fontSize: 11, color: T.muted, letterSpacing: '0.08em' }}>
                  <span>{r.weekId} · {fmtDate(r.submittedAt)}</span>
                  <span>
                    {r.isLate && <Tag color="amber">LATE</Tag>}{' '}
                    {r.hasBlockers && <Tag color="red">BLOCKER</Tag>}
                  </span>
                </div>
                <ReportView report={r} />
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function TeamInbox({ user, messages, teams }) {
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
          <div>{filtered.map(m => <MessageRow key={m.id} m={m} user={user} teams={teams} />)}</div>
        )}
      </Section>
    </div>
  );
}

function MessageRow({ m, user, teams }) {
  const [open, setOpen] = useState(false);
  const isUnread = !m.readBy.includes(user.id);
  const target = m.toType === 'all' ? 'EVERYONE' :
    m.toType === 'team' ? `TEAM: ${m.toIds.map(id => teams.find(t => t.id === id)?.name || '?').join(', ').toUpperCase()}` :
    `DM`;
  return (
    <div style={{ borderTop: `1px solid ${T.ruleSoft}` }}>
      <div onClick={() => setOpen(!open)} style={{
        padding: '12px 14px', cursor: 'pointer',
        background: isUnread ? T.bg : 'transparent',
        display: 'grid', gridTemplateColumns: '12px 1fr auto', gap: 10, alignItems: 'center',
      }}>
        <div style={{ width: 8, height: 8, background: isUnread ? T.ink : 'transparent', border: isUnread ? 'none' : `1px solid ${T.ruleSoft}` }} />
        <div>
          <div style={{ ...mono, fontSize: 9, letterSpacing: '0.14em', color: T.muted, marginBottom: 2 }}>
            {target} · {m.fromName} · {relTime(m.createdAt)}
          </div>
          <div style={{ ...mono, fontSize: 13, color: T.ink, fontWeight: isUnread ? 600 : 400 }}>
            {m.subject}
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
        </div>
      )}
    </div>
  );
}

/* ============================================================
   FOUNDER SHELL & VIEWS
   ============================================================ */

function FounderShell({ user, users, teams, reports, messages, api, onLogout, showToast }) {
  const [view, setView] = useState('overview');
  const currentWeek = weekId();
  const activeBlockers = reports.filter(r => r.weekId === currentWeek && r.hasBlockers && !r.blockerResolved).length;

  return (
    <>
      <TopNav user={user} role="founder" current={view} onNav={setView} onLogout={onLogout} badge={{ blockers: activeBlockers }} />
      <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
        {view === 'overview' && <FounderOverview user={user} users={users} teams={teams} reports={reports} api={api} onNav={setView} />}
        {view === 'reports'  && <FounderReports users={users} teams={teams} reports={reports} />}
        {view === 'blockers' && <FounderBlockers users={users} reports={reports} api={api} founder={user} showToast={showToast} />}
        {view === 'messages' && <FounderMessages user={user} users={users} teams={teams} messages={messages} api={api} showToast={showToast} />}
        {view === 'teams'    && <FounderTeams users={users} teams={teams} reports={reports} api={api} showToast={showToast} />}
        {view === 'admin'    && <AdminPanel user={user} users={users} teams={teams} api={api} showToast={showToast} />}
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
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ ...mono, fontSize: 11, color: T.muted, letterSpacing: '0.16em' }}>
            // OVERVIEW · WEEK {currentWeek.split('-W')[1]} · {today.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()}
          </div>
          <h1 style={{ ...sans, margin: '4px 0 0', fontSize: 28, fontWeight: 500, letterSpacing: '-0.01em' }}>
            Good {today.getHours() < 12 ? 'morning' : today.getHours() < 17 ? 'afternoon' : 'evening'}, {user.name.split(' ')[0]}.
          </h1>
        </div>
        <div style={{ ...mono, fontSize: 11, color: T.muted, textAlign: 'right' }}>
          <div>{fmtDate(Date.now())}</div>
          <div>WEEK STARTS {fmtDate(monday)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 28 }}>
        <StatBox label="TEAM SIZE" value={teamUsers.length} sub="active" />
        <StatBox label="SUBMITTED" value={submittedCount} color="green" sub={`${submissionRate}%`} />
        <StatBox label="PENDING" value={pendingCount} color="amber" />
        <StatBox label="MISSING" value={missingCount} color={missingCount ? 'red' : 'ink'} />
        <StatBox label="LATE" value={lateCount} color={lateCount ? 'amber' : 'ink'} />
        <StatBox label="BLOCKERS" value={activeBlockers.length} color={activeBlockers.length ? 'red' : 'ink'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 28 }}>
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
                  return <BlockerCard key={r.id} report={r} user={u} compact
                    onResolve={() => api.resolveBlocker(r.id)} />;
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
                return <BlockerCard key={r.id} report={r} user={u} compact lingering
                  onResolve={() => api.resolveBlocker(r.id)} />;
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
    <div style={{ border: `1px solid ${T.ink}` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 12 }}>
        <thead>
          <tr style={{ background: T.bgAlt, borderBottom: `1px solid ${T.ink}` }}>
            <Th w="40%">NAME</Th>
            <Th w="25%">TEAM</Th>
            <Th w="15%">STATUS</Th>
            <Th w="20%">SUBMITTED</Th>
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
                  <Td><StatusDot color={statusColor} />{statusLabel}{report?.hasBlockers && <Tag color="red">●</Tag>}</Td>
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

function Th({ children, w }) {
  return <th style={{
    ...mono, fontSize: 9, letterSpacing: '0.14em', textAlign: 'left',
    padding: '8px 12px', color: T.inkSoft, fontWeight: 500, width: w,
  }}>{children}</th>;
}
function Td({ children, w, align = 'left' }) {
  return <td style={{ padding: '10px 12px', verticalAlign: 'top', textAlign: align, width: w }}>{children}</td>;
}

function Heatmap({ users, reports }) {
  const weeks = lookbackWeeks(8);
  return (
    <div style={{ border: `1px solid ${T.ink}`, background: T.bg, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 11 }}>
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
      <div style={{ borderTop: `1px solid ${T.ruleSoft}`, padding: '6px 12px', ...mono, fontSize: 10, color: T.muted, display: 'flex', gap: 14, letterSpacing: '0.06em' }}>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ ...sans, fontSize: 13, fontWeight: 500 }}>{user.name}</div>
        <div style={{ ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.06em' }}>
          {report.weekId} · {ageDays}d old
        </div>
      </div>
      <div style={{ ...sans, fontSize: 13, color: T.ink, lineHeight: 1.5, marginBottom: 8 }}>{report.blockers}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {onResolve && <Btn size="sm" onClick={onResolve}>MARK RESOLVED</Btn>}
        {onMessage && <Btn size="sm" variant="ghost" onClick={onMessage}>MESSAGE →</Btn>}
      </div>
    </div>
  );
}

function FounderReports({ users, teams, reports }) {
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
  if (statusFilter === 'late')      rows = rows.filter(r => r.report && r.report.isLate);
  if (statusFilter === 'blocked')   rows = rows.filter(r => r.report && r.report.hasBlockers);
  if (statusFilter === 'missing')   rows = rows.filter(r => !r.report);

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
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 160 }}>
          <Field label="week">
            <Select value={weekFilter} onChange={setWeekFilter}
              options={weeks.map(w => ({ value: w, label: w === weekId() ? `${w} (current)` : w }))} />
          </Field>
        </div>
        <div style={{ minWidth: 160 }}>
          <Field label="team">
            <Select value={teamFilter} onChange={setTeamFilter}
              options={[{ value: 'all', label: 'All teams' }, ...teams.map(t => ({ value: t.id, label: t.name }))]} />
          </Field>
        </div>
        <div style={{ minWidth: 160 }}>
          <Field label="status">
            <Select value={statusFilter} onChange={setStatusFilter} options={[
              { value: 'all', label: 'All' },
              { value: 'submitted', label: 'Submitted (on-time)' },
              { value: 'late', label: 'Late' },
              { value: 'blocked', label: 'With blockers' },
              { value: 'missing', label: 'Missing' },
            ]} />
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Field label="search"><Input value={search} onChange={setSearch} placeholder="search names, content…" /></Field>
        </div>
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
            {report ? <ReportView report={report} /> : (
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
        borderBottom: `1px solid ${T.ink}`, paddingBottom: 12, marginBottom: 24,
      }}>
        <div>
          <div style={{ ...mono, fontSize: 11, color: T.muted, letterSpacing: '0.16em' }}>// BLOCKER BOARD</div>
          <h1 style={{ ...sans, margin: '4px 0 0', fontSize: 24, fontWeight: 500 }}>What's stopping the team</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn size="sm" variant={showResolved ? 'primary' : 'ghost'} onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? 'HIDING NOTHING' : 'SHOW RESOLVED'}
          </Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatBox label="FRESH (< 4d)" value={byAge.fresh.length} color="amber" />
        <StatBox label="AGING (4–10d)" value={byAge.aging.length} color={byAge.aging.length ? 'red' : 'ink'} />
        <StatBox label="STALE (10d+)" value={byAge.stale.length} color={byAge.stale.length ? 'red' : 'ink'} />
      </div>

      {blockerReports.length === 0 ? (
        <Empty>No blockers. {showResolved ? 'No resolved blockers either.' : 'Try toggling resolved.'}</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          {[
            { key: 'stale', title: 'STALE — escalate', color: T.red, items: byAge.stale },
            { key: 'aging', title: 'AGING — pressure', color: T.amber, items: byAge.aging },
            { key: 'fresh', title: 'FRESH — observe', color: T.green, items: byAge.fresh },
          ].map(col => (
            <div key={col.key}>
              <div style={{
                ...mono, fontSize: 10, letterSpacing: '0.16em', color: col.color,
                paddingBottom: 6, borderBottom: `1px solid ${col.color}`, marginBottom: 10,
              }}>
                {col.title} · {col.items.length}
              </div>
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

function FounderMessages({ user, users, teams, messages, api, showToast }) {
  const [tab, setTab] = useState('compose');
  const [type, setType] = useState('message');
  const [toType, setToType] = useState('all');
  const [toIds, setToIds] = useState([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('normal');
  const [dueDate, setDueDate] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!subject.trim() || !body.trim()) { showToast('err', 'Subject and body required.'); return; }
    if (toType !== 'all' && toIds.length === 0) { showToast('err', 'Choose at least one recipient.'); return; }
    setSending(true);
    try {
      const m = {
        id: uid('msg'),
        fromUserId: user.id, fromName: user.name,
        toType, toIds: toType === 'all' ? [] : toIds,
        type, subject: subject.trim(), body: body.trim(), priority,
        readBy: [], dueDate: dueDate ? new Date(dueDate).getTime() : null,
      };
      await api.createMessage(m);
      setSubject(''); setBody(''); setToIds([]); setDueDate('');
      showToast('ok', 'Message broadcast.');
      setTab('sent');
    } catch (e) {
      showToast('err', e.message || 'Send failed.');
    } finally {
      setSending(false);
    }
  };

  const sentMessages = [...messages].filter(m => m.fromUserId === user.id).sort((a, b) => b.createdAt - a.createdAt);
  const allMessages = [...messages].sort((a, b) => b.createdAt - a.createdAt);
  const teamUsers = users.filter(u => u.status === 'active');

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: `1px solid ${T.ink}`, marginBottom: 24 }}>
        {[
          { id: 'compose', label: 'COMPOSE' },
          { id: 'sent', label: `SENT BY YOU · ${sentMessages.length}` },
          { id: 'all', label: `ALL TRAFFIC · ${allMessages.length}` },
        ].map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{
            ...mono, fontSize: 11, letterSpacing: '0.12em', padding: '8px 16px', cursor: 'pointer',
            borderBottom: tab === t.id ? `2px solid ${T.ink}` : '2px solid transparent',
            marginBottom: -1, color: tab === t.id ? T.ink : T.muted,
          }}>{t.label}</div>
        ))}
      </div>

      {tab === 'compose' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
          <div>
            <Field label="type">
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ v: 'message', l: 'MESSAGE' }, { v: 'announcement', l: 'ANNOUNCEMENT' }, { v: 'task', l: 'TASK' }].map(o => (
                  <Btn key={o.v} size="sm" variant={type === o.v ? 'primary' : 'default'} onClick={() => setType(o.v)}>{o.l}</Btn>
                ))}
              </div>
            </Field>

            <Field label="recipients">
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
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
            <Field label="body" required><Textarea value={body} onChange={setBody} rows={8} placeholder="say what you mean. say it once." /></Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="priority">
                <Select value={priority} onChange={setPriority} options={[
                  { value: 'low', label: 'Low' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'High — surfaces with red tag' },
                ]} />
              </Field>
              {type === 'task' && (
                <Field label="due date"><Input type="date" value={dueDate} onChange={setDueDate} /></Field>
              )}
            </div>

            <Btn variant="primary" size="lg" onClick={send} disabled={sending}>
              {sending ? 'SENDING…' : 'BROADCAST →'}
            </Btn>
          </div>

          <div>
            <div style={{ ...mono, fontSize: 10, letterSpacing: '0.16em', color: T.muted, marginBottom: 8 }}>
              // RECIPIENT PREVIEW
            </div>
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
            </div>
          </div>
        </div>
      )}

      {(tab === 'sent' || tab === 'all') && (
        <div>
          {(tab === 'sent' ? sentMessages : allMessages).map(m => (
            <SentMessageRow key={m.id} m={m} users={users} teams={teams} />
          ))}
          {(tab === 'sent' ? sentMessages : allMessages).length === 0 && <Empty>Nothing here.</Empty>}
        </div>
      )}
    </div>
  );
}

function Picker({ items, selected, onChange }) {
  const toggle = (id) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };
  return (
    <div style={{ border: `1px solid ${T.ruleSoft}`, maxHeight: 200, overflowY: 'auto' }}>
      {items.map(i => (
        <div key={i.id} onClick={() => toggle(i.id)} style={{
          padding: '8px 12px', cursor: 'pointer',
          background: selected.includes(i.id) ? T.bgAlt : 'transparent',
          borderBottom: `1px solid ${T.ruleSoft}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 14, height: 14, border: `1px solid ${T.ink}`,
            background: selected.includes(i.id) ? T.ink : T.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: T.bg, fontSize: 11, lineHeight: 1,
          }}>{selected.includes(i.id) ? '✓' : ''}</div>
          <div>
            <div style={{ ...sans, fontSize: 13 }}>{i.label}</div>
            <div style={{ ...mono, fontSize: 10, color: T.muted }}>{i.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SentMessageRow({ m, users, teams }) {
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
      <div onClick={() => setOpen(!open)} style={{ padding: '14px 0', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto', gap: 14 }}>
        <div>
          <div style={{ ...mono, fontSize: 9, letterSpacing: '0.14em', color: T.muted, marginBottom: 3 }}>
            {fmtDateTime(m.createdAt)} · FROM {m.fromName.toUpperCase()} · {target}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
            <div style={{ ...sans, fontSize: 14, fontWeight: 500 }}>{m.subject}</div>
            {m.type === 'task' && <Tag color="blue">TASK</Tag>}
            {m.type === 'announcement' && <Tag color="ink">ANNOUNCEMENT</Tag>}
            {m.priority === 'high' && <Tag color="red">HIGH</Tag>}
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
        borderBottom: `1px solid ${T.ink}`, paddingBottom: 12, marginBottom: 24,
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {teams.map(t => {
          const members = users.filter(u => u.teamIds.includes(t.id) && u.status === 'active');
          const founders = members.filter(m => m.role === 'founder');
          const teamMembers = members.filter(m => m.role === 'team');
          const teamReports = reports.filter(r => members.some(m => m.id === r.userId) && r.weekId === weekId());
          return (
            <div key={t.id} style={{ border: `1px solid ${T.ink}`, background: T.bg }}>
              <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.ruleSoft}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <div style={{ ...sans, fontSize: 16, fontWeight: 500 }}>{t.name}</div>
                  <div style={{ ...mono, fontSize: 10, color: T.muted }}>
                    {teamMembers.length} TEAM · {founders.length} FOUNDER · {teamReports.length}/{teamMembers.length} SUBMITTED THIS WEEK
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
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10,
                        }}>{isMember ? '✓' : ''}</div>
                        <div style={{ flex: 1, ...sans, fontSize: 13, color: isMember ? T.ink : T.muted }}>{u.name}</div>
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

      <div style={{ display: 'flex', borderBottom: `1px solid ${T.ruleSoft}`, marginBottom: 24 }}>
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

      {tab === 'users' && <AdminUsers users={users} teams={teams} role="team" api={api} showToast={showToast} />}
      {tab === 'founders' && <AdminUsers users={users} teams={teams} role="founder" api={api} showToast={showToast} />}
      {tab === 'self' && <AdminSelf user={user} api={api} showToast={showToast} />}
    </div>
  );
}

function AdminUsers({ users, teams, role, api, showToast }) {
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
          role, status: 'active', teamIds: form.teamIds || [],
          ...form,
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
    catch (e) { showToast('err', e.message || 'Delete failed.'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ ...mono, fontSize: 12, color: T.muted, letterSpacing: '0.06em' }}>
          {list.length} {role === 'founder' ? 'FOUNDER' : 'TEAM MEMBER'}{list.length !== 1 ? 'S' : ''}
        </div>
        <Btn variant="primary" onClick={startNew}>+ ADD {role === 'founder' ? 'FOUNDER' : 'MEMBER'}</Btn>
      </div>

      <div style={{ border: `1px solid ${T.ink}`, marginBottom: 18 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 12 }}>
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
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Btn size="sm" onClick={() => start(u)}>EDIT</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => toggleStatus(u)}>{u.status === 'active' ? 'OFF' : 'ON'}</Btn>
                    {list.length > 1 && <Btn size="sm" variant="danger" onClick={() => remove(u)}>×</Btn>}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
      <Field label="email" required hint="changing this changes how you sign in">
        <Input value={email} onChange={setEmail} />
      </Field>
      <Field label="title"><Input value={title} onChange={setTitle} placeholder="CEO, CTO, Founder…" /></Field>

      <div style={{
        ...mono, fontSize: 11, color: T.muted, padding: '10px 12px', border: `1px dashed ${T.ruleSoft}`,
        marginBottom: 14, lineHeight: 1.5,
      }}>
        // PASSWORDS REMOVED. Authentication is email+OTP for everyone — managed by Supabase Auth, no passwords to leak.
      </div>

      <Btn variant="primary" size="lg" onClick={save}>SAVE CHANGES</Btn>
    </div>
  );
}
