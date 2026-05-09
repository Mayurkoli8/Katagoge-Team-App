import React, { useState, useRef, useEffect } from 'react';
import { T, mono, sans, Btn, Modal, Tag } from './ui.jsx';
import { fmtBytes } from '../lib/dates.js';
import { attach } from '../lib/v2.js';
import { UPLOAD } from '../config.js';

/* ============================================================
   AttachmentList — shows tiles for a list of attachments.
   Lazy-fetches signed URLs as needed.
   ============================================================ */

export function AttachmentList({ attachments, onRemove, dense = false }) {
  if (!attachments?.length) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: dense ? 'repeat(auto-fill, minmax(140px, 1fr))' : 'repeat(auto-fill, minmax(180px, 1fr))',
      gap: 8, marginTop: 8,
    }}>
      {attachments.map(a => (
        <AttachmentTile key={a.id} att={a} onRemove={onRemove} />
      ))}
    </div>
  );
}

function AttachmentTile({ att, onRemove }) {
  const [url, setUrl] = useState(null);
  const [lightbox, setLightbox] = useState(false);

  // For images, fetch the signed URL eagerly. For others, fetch on click.
  useEffect(() => {
    if (att.kind === 'image') {
      let cancelled = false;
      attach.signedUrl(att.storagePath).then(u => { if (!cancelled) setUrl(u); }).catch(() => {});
      return () => { cancelled = true; };
    }
  }, [att.id, att.kind, att.storagePath]);

  const ensureUrl = async () => {
    if (url) return url;
    const u = await attach.signedUrl(att.storagePath);
    setUrl(u);
    return u;
  };

  const handleDownload = async () => {
    const u = await ensureUrl();
    // Open in new tab; the browser handles whether to download or display
    window.open(u, '_blank', 'noopener');
  };

  const handlePreview = async () => {
    if (att.kind === 'image' || att.kind === 'video') {
      await ensureUrl();
      setLightbox(true);
    } else {
      handleDownload();
    }
  };

  const tileStyle = {
    border: `1px solid ${T.ruleSoft}`, background: T.bg, position: 'relative',
    cursor: 'pointer', minHeight: 100, display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  };

  return (
    <>
      <div style={tileStyle} onClick={handlePreview}>
        {att.kind === 'image' && url && (
          <div style={{ height: 120, background: `url(${url}) center/cover`, backgroundColor: T.bgAlt }} />
        )}
        {att.kind === 'image' && !url && (
          <div style={{ height: 120, background: T.bgAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', ...mono, color: T.muted, fontSize: 10 }}>…</div>
        )}
        {att.kind === 'video' && (
          <div style={{ height: 120, background: T.bgAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            <div style={{ ...mono, fontSize: 28, color: T.muted }}>▶</div>
          </div>
        )}
        {att.kind === 'document' && (
          <div style={{ height: 120, background: T.bgAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4 }}>
            <div style={{ ...mono, fontSize: 24, color: T.muted }}>▤</div>
            <div style={{ ...mono, fontSize: 9, color: T.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {(att.filename.split('.').pop() || 'file').slice(0, 4)}
            </div>
          </div>
        )}
        <div style={{ padding: '6px 8px', borderTop: `1px solid ${T.ruleSoft}`, flex: 1 }}>
          <div title={att.filename} style={{
            ...sans, fontSize: 11, fontWeight: 500, lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.ink,
          }}>{att.filename}</div>
          <div style={{ ...mono, fontSize: 9, color: T.muted, marginTop: 2, letterSpacing: '0.06em' }}>
            {fmtBytes(att.sizeBytes)} · {att.kind.toUpperCase()}
          </div>
        </div>
        {onRemove && (
          <span onClick={(e) => { e.stopPropagation(); if (confirm('Remove this file?')) onRemove(att); }}
            style={{
              position: 'absolute', top: 4, right: 4, ...mono, fontSize: 11,
              background: T.bg, color: T.red, border: `1px solid ${T.red}`,
              padding: '0 5px', cursor: 'pointer',
            }}>×</span>
        )}
      </div>
      {lightbox && url && (
        <Lightbox att={att} url={url} onClose={() => setLightbox(false)} onDownload={handleDownload} />
      )}
    </>
  );
}

function Lightbox({ att, url, onClose, onDownload }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      }}>
        {att.kind === 'image' && (
          <img src={url} alt={att.filename} style={{ maxWidth: '95vw', maxHeight: '80vh', objectFit: 'contain' }} />
        )}
        {att.kind === 'video' && (
          <video src={url} controls autoPlay style={{ maxWidth: '95vw', maxHeight: '80vh' }} />
        )}
        <div style={{
          ...mono, fontSize: 12, color: '#fff', display: 'flex', gap: 10, alignItems: 'center',
          background: 'rgba(0,0,0,0.4)', padding: '6px 12px', border: `1px solid rgba(255,255,255,0.2)`,
        }}>
          <span>{att.filename}</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span>{fmtBytes(att.sizeBytes)}</span>
          <span style={{
            cursor: 'pointer', textDecoration: 'underline', marginLeft: 8,
          }} onClick={onDownload}>DOWNLOAD</span>
          <span style={{ cursor: 'pointer', marginLeft: 4, opacity: 0.7 }} onClick={onClose}>✕ CLOSE</span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   AttachmentPicker — file input + staging area before parent submit.
   Does NOT upload here; returns selected File objects to the parent.
   The parent uploads after creating its own record (so we have a parent id).
   ============================================================ */

export function AttachmentPicker({ files, setFiles, label = 'attachments', accept }) {
  const input = useRef(null);

  const onSelect = (e) => {
    const picked = Array.from(e.target.files || []);
    const valid = [];
    for (const f of picked) {
      if (f.size > UPLOAD.maxBytes) {
        alert(`"${f.name}" exceeds the ${Math.round(UPLOAD.maxBytes / 1024 / 1024)} MB limit.`);
        continue;
      }
      valid.push(f);
    }
    setFiles([...files, ...valid]);
    if (input.current) input.current.value = '';
  };

  const remove = (i) => setFiles(files.filter((_, idx) => idx !== i));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input ref={input} type="file" multiple accept={accept} onChange={onSelect} style={{ display: 'none' }} />
        <Btn size="sm" onClick={() => input.current?.click()}>+ ATTACH FILES</Btn>
        <span style={{ ...mono, fontSize: 10, color: T.muted, letterSpacing: '0.06em' }}>
          IMAGES · VIDEOS · DOCS · MAX {Math.round(UPLOAD.maxBytes / 1024 / 1024)}MB EACH
        </span>
      </div>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {files.map((f, i) => (
            <span key={i} style={{
              ...mono, fontSize: 11, padding: '4px 8px', border: `1px solid ${T.ruleSoft}`,
              background: T.bgAlt, display: 'inline-flex', gap: 6, alignItems: 'center',
              maxWidth: 240,
            }}>
              <span title={f.name} style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160,
              }}>{f.name}</span>
              <span style={{ color: T.muted }}>{fmtBytes(f.size)}</span>
              <span onClick={() => remove(i)} style={{ cursor: 'pointer', color: T.red }}>✕</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
