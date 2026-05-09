import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  T, mono, sans, Btn, Field, Input, Textarea, Tag, Section, Empty, Modal, Picker, useIsMobile,
} from './ui.jsx';
import { fmtTime, fmtDayLabel, relTime } from '../lib/dates.js';
import { chat, attach } from '../lib/v2.js';
import { AttachmentList, AttachmentPicker } from './Attachments.jsx';

/* ============================================================
   CHAT ROOT — manages the list of chats, the active chat,
   incoming realtime messages, and the layout.
   ============================================================ */

export function ChatPanel({ user, users, isFounder, showToast }) {
  const [chats, setChats] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState({}); // chatId -> messages[]
  const [attachments, setAttachments] = useState({}); // chatMessageId -> attachments[]
  const [members, setMembers] = useState({}); // chatId -> members[]
  const [newGroupModal, setNewGroupModal] = useState(false);
  const [newDmTarget, setNewDmTarget] = useState(null);
  const isMobile = useIsMobile();

  const refresh = useCallback(async () => {
    const [cs, ms] = await Promise.all([chat.listChats(), chat.listMyMemberships()]);
    setChats(cs);
    setMemberships(ms);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: subscribe to all chat-message inserts, append to relevant chat
  useEffect(() => {
    const unsub = chat.subscribeToMessages(async (msg, eventType) => {
      if (eventType === 'delete') {
        setMessages(prev => {
          const list = prev[msg.chatId] || [];
          return { ...prev, [msg.chatId]: list.filter(m => m.id !== msg.id) };
        });
        return;
      }
      if (eventType === 'update') {
        setMessages(prev => {
          const list = prev[msg.chatId] || [];
          return { ...prev, [msg.chatId]: list.map(m => m.id === msg.id ? msg : m) };
        });
        return;
      }
      // new INSERT
      setMessages(prev => {
        const list = prev[msg.chatId] || [];
        if (list.find(m => m.id === msg.id)) return prev;
        return { ...prev, [msg.chatId]: [...list, msg] };
      });
      // Bump last_message_at locally so the sidebar re-sorts
      setChats(prev => prev.map(c =>
        c.id === msg.chatId ? { ...c, lastMessageAt: msg.createdAt } : c
      ).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)));

      // If the new message has attachments, fetch them. There's a race here:
      // the sender uploads attachments AFTER inserting the message, so the
      // recipient may receive the message before any attachment rows exist.
      // We retry a few times with backoff. The attachments realtime
      // subscription (below) is the main path; this is a backup.
      if (msg.hasAttachments) {
        const tries = [200, 800, 2000];
        for (const delay of tries) {
          await new Promise(r => setTimeout(r, delay));
          try {
            const list = await attach.listForChatMessages([msg.id]);
            if (list.length > 0) {
              setAttachments(prev => ({ ...prev, [msg.id]: list }));
              break;
            }
          } catch (e) {}
        }
      }
    });

    // Realtime: also subscribe to attachment INSERTs. When a chat-message
    // attachment arrives, append it to the local cache for that message.
    const attachUnsub = attach.subscribeToChatAttachments((att) => {
      setAttachments(prev => {
        const existing = prev[att.chatMessageId] || [];
        if (existing.find(a => a.id === att.id)) return prev;
        return { ...prev, [att.chatMessageId]: [...existing, att] };
      });
    });

    return () => { unsub(); attachUnsub(); };
  }, []);

  // Auto-load messages for the active chat
  useEffect(() => {
    if (!activeChatId) return;
    let cancelled = false;
    (async () => {
      const [msgs, mems] = await Promise.all([
        chat.listMessages(activeChatId),
        chat.listMembers(activeChatId),
      ]);
      if (cancelled) return;
      setMessages(prev => ({ ...prev, [activeChatId]: msgs }));
      setMembers(prev => ({ ...prev, [activeChatId]: mems }));
      // Fetch attachments for messages that have any
      const withAttachIds = msgs.filter(m => m.hasAttachments).map(m => m.id);
      if (withAttachIds.length) {
        const all = await attach.listForChatMessages(withAttachIds);
        const byMsg = {};
        for (const a of all) {
          (byMsg[a.chatMessageId] = byMsg[a.chatMessageId] || []).push(a);
        }
        if (!cancelled) setAttachments(prev => ({ ...prev, ...byMsg }));
      }
      // Mark read
      try { await chat.markRead(activeChatId, user.id); } catch (e) {}
      // Update local membership too so unread badge clears
      setMemberships(prev => prev.map(m =>
        m.chatId === activeChatId && m.userId === user.id
          ? { ...m, lastReadAt: Date.now() } : m
      ));
    })();
    return () => { cancelled = true; };
  }, [activeChatId, user.id]);

  const myChatIds = useMemo(
    () => new Set(memberships.filter(m => m.userId === user.id).map(m => m.chatId)),
    [memberships, user.id]
  );
  const visibleChats = chats.filter(c => isFounder || myChatIds.has(c.id));

  const createGroup = async ({ name, description, memberIds }) => {
    try {
      const id = await chat.createChat({
        kind: 'group', name, description, memberIds, createdBy: user.id,
      });
      await refresh();
      setActiveChatId(id);
      setNewGroupModal(false);
      showToast('ok', 'Group created.');
    } catch (e) {
      showToast('err', e.message || 'Could not create group.');
    }
  };

  const startDm = async (targetUserId) => {
    // Find existing DM with this user pair
    const targetUser = users.find(u => u.id === targetUserId);
    if (!targetUser) return;
    const existing = chats.find(c => {
      if (c.kind !== 'dm') return false;
      const m = members[c.id];
      if (!m) return false; // can't tell yet, keep checking others
      const ids = m.map(x => x.userId).sort();
      return ids.length === 2 && ids.includes(user.id) && ids.includes(targetUserId);
    });
    if (existing) {
      setActiveChatId(existing.id);
      setNewDmTarget(null);
      return;
    }
    // For chats we haven't loaded members for, do a server-side search via creating
    // (we let creation handle dedup later if needed). Simpler: just create.
    try {
      const id = await chat.createChat({
        kind: 'dm', name: null, memberIds: [targetUserId], createdBy: user.id,
      });
      await refresh();
      setActiveChatId(id);
      setNewDmTarget(null);
    } catch (e) {
      showToast('err', e.message || 'Could not start chat.');
    }
  };

  const send = async ({ body, files }) => {
    if (!activeChatId) return;
    try {
      const msg = await chat.sendMessage({
        chatId: activeChatId, senderId: user.id, body,
        hasAttachments: files.length > 0,
      });
      // The realtime subscription will append it — but on slower networks
      // we want immediate visual feedback, so add it locally too.
      setMessages(prev => {
        const list = prev[activeChatId] || [];
        if (list.find(m => m.id === msg.id)) return prev;
        return { ...prev, [activeChatId]: [...list, msg] };
      });
      // Upload attachments after the message exists
      if (files.length > 0) {
        const uploaded = [];
        for (const f of files) {
          try {
            const a = await attach.upload(f, { chatMessageId: msg.id }, user.id);
            uploaded.push(a);
          } catch (e) {
            showToast('err', `Upload failed: ${f.name} — ${e.message || e}`);
          }
        }
        setAttachments(prev => ({ ...prev, [msg.id]: uploaded }));
      }
    } catch (e) {
      showToast('err', e.message || 'Send failed.');
    }
  };

  const activeChat = visibleChats.find(c => c.id === activeChatId);
  const activeMembers = activeChatId ? members[activeChatId] || [] : [];
  const activeMessages = activeChatId ? messages[activeChatId] || [] : [];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'minmax(220px, 280px) 1fr',
      gap: 0,
      border: `1px solid ${T.ink}`,
      height: 'calc(100vh - 120px)',
      minHeight: 480,
      background: T.bg,
    }}>
      {/* Sidebar: hide on mobile when chat is open */}
      {(!isMobile || !activeChatId) && (
        <ChatSidebar
          chats={visibleChats} memberships={memberships}
          activeChatId={activeChatId} setActiveChatId={setActiveChatId}
          users={users} user={user} members={members} setMembers={setMembers}
          isFounder={isFounder}
          onNewGroup={() => setNewGroupModal(true)}
          onNewDm={() => setNewDmTarget('open')}
        />
      )}
      {/* Right: messages */}
      {(!isMobile || activeChatId) && (
        activeChat ? (
          <ChatPane
            chatRecord={activeChat} members={activeMembers} messages={activeMessages}
            attachments={attachments}
            users={users} user={user} isFounder={isFounder}
            onSend={send}
            onBack={isMobile ? () => setActiveChatId(null) : null}
            onUpdate={async (updates) => {
              await chat.updateChat(activeChat.id, updates);
              await refresh();
              showToast('ok', 'Chat updated.');
            }}
            onAddMember={async (userId) => {
              try { await chat.addMember(activeChat.id, userId); }
              catch (e) { return showToast('err', e.message); }
              const ms = await chat.listMembers(activeChat.id);
              setMembers(prev => ({ ...prev, [activeChat.id]: ms }));
              showToast('ok', 'Member added.');
            }}
            onRemoveMember={async (userId) => {
              if (!confirm('Remove member from this chat?')) return;
              try { await chat.removeMember(activeChat.id, userId); }
              catch (e) { return showToast('err', e.message); }
              const ms = await chat.listMembers(activeChat.id);
              setMembers(prev => ({ ...prev, [activeChat.id]: ms }));
              showToast('ok', 'Member removed.');
            }}
            onDeleteChat={async () => {
              if (!confirm(`Delete this chat? All messages will be lost.`)) return;
              try { await chat.deleteChat(activeChat.id); }
              catch (e) { return showToast('err', e.message); }
              await refresh();
              setActiveChatId(null);
              showToast('ok', 'Chat deleted.');
            }}
            onDeleteMessage={async (msgId) => {
              try { await chat.deleteMessage(msgId); }
              catch (e) { return showToast('err', e.message); }
              setMessages(prev => ({
                ...prev,
                [activeChat.id]: (prev[activeChat.id] || []).filter(m => m.id !== msgId),
              }));
            }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...mono, color: T.muted, fontSize: 12, letterSpacing: '0.1em' }}>
            // SELECT A CHAT TO BEGIN
          </div>
        )
      )}

      {newGroupModal && isFounder && (
        <NewGroupModal users={users} self={user} onClose={() => setNewGroupModal(false)} onCreate={createGroup} />
      )}
      {newDmTarget && (
        <Modal title="START DIRECT MESSAGE" onClose={() => setNewDmTarget(null)}>
          <NewDmPicker users={users.filter(u => u.id !== user.id && u.status === 'active')}
                       onPick={startDm} />
        </Modal>
      )}
    </div>
  );
}

