/**
 * V2 data access layer — attachments, chats, analytics
 * Composes onto db.js (which holds the original tables).
 */
import { supabase } from './supabase.js';
import { uid } from './db.js';
import { COMPANY, UPLOAD } from '../config.js';

/* ============================================================
   ATTACHMENTS
   ============================================================ */

const attachmentFromRow = (r) => r && ({
  id: r.id,
  uploaderId: r.uploader_id,
  reportId: r.report_id,
  messageId: r.message_id,
  chatMessageId: r.chat_message_id,
  storagePath: r.storage_path,
  filename: r.filename,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  kind: r.kind,
  width: r.width,
  height: r.height,
  createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
});

function inferKind(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
}

/** Reads an image file's natural dimensions. Returns {width, height} or null. */
async function getImageDimensions(file) {
  if (!file.type.startsWith('image/')) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(img.src); };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

export const attach = {
  /**
   * Upload a file and create the attachment row linking it to a parent record.
   * parent must be exactly one of: { reportId } | { messageId } | { chatMessageId }
   * Returns the attachment row.
   */
  async upload(file, parent, uploaderId, opts = {}) {
    if (file.size > UPLOAD.maxBytes) {
      throw new Error(`File too large. Max ${Math.round(UPLOAD.maxBytes / 1024 / 1024)} MB.`);
    }
    const kind = inferKind(file);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const id = uid('att');
    const path = `${COMPANY.id}/${uploaderId}/${id}.${ext}`;

    // 1. Upload to storage
    const { error: upErr } = await supabase.storage
      .from('attachments')
      .upload(path, file, {
        cacheControl: '3600',
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
    if (upErr) throw upErr;

    // 2. Image dimensions (best-effort)
    let dims = null;
    try { dims = await getImageDimensions(file); } catch (e) {}

    // 3. Insert attachment row
    const row = {
      id,
      uploader_id: uploaderId,
      report_id: parent.reportId || null,
      message_id: parent.messageId || null,
      chat_message_id: parent.chatMessageId || null,
      storage_path: path,
      filename: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      kind,
      width: dims?.width || null,
      height: dims?.height || null,
    };
    const { data, error } = await supabase
      .from('attachments').insert(row).select('*').single();
    if (error) {
      // Roll back the storage upload on row-insert failure
      await supabase.storage.from('attachments').remove([path]).catch(() => {});
      throw error;
    }
    return attachmentFromRow(data);
  },

  /** List all attachments for a parent. */
  async listFor(parent) {
    let q = supabase.from('attachments').select('*');
    if (parent.reportId)        q = q.eq('report_id', parent.reportId);
    else if (parent.messageId)  q = q.eq('message_id', parent.messageId);
    else if (parent.chatMessageId) q = q.eq('chat_message_id', parent.chatMessageId);
    else return [];
    const { data, error } = await q.order('created_at');
    if (error) throw error;
    return (data || []).map(attachmentFromRow);
  },

  /** Bulk fetch attachments for many reports — useful for analytics. */
  async listForReports(reportIds) {
    if (!reportIds.length) return [];
    const { data, error } = await supabase
      .from('attachments').select('*')
      .in('report_id', reportIds);
    if (error) throw error;
    return (data || []).map(attachmentFromRow);
  },
  async listForMessages(messageIds) {
    if (!messageIds.length) return [];
    const { data, error } = await supabase
      .from('attachments').select('*')
      .in('message_id', messageIds);
    if (error) throw error;
    return (data || []).map(attachmentFromRow);
  },
  async listForChatMessages(chatMessageIds) {
    if (!chatMessageIds.length) return [];
    const { data, error } = await supabase
      .from('attachments').select('*')
      .in('chat_message_id', chatMessageIds);
    if (error) throw error;
    return (data || []).map(attachmentFromRow);
  },

  /** Generate a temporary download/view URL for an attachment. */
  async signedUrl(storagePath, expiresInSec = 3600) {
    const { data, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(storagePath, expiresInSec);
    if (error) throw error;
    return data.signedUrl;
  },

  /** Delete an attachment (and the storage file). */
  async remove(attachment) {
    // Delete storage object first; if it fails we still try the row delete.
    await supabase.storage.from('attachments').remove([attachment.storagePath]).catch(() => {});
    const { error } = await supabase.from('attachments').delete().eq('id', attachment.id);
    if (error) throw error;
  },
};

/* ============================================================
   CHATS
   ============================================================ */

const chatFromRow = (r) => r && ({
  id: r.id,
  kind: r.kind,
  name: r.name || '',
  description: r.description || '',
  createdBy: r.created_by,
  createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
  lastMessageAt: r.last_message_at ? new Date(r.last_message_at).getTime() : null,
  archived: r.archived,
});

const chatMessageFromRow = (r) => r && ({
  id: r.id,
  chatId: r.chat_id,
  senderId: r.sender_id,
  body: r.body,
  createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  editedAt: r.edited_at ? new Date(r.edited_at).getTime() : null,
  hasAttachments: r.has_attachments,
});

const chatMemberFromRow = (r) => r && ({
  chatId: r.chat_id,
  userId: r.user_id,
  role: r.role,
  joinedAt: r.joined_at ? new Date(r.joined_at).getTime() : null,
  lastReadAt: r.last_read_at ? new Date(r.last_read_at).getTime() : null,
});

export const chat = {
  async listChats() {
    const { data, error } = await supabase
      .from('chats').select('*')
      .eq('archived', false)
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return (data || []).map(chatFromRow);
  },

  async listMembers(chatId) {
    const { data, error } = await supabase
      .from('chat_members').select('*').eq('chat_id', chatId);
    if (error) throw error;
    return (data || []).map(chatMemberFromRow);
  },

  /** All chat memberships across all chats — used to compute unread/sidebar. */
  async listMyMemberships() {
    const { data, error } = await supabase
      .from('chat_members').select('*');
    if (error) throw error;
    return (data || []).map(chatMemberFromRow);
  },

  async createChat({ kind, name, description, memberIds, createdBy }) {
    const id = uid('chat');
    const { error: chatErr } = await supabase.from('chats').insert({
      id, kind,
      name: kind === 'group' ? name : null,
      description: description || null,
      created_by: createdBy,
    });
    if (chatErr) throw chatErr;

    // Insert all members (including the creator if not already in memberIds)
    const allMembers = Array.from(new Set([...(memberIds || []), createdBy]));
    const rows = allMembers.map(uid => ({
      chat_id: id, user_id: uid,
      role: uid === createdBy ? 'admin' : 'member',
    }));
    const { error: memErr } = await supabase.from('chat_members').insert(rows);
    if (memErr) throw memErr;

    return id;
  },

  async updateChat(chatId, updates) {
    const row = {};
    if ('name' in updates) row.name = updates.name;
    if ('description' in updates) row.description = updates.description;
    if ('archived' in updates) row.archived = updates.archived;
    const { error } = await supabase.from('chats').update(row).eq('id', chatId);
    if (error) throw error;
  },

  async deleteChat(chatId) {
    const { error } = await supabase.from('chats').delete().eq('id', chatId);
    if (error) throw error;
  },

  async addMember(chatId, userId) {
    const { error } = await supabase.from('chat_members').insert({
      chat_id: chatId, user_id: userId, role: 'member',
    });
    if (error) throw error;
  },

  async removeMember(chatId, userId) {
    const { error } = await supabase.from('chat_members')
      .delete().eq('chat_id', chatId).eq('user_id', userId);
    if (error) throw error;
  },

  async listMessages(chatId, limit = 200) {
    const { data, error } = await supabase
      .from('chat_messages').select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(chatMessageFromRow).reverse(); // oldest → newest
  },

  async sendMessage({ chatId, senderId, body, hasAttachments = false }) {
    const id = uid('cm');
    const { data, error } = await supabase.from('chat_messages').insert({
      id, chat_id: chatId, sender_id: senderId, body, has_attachments: hasAttachments,
    }).select('*').single();
    if (error) throw error;
    return chatMessageFromRow(data);
  },

  async editMessage(messageId, body) {
    const { error } = await supabase.from('chat_messages')
      .update({ body, edited_at: new Date().toISOString() })
      .eq('id', messageId);
    if (error) throw error;
  },

  async deleteMessage(messageId) {
    const { error } = await supabase.from('chat_messages').delete().eq('id', messageId);
    if (error) throw error;
  },

  async markRead(chatId, userId) {
    const { error } = await supabase.from('chat_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('chat_id', chatId).eq('user_id', userId);
    if (error) throw error;
  },

  /** Subscribe to new messages in any chat. cb is called with each new message row. */
  subscribeToMessages(cb) {
    const channel = supabase
      .channel('chat_messages_changes')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => cb(chatMessageFromRow(payload.new))
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages' },
        (payload) => cb(chatMessageFromRow(payload.new), 'update')
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'chat_messages' },
        (payload) => cb({ id: payload.old.id, chatId: payload.old.chat_id, deleted: true }, 'delete')
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  },
};

/* ============================================================
   ANALYTICS — server-side aggregation helpers
   We do most filtering client-side (data is already loaded), but expose
   utility queries here for completeness and future scale.
   ============================================================ */

export const analytics = {
  /** Reports within a date range. */
  async reportsBetween(startTs, endTs) {
    const { data, error } = await supabase
      .from('reports').select('*')
      .gte('submitted_at', new Date(startTs).toISOString())
      .lte('submitted_at', new Date(endTs).toISOString())
      .order('submitted_at');
    if (error) throw error;
    return data || [];
  },
};
