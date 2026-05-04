import { supabase } from './supabase.js';

/* ---------- ROW MAPPERS ---------- */

const userFromRow = (r) => r && ({
  id: r.id,
  authUserId: r.auth_user_id,
  email: r.email,
  name: r.name,
  role: r.role,
  position: r.position || '',
  title: r.title || '',
  status: r.status,
  teamIds: r.team_ids || [],
  createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
});
const userToRow = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  position: u.position || null,
  title: u.title || null,
  status: u.status || 'active',
  team_ids: u.teamIds || [],
});

const teamFromRow = (r) => r && ({
  id: r.id,
  name: r.name,
  description: r.description || '',
  createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
});
const teamToRow = (t) => ({
  id: t.id,
  name: t.name,
  description: t.description || '',
});

const reportFromRow = (r) => r && ({
  id: r.id,
  userId: r.user_id,
  weekId: r.week_id,
  submittedAt: r.submitted_at ? new Date(r.submitted_at).getTime() : Date.now(),
  updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
  lastWeek: r.last_week,
  thisWeek: r.this_week,
  blockers: r.blockers || '',
  hasBlockers: r.has_blockers,
  isLate: r.is_late,
  blockerResolved: r.blocker_resolved,
});
const reportToRow = (r) => ({
  id: r.id,
  user_id: r.userId,
  week_id: r.weekId,
  submitted_at: r.submittedAt ? new Date(r.submittedAt).toISOString() : new Date().toISOString(),
  updated_at: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
  last_week: r.lastWeek,
  this_week: r.thisWeek,
  blockers: r.blockers || '',
  has_blockers: !!r.hasBlockers,
  is_late: !!r.isLate,
  blocker_resolved: !!r.blockerResolved,
});

const msgFromRow = (r) => r && ({
  id: r.id,
  fromUserId: r.from_user_id,
  fromName: r.from_name,
  toType: r.to_type,
  toIds: r.to_ids || [],
  type: r.type,
  subject: r.subject,
  body: r.body,
  priority: r.priority,
  readBy: r.read_by || [],
  dueDate: r.due_date ? new Date(r.due_date).getTime() : null,
  createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
});
const msgToRow = (m) => ({
  id: m.id,
  from_user_id: m.fromUserId,
  from_name: m.fromName,
  to_type: m.toType,
  to_ids: m.toIds || [],
  type: m.type,
  subject: m.subject,
  body: m.body,
  priority: m.priority || 'normal',
  read_by: m.readBy || [],
  due_date: m.dueDate ? new Date(m.dueDate).toISOString() : null,
});

/* ---------- API ---------- */

export const db = {
  /* USERS / PROFILES */
  async listUsers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('role', { ascending: false }) // founders first
      .order('name');
    if (error) throw error;
    return (data || []).map(userFromRow);
  },
  async createUser(u) {
    const { error } = await supabase.from('profiles').insert(userToRow(u));
    if (error) throw error;
  },
  async updateUser(u) {
    const { error } = await supabase
      .from('profiles')
      .update(userToRow(u))
      .eq('id', u.id);
    if (error) throw error;
  },
  async deleteUser(id) {
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) throw error;
  },
  async findProfileByEmail(email) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .ilike('email', email)
      .maybeSingle();
    if (error) throw error;
    return userFromRow(data);
  },
  async findProfileByAuthId(authId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_user_id', authId)
      .maybeSingle();
    if (error) throw error;
    return userFromRow(data);
  },

  /* TEAMS */
  async listTeams() {
    const { data, error } = await supabase.from('teams').select('*').order('name');
    if (error) throw error;
    return (data || []).map(teamFromRow);
  },
  async createTeam(t) {
    const { error } = await supabase.from('teams').insert(teamToRow(t));
    if (error) throw error;
  },
  async updateTeam(t) {
    const { error } = await supabase.from('teams').update(teamToRow(t)).eq('id', t.id);
    if (error) throw error;
  },
  async deleteTeam(id) {
    // Remove team from any user's team_ids first (we do this client-side after refetching)
    const { error } = await supabase.from('teams').delete().eq('id', id);
    if (error) throw error;
  },

  /* REPORTS */
  async listReports() {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('submitted_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(reportFromRow);
  },
  async upsertReport(r) {
    // Insert or update by (user_id, week_id) unique constraint
    const row = reportToRow(r);
    const { error } = await supabase
      .from('reports')
      .upsert(row, { onConflict: 'user_id,week_id' });
    if (error) throw error;
  },
  async resolveBlocker(reportId) {
    const { error } = await supabase
      .from('reports')
      .update({ blocker_resolved: true })
      .eq('id', reportId);
    if (error) throw error;
  },

  /* MESSAGES */
  async listMessages() {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(msgFromRow);
  },
  async createMessage(m) {
    const { error } = await supabase.from('messages').insert(msgToRow(m));
    if (error) throw error;
  },
  async markMessageRead(messageId, currentReadBy, profileId) {
    if (currentReadBy.includes(profileId)) return;
    const { error } = await supabase
      .from('messages')
      .update({ read_by: [...currentReadBy, profileId] })
      .eq('id', messageId);
    if (error) throw error;
  },
};

/* ---------- AUTH ---------- */

export const auth = {
  /**
   * Pre-flight check: is this email registered as an active member?
   * Calls a public Postgres function (email_is_registered) that returns
   * a boolean without leaking any other data. Lets us refuse OTP sends
   * for unauthorized emails up front.
   */
  async isEmailRegistered(email) {
    const { data, error } = await supabase.rpc('email_is_registered', {
      p_email: email.trim().toLowerCase(),
    });
    if (error) throw error;
    return !!data;
  },

  async sendOtp(email) {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        // We let Supabase create the auth user on first verify. Strangers are
        // blocked client-side by isEmailRegistered() before this is called.
        // This is the original, working pattern — patch-010 cleaned up the
        // malformed auth users that earlier patches accidentally created.
        shouldCreateUser: true,
      },
    });
    if (error) throw error;
  },
  async verifyOtp(email, token) {
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: 'email',
    });
    if (error) throw error;
    return data;
  },
  async getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session || null;
  },
  async signOut() {
    await supabase.auth.signOut();
  },
  onAuthStateChange(cb) {
    return supabase.auth.onAuthStateChange((_event, session) => cb(session));
  },
};

/* ---------- ID GENERATION (for new rows we control) ---------- */

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