function ChatSidebar({ chats, memberships, activeChatId, setActiveChatId, users, user, members, setMembers, isFounder, onNewGroup, onNewDm }) {
  // Derive display name + unread count for each chat
  const myMemMap = useMemo(() => {
    const m = {};
    for (const mem of memberships) if (mem.userId === user.id) m[mem.chatId] = mem;
    return m;
  }, [memberships, user.id]);

  // For DMs we need to know who the other person is. Lazy-load members.
  useEffect(() => {
    const dmsNeedingMembers = chats.filter(c => c.kind === 'dm' && !members[c.id]);
    if (!dmsNeedingMembers.length) return;
    (async () => {
      const updates = {};
      for (const c of dmsNeedingMembers) {
        try { updates[c.id] = await chat.listMembers(c.id); } catch (e) {}
      }
      if (Object.keys(updates).length) setMembers(prev => ({ ...prev, ...updates }));
    })();
  }, [chats]); // eslint-disable-line

  const getChatDisplayName = (c) => {
    if (c.kind === 'group') return c.name || '(unnamed group)';
    const ms = members[c.id] || [];
    const other = ms.find(m => m.userId !== user.id);
    if (!other) return '…';
    const u = users.find(x => x.id === other.userId);
    return u?.name || 'Unknown';
  };

  const getUnread = (c) => {
    const lastRead = myMemMap[c.id]?.lastReadAt || 0;
    if (!c.lastMessageAt) return 0;
    return c.lastMessageAt > lastRead ? 1 : 0; // we just signal presence; can enhance to count
  };

  return (
    <div style={{
      borderRight: `1px solid ${T.ink}`, background: T.bgAlt,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 12px', borderBottom: `1px solid ${T.ruleSoft}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        ...mono, fontSize: 11, letterSpacing: '0.12em',
      }}>
        <span>CHATS · {chats.length}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Btn size="sm" variant="ghost" onClick={onNewDm} title="Start direct message">+ DM</Btn>
          {isFounder && <Btn size="sm" variant="ghost" onClick={onNewGroup} title="Create group">+ GROUP</Btn>}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {chats.length === 0 && (
          <div style={{ padding: 14, ...mono, fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
            // no chats yet
            <br />{isFounder ? 'create a group to begin' : 'a founder must invite you'}
          </div>
        )}
        {chats.map(c => {
          const active = c.id === activeChatId;
          const unread = getUnread(c);
          return (
            <div key={c.id} onClick={() => setActiveChatId(c.id)} style={{
              padding: '10px 12px', cursor: 'pointer',
              borderBottom: `1px solid ${T.ruleSoft}`,
              background: active ? T.bg : 'transparent',
              borderLeft: active ? `3px solid ${T.ink}` : '3px solid transparent',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
                <div style={{
                  ...sans, fontSize: 13, fontWeight: unread ? 600 : 500, color: T.ink,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  flex: 1, minWidth: 0,
                }}>
                  {c.kind === 'group' ? '# ' : '@ '}{getChatDisplayName(c)}
                </div>
                {unread > 0 && <span style={{ width: 6, height: 6, background: T.red, flexShrink: 0 }} />}
              </div>
              <div style={{ ...mono, fontSize: 9, color: T.muted, marginTop: 2, letterSpacing: '0.04em' }}>
                {c.lastMessageAt ? relTime(c.lastMessageAt) : 'NEW'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChatPane({
  chatRecord, members, messages, attachments, users, user, isFounder,
  onSend, onBack, onUpdate, onAddMember, onRemoveMember, onDeleteChat, onDeleteMessage,
}) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef(null);
  const [sending, setSending] = useState(false);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  const submit = async () => {
    if (!body.trim() && !files.length) return;
    setSending(true);
    try {
      await onSend({ body: body.trim(), files });
      setBody(''); setFiles([]);
    } finally { setSending(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); submit();
    }
  };

  // Group messages by day for date dividers
  const grouped = useMemo(() => {
    const out = []; let lastDay = null;
    for (const m of messages) {
      const dayKey = new Date(m.createdAt).toDateString();
      if (dayKey !== lastDay) { out.push({ divider: true, ts: m.createdAt }); lastDay = dayKey; }
      out.push(m);
    }
    return out;
  }, [messages]);

  const displayName = chatRecord.kind === 'group'
    ? chatRecord.name
    : (() => {
        const other = members.find(m => m.userId !== user.id);
        return users.find(u => u.id === other?.userId)?.name || 'Unknown';
      })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: `1px solid ${T.ink}`,
        display: 'flex', alignItems: 'center', gap: 10, background: T.bg,
      }}>
        {onBack && <span onClick={onBack} style={{ cursor: 'pointer', ...mono, fontSize: 12, color: T.muted }}>←</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...sans, fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chatRecord.kind === 'group' ? '# ' : '@ '}{displayName}
          </div>
          <div style={{ ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.08em' }}>
            {members.length} {chatRecord.kind === 'group' ? 'MEMBERS' : 'PEOPLE'}
            {chatRecord.kind === 'group' && chatRecord.description && <> · {chatRecord.description}</>}
          </div>
        </div>
        <Btn size="sm" variant="ghost" onClick={() => setShowSettings(true)}>SETTINGS</Btn>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '14px', background: T.bg,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {grouped.length === 0 && (
          <div style={{
            ...mono, fontSize: 11, color: T.muted, textAlign: 'center', padding: 40,
            letterSpacing: '0.06em',
          }}>
            // no messages yet
            <br /> say something
          </div>
        )}
        {grouped.map((m, i) => {
          if (m.divider) {
            return (
              <div key={`div-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0',
              }}>
                <div style={{ flex: 1, height: 1, background: T.ruleSoft }} />
                <div style={{ ...mono, fontSize: 9, color: T.muted, letterSpacing: '0.16em' }}>
                  {fmtDayLabel(m.ts).toUpperCase()}
                </div>
                <div style={{ flex: 1, height: 1, background: T.ruleSoft }} />
              </div>
            );
          }
          const sender = users.find(u => u.id === m.senderId);
          const isMe = m.senderId === user.id;
          const canDelete = isMe || isFounder;
          const atts = attachments[m.id] || [];
          return (
            <ChatMessageRow key={m.id} m={m} sender={sender} isMe={isMe}
              attachments={atts}
              canDelete={canDelete}
              onDelete={() => { if (confirm('Delete this message?')) onDeleteMessage(m.id); }} />
          );
        })}
      </div>

      {/* Composer */}
      <div style={{ borderTop: `1px solid ${T.ink}`, padding: 10, background: T.bg }}>
        <Textarea value={body} onChange={setBody} rows={2}
          placeholder="message · enter to send · shift+enter for newline"
          style={{ marginBottom: 8 }} />
        <div onKeyDown={onKeyDown} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <AttachmentPicker files={files} setFiles={setFiles} />
          <Btn variant="primary" onClick={submit} disabled={sending || (!body.trim() && !files.length)}>
            {sending ? 'SENDING…' : 'SEND →'}
          </Btn>
        </div>
        {/* Hack: handle Enter on the textarea */}
        <textarea style={{ display: 'none' }} onKeyDown={onKeyDown} />
      </div>

      {showSettings && (
        <ChatSettingsModal
          chatRecord={chatRecord} members={members} users={users}
          isFounder={isFounder} self={user}
          onClose={() => setShowSettings(false)}
          onUpdate={onUpdate} onAddMember={onAddMember} onRemoveMember={onRemoveMember}
          onDeleteChat={onDeleteChat}
        />
      )}
    </div>
  );
}

function ChatMessageRow({ m, sender, isMe, attachments, canDelete, onDelete }) {
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        padding: '4px 8px', borderRadius: 0,
        background: hover ? T.bgAlt : 'transparent',
        position: 'relative',
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ ...sans, fontSize: 12, fontWeight: 600, color: isMe ? T.blue : T.ink }}>
          {sender?.name || 'Unknown'}
        </span>
        <span style={{ ...mono, fontSize: 9, color: T.muted, letterSpacing: '0.06em' }}>
          {fmtTime(m.createdAt)}{m.editedAt ? ' · edited' : ''}
        </span>
        {canDelete && hover && (
          <span onClick={onDelete} style={{
            position: 'absolute', top: 4, right: 4, ...mono, fontSize: 10,
            color: T.red, cursor: 'pointer', padding: '0 4px',
          }}>✕</span>
        )}
      </div>
      {m.body && (
        <div style={{
          ...sans, fontSize: 13, lineHeight: 1.5, color: T.ink,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{m.body}</div>
      )}
      {attachments.length > 0 && <AttachmentList attachments={attachments} dense />}
    </div>
  );
}

function NewGroupModal({ users, self, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberIds, setMemberIds] = useState([]);
  return (
    <Modal title="NEW GROUP CHAT" onClose={onClose}>
      <Field label="name" required><Input value={name} onChange={setName} placeholder="e.g. Engineering" autoFocus /></Field>
      <Field label="description"><Input value={description} onChange={setDescription} placeholder="optional" /></Field>
      <Field label="members" hint="you'll be added automatically as admin">
        <Picker
          items={users.filter(u => u.id !== self.id && u.status === 'active')
                      .map(u => ({ id: u.id, label: u.name, sub: u.email }))}
          selected={memberIds} onChange={setMemberIds}
        />
      </Field>
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn variant="primary" onClick={() => onCreate({ name: name.trim(), description: description.trim(), memberIds })}
             disabled={!name.trim()}>CREATE GROUP →</Btn>
        <Btn variant="ghost" onClick={onClose}>CANCEL</Btn>
      </div>
    </Modal>
  );
}

function NewDmPicker({ users, onPick }) {
  const [q, setQ] = useState('');
  const filtered = users.filter(u =>
    !q.trim() || u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div>
      <Field label="search"><Input value={q} onChange={setQ} placeholder="name or email" autoFocus /></Field>
      <div style={{ border: `1px solid ${T.ruleSoft}`, maxHeight: 320, overflowY: 'auto' }}>
        {filtered.map(u => (
          <div key={u.id} onClick={() => onPick(u.id)} style={{
            padding: '10px 12px', cursor: 'pointer', borderBottom: `1px solid ${T.ruleSoft}`,
          }}>
            <div style={{ ...sans, fontSize: 13, fontWeight: 500 }}>{u.name}</div>
            <div style={{ ...mono, fontSize: 10, color: T.muted }}>{u.email}</div>
          </div>
        ))}
        {filtered.length === 0 && <div style={{ padding: 14, ...mono, fontSize: 11, color: T.muted }}>// no matches</div>}
      </div>
    </div>
  );
}

function ChatSettingsModal({ chatRecord, members, users, isFounder, self, onClose, onUpdate, onAddMember, onRemoveMember, onDeleteChat }) {
  const [name, setName] = useState(chatRecord.name || '');
  const [description, setDescription] = useState(chatRecord.description || '');
  const [adding, setAdding] = useState(false);
  const memberUsers = members.map(m => users.find(u => u.id === m.userId)).filter(Boolean);
  const eligibleToAdd = users.filter(u =>
    u.status === 'active' && !members.find(m => m.userId === u.id)
  );

  return (
    <Modal title={`CHAT SETTINGS · ${chatRecord.kind === 'group' ? 'GROUP' : 'DM'}`} onClose={onClose} wide>
      {chatRecord.kind === 'group' && isFounder && (
        <>
          <Field label="name"><Input value={name} onChange={setName} /></Field>
          <Field label="description"><Input value={description} onChange={setDescription} /></Field>
          <div style={{ marginBottom: 18 }}>
            <Btn variant="primary" onClick={() => onUpdate({ name: name.trim(), description: description.trim() })}>
              SAVE CHANGES
            </Btn>
          </div>
        </>
      )}

      <div style={{ borderTop: `1px solid ${T.ruleSoft}`, paddingTop: 14, marginBottom: 14 }}>
        <div style={{ ...mono, fontSize: 11, color: T.muted, letterSpacing: '0.12em', marginBottom: 8 }}>
          MEMBERS · {memberUsers.length}
        </div>
        <div style={{ border: `1px solid ${T.ruleSoft}` }}>
          {memberUsers.map(u => {
            const mem = members.find(m => m.userId === u.id);
            return (
              <div key={u.id} style={{
                padding: '8px 12px', borderBottom: `1px solid ${T.ruleSoft}`,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...sans, fontSize: 13, fontWeight: 500 }}>{u.name}</div>
                  <div style={{ ...mono, fontSize: 10, color: T.muted }}>{u.email}</div>
                </div>
                {mem?.role === 'admin' && <Tag color="blue">ADMIN</Tag>}
                {isFounder && chatRecord.kind === 'group' && u.id !== self.id && (
                  <Btn size="sm" variant="danger" onClick={() => onRemoveMember(u.id)}>REMOVE</Btn>
                )}
              </div>
            );
          })}
        </div>
        {isFounder && chatRecord.kind === 'group' && (
          <div style={{ marginTop: 10 }}>
            {!adding && <Btn size="sm" onClick={() => setAdding(true)}>+ ADD MEMBER</Btn>}
            {adding && (
              <div style={{ marginTop: 8 }}>
                <NewDmPicker users={eligibleToAdd} onPick={async (id) => { await onAddMember(id); setAdding(false); }} />
                <div style={{ marginTop: 8 }}>
                  <Btn size="sm" variant="ghost" onClick={() => setAdding(false)}>CANCEL</Btn>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {isFounder && (
        <div style={{ borderTop: `1px solid ${T.red}`, paddingTop: 14 }}>
          <div style={{ ...mono, fontSize: 11, color: T.red, letterSpacing: '0.12em', marginBottom: 8 }}>
            DANGER ZONE
          </div>
          <Btn variant="danger" onClick={onDeleteChat}>DELETE CHAT PERMANENTLY</Btn>
        </div>
      )}
    </Modal>
  );
}
