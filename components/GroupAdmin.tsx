'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Avatar from './Avatar';

type Member = { user_id: string; display_name: string; role: 'owner' | 'admin' | 'member'; joined_at: string; email: string | null };
type Message = { id: string; user_id: string; author: string; body: string; pinned: boolean; created_at: string };
const roleLabel = { owner: 'Creador', admin: 'Administrador', member: 'Miembro' } as const;

export const adminError = (e: unknown) => {
  const m = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return /schema cache|does not exist|Could not find/.test(m) ? 'Falta activar la administración en Supabase: ejecuta supabase/migrations/20261126_admin_groups_messages.sql en el SQL Editor.' : m;
};
const when = (iso: string) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

/** Mensajes fijados o recientes del grupo, en modo compacto para el radar. */
export function MessageBanner({ client, groupId }: { client: SupabaseClient | null; groupId: string }) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  useEffect(() => {
    if (!client || !groupId) return;
    let alive = true;
    const run = () => void client.rpc('radar_group_messages', { gid: groupId, max_rows: 3 }).then(({ data, error }) => { if (alive && !error) setMsgs((data || []) as Message[]); });
    run();
    const t = setInterval(run, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [client, groupId]);
  if (!msgs.length) return null;
  return (
    <section className="msg-banner" aria-label="Mensajes del grupo">
      {msgs.map((m) => (
        <p key={m.id}><b>{m.pinned ? '📌 ' : '📣 '}{m.author}:</b> {m.body} <small>{when(m.created_at)}</small></p>
      ))}
    </section>
  );
}

export default function GroupAdmin({ client, groupId, groupName, userId, isAppAdmin, base, onChanged }: { client: SupabaseClient; groupId: string; groupName: string; userId: string; isAppAdmin: boolean; base: string; onChanged: (removedGroup?: boolean) => Promise<void> | void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [pin, setPin] = useState(false);
  const [newName, setNewName] = useState(groupName);
  const me = members.find((m) => m.user_id === userId);
  const manage = isAppAdmin || me?.role === 'owner' || me?.role === 'admin';
  const owner = isAppAdmin || me?.role === 'owner';

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([client.rpc('radar_group_members', { gid: groupId }), client.rpc('radar_group_messages', { gid: groupId, max_rows: 30 })]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    setMembers((a.data || []) as Member[]);
    setMsgs((b.data || []) as Message[]);
  }, [client, groupId]);

  useEffect(() => {
    let alive = true;
    const run = () => load().catch((e) => { if (alive) setError(adminError(e)); });
    void run();
    const t = setInterval(run, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [load]);

  async function act(fn: () => PromiseLike<unknown>, ok: string, removed = false) {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const r = (await fn()) as { error?: unknown } | undefined;
      if (r && r.error) throw r.error;
      setInfo(ok);
      await load().catch(() => undefined);
      await onChanged(removed);
    } catch (e) {
      setError(adminError(e));
    } finally {
      setBusy(false);
    }
  }
  const rpc = (fn: string, args: Record<string, unknown>) => client.rpc(fn, args);

  return (
    <div className="group-admin">
      {error && <p role="alert" className="alert">{error}</p>}
      {info && <p role="status" className="notice">{info}</p>}

      <article className="content-panel">
        <span className="eyebrow">MENSAJES PARA TODO EL GRUPO</span>
        <h2>Avisos de {groupName}</h2>
        {manage ? (
          <form onSubmit={(e) => { e.preventDefault(); void act(async () => { const r = await rpc('radar_post_message', { gid: groupId, message: text, pin }); if (!r.error) { setText(''); setPin(false); } return r; }, 'Mensaje publicado para todo el grupo.'); }}>
            <label htmlFor="gm">Escribe un mensaje (máx. 500 caracteres)</label>
            <textarea id="gm" className="route-input" rows={3} maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej.: Salida el domingo 6:00 a.m. en el parque principal" />
            <label className="checkbox-row"><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Fijar arriba</label>
            <button className="primary" disabled={busy || !text.trim()}>Enviar a todo el grupo</button>
          </form>
        ) : (
          <p className="map-caption">Los administradores del grupo publican aquí los avisos para todos.</p>
        )}
        {msgs.length === 0 ? <p className="map-caption">Aún no hay mensajes.</p> : (
          <ul className="msg-list">
            {msgs.map((m) => (
              <li key={m.id} className={m.pinned ? 'pinned' : ''}>
                <div><b>{m.pinned ? '📌 ' : ''}{m.author}</b> <small>{when(m.created_at)}</small></div>
                <p>{m.body}</p>
                {manage && (
                  <div className="route-actions">
                    <button className="ghost" disabled={busy} onClick={() => void act(() => rpc('radar_message_action', { mid: m.id, action: m.pinned ? 'unpin' : 'pin' }), m.pinned ? 'Mensaje desfijado.' : 'Mensaje fijado.')}>{m.pinned ? 'Desfijar' : 'Fijar'}</button>
                    <button className="ghost danger" disabled={busy} onClick={() => { if (window.confirm('¿Borrar este mensaje para todos?')) void act(() => rpc('radar_message_action', { mid: m.id, action: 'delete' }), 'Mensaje borrado.'); }}>Borrar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="content-panel">
        <span className="eyebrow">PERSONAS</span>
        <h2>Integrantes ({members.length})</h2>
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.user_id}>
              <Avatar base={base} userId={m.user_id} name={m.display_name} size={40} />
              <div className="member-info">
                <strong>{m.display_name}{m.user_id === userId ? ' (tú)' : ''}</strong>
                <span><i className={`role-pill ${m.role}`}>{roleLabel[m.role]}</i>{m.email ? ` · ${m.email}` : ''}</span>
              </div>
              {manage && m.role !== 'owner' && m.user_id !== userId && (
                <div className="route-actions">
                  <button className="ghost" disabled={busy} onClick={() => { const n = window.prompt('Nuevo nombre para esta persona', m.display_name); if (n && n.trim() !== m.display_name) void act(() => rpc('radar_admin_update_member', { gid: groupId, target: m.user_id, new_name: n }), 'Nombre actualizado.'); }}>Renombrar</button>
                  {owner && <button className="ghost" disabled={busy} onClick={() => void act(() => rpc('radar_admin_update_member', { gid: groupId, target: m.user_id, new_role: m.role === 'admin' ? 'member' : 'admin' }), m.role === 'admin' ? 'Ahora es miembro.' : 'Ahora es administrador.')}>{m.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>}
                  {owner && <button className="ghost" disabled={busy} onClick={() => { if (window.confirm(`¿Pasar la propiedad del grupo a ${m.display_name}? Tú quedarás como administrador.`)) void act(() => rpc('radar_admin_transfer_owner', { gid: groupId, new_owner: m.user_id }), 'Propiedad transferida.'); }}>Dar propiedad</button>}
                  <button className="ghost danger" disabled={busy} onClick={() => { if (window.confirm(`¿Sacar a ${m.display_name} del grupo? Dejará de ver el radar.`)) void act(() => rpc('radar_admin_remove_member', { gid: groupId, target: m.user_id }), 'Persona retirada del grupo.'); }}>Sacar</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </article>

      <article className="content-panel">
        <span className="eyebrow">AJUSTES DEL GRUPO</span>
        {manage && (
          <>
            <form onSubmit={(e) => { e.preventDefault(); void act(() => rpc('radar_admin_rename_group', { gid: groupId, new_name: newName }), 'Grupo renombrado.'); }}>
              <label htmlFor="gname">Nombre del grupo</label>
              <input id="gname" className="route-input" value={newName} minLength={2} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
              <button className="ghost" disabled={busy || newName.trim() === groupName || newName.trim().length < 2}>Guardar nombre</button>
            </form>
            <p className="map-caption">¿Se filtró el código? Genera uno nuevo: el anterior deja de funcionar (quienes ya están dentro siguen en el grupo).</p>
            <button className="ghost" disabled={busy} onClick={() => { if (window.confirm('¿Generar un código de invitación nuevo?')) void act(() => rpc('radar_admin_regenerate_invite', { gid: groupId }), 'Código nuevo generado.'); }}>Generar código nuevo</button>
          </>
        )}
        {owner && (
          <button className="ghost danger" disabled={busy} onClick={() => { const t = window.prompt(`Para ELIMINAR el grupo y todas sus salidas escribe su nombre exacto:\n${groupName}`); if (t === groupName) void act(() => rpc('radar_admin_delete_group', { gid: groupId }), 'Grupo eliminado.', true); else if (t !== null) setError('El nombre no coincide: no se eliminó nada.'); }}>Eliminar este grupo</button>
        )}
        {me && me.role !== 'owner' && (
          <button className="ghost danger" disabled={busy} onClick={() => { if (window.confirm('¿Salir de este grupo?')) void act(() => rpc('radar_leave_group', { gid: groupId }), 'Saliste del grupo.', true); }}>Salir del grupo</button>
        )}
      </article>
    </div>
  );
}
