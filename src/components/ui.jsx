import React, { useState, useEffect } from 'react';

/* ============================================================
   DESIGN TOKENS — read live from CSS variables
   ============================================================ */
export const T = {
  bg:        'var(--bg)',
  bgAlt:     'var(--bgAlt)',
  ink:       'var(--ink)',
  inkSoft:   'var(--inkSoft)',
  muted:     'var(--muted)',
  ruleSoft:  'var(--ruleSoft)',
  red:       'var(--red)',
  redSoft:   'var(--redSoft)',
  green:     'var(--green)',
  greenSoft: 'var(--greenSoft)',
  amber:     'var(--amber)',
  amberSoft: 'var(--amberSoft)',
  blue:      'var(--blue)',
  blueSoft:  'var(--blueSoft)',
  shadow:    'var(--shadow)',
};

export const mono = { fontFamily: "'IBM Plex Mono', 'JetBrains Mono', 'Menlo', 'Consolas', monospace" };
export const sans = { fontFamily: "'IBM Plex Sans', 'Helvetica Neue', system-ui, sans-serif" };

/* ============================================================
   RESPONSIVE — useIsMobile hook
   ============================================================ */
export function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false
  );
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth <= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return mobile;
}

/* ============================================================
   UI PRIMITIVES
   ============================================================ */

export function Btn({ children, onClick, variant = 'default', disabled, type = 'button', size = 'md', title, style }) {
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
  const [hover, setHover] = useState(false);
  const v = variants[variant];
  let active = { ...base, ...v, ...style };
  if (hover && !disabled) {
    if (variant === 'primary') active = { ...active, background: T.inkSoft };
    else if (variant === 'danger') active = { ...active, background: T.red, color: T.bg };
    else active = { ...active, background: T.bgAlt };
  }
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled}
      style={active}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      {children}
    </button>
  );
}

export function Field({ label, hint, children, required }) {
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

export function Input({ value, onChange, placeholder, type = 'text', autoFocus, style, onKeyDown, disabled }) {
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

export function Textarea({ value, onChange, placeholder, rows = 4, autoFocus, style }) {
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

export function Select({ value, onChange, options, style }) {
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

export function Tag({ children, color = 'ink' }) {
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

export function StatusDot({ color }) {
  const c = ({ green: T.green, red: T.red, amber: T.amber, blue: T.blue, muted: T.muted, ink: T.ink })[color] || color;
  return <span style={{ display: 'inline-block', width: 8, height: 8, background: c, marginRight: 6, verticalAlign: 'baseline' }} />;
}

export function Section({ title, right, children, dense }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        gap: 8, flexWrap: 'wrap',
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

export function StatBox({ label, value, sub, color = 'ink' }) {
  const c = ({ green: T.green, red: T.red, amber: T.amber, blue: T.blue, ink: T.ink })[color] || T.ink;
  return (
    <div style={{
      border: `1px solid ${T.ink}`, padding: '10px 14px', background: T.bg,
      minHeight: 72, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    }}>
      <div style={{ ...mono, fontSize: 9, letterSpacing: '0.16em', color: T.muted, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ ...mono, fontSize: 28, color: c, lineHeight: 1, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </div>
        {sub && <div style={{ ...mono, fontSize: 10, color: T.muted }}>{sub}</div>}
      </div>
    </div>
  );
}

export function Toast({ kind, children, onClose }) {
  const palette = ({ ok: T.green, err: T.red, info: T.blue, warn: T.amber })[kind] || T.ink;
  useEffect(() => {
    if (!onClose) return;
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 1000,
      background: T.bg, border: `2px solid ${palette}`, padding: '10px 14px',
      ...mono, fontSize: 12, maxWidth: 360,
      boxShadow: `4px 4px 0 ${T.shadow}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ width: 8, height: 8, background: palette, marginTop: 5 }} />
        <div style={{ flex: 1, color: T.ink }}>{children}</div>
        {onClose && <span onClick={onClose} style={{ cursor: 'pointer', color: T.muted }}>✕</span>}
      </div>
    </div>
  );
}

export function Empty({ children }) {
  return (
    <div style={{
      border: `1px dashed ${T.ruleSoft}`, padding: 32, textAlign: 'center',
      ...mono, fontSize: 12, color: T.muted, letterSpacing: '0.04em',
    }}>{children}</div>
  );
}

export function Modal({ children, onClose, title, wide }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.bg, border: `1px solid ${T.ink}`, padding: 0,
        maxWidth: wide ? 800 : 560, width: '100%',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${T.ink}`, display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', background: T.bgAlt,
          position: 'sticky', top: 0, zIndex: 1,
        }}>
          <div style={{ ...mono, fontSize: 11, letterSpacing: '0.14em' }}>{title}</div>
          <span onClick={onClose} style={{ cursor: 'pointer', ...mono, color: T.muted, fontSize: 14 }}>✕</span>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

export function Th({ children, w }) {
  return <th style={{
    ...mono, fontSize: 9, letterSpacing: '0.14em', textAlign: 'left',
    padding: '8px 12px', color: T.inkSoft, fontWeight: 500, width: w,
  }}>{children}</th>;
}

export function Td({ children, w, align = 'left' }) {
  return <td style={{ padding: '10px 12px', verticalAlign: 'top', textAlign: align, width: w }}>{children}</td>;
}

export function Picker({ items, selected, onChange }) {
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
            color: T.bg, fontSize: 11, lineHeight: 1, flexShrink: 0,
          }}>{selected.includes(i.id) ? '✓' : ''}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ ...sans, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.label}</div>
            <div style={{ ...mono, fontSize: 10, color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
