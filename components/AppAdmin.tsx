'use client';
import { useCallback, useEffect, useState } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminError } from './GroupAdmin';

type U = { user_id: string; email: string; created_at: string; last_sign_in_at: string | null; groups: number; is_admin: boolean };
type G = { id: string; name: string; invite_code: string; owner_email: string | null; members: number; created_at: string };

/** Administración de la app: usuarios y grupos. Solo para administradores de la app (verificado en el servidor). */
export default function AppAdmin({ client, config, userId, groupId, onChanged }: { client: SupabaseClient; config: { url: string; key: string }; userId: string; groupId: string; onChanged: () => Promise<void> | void }) {
  const [users, setUsers] = useState<U[]>([]);
  const [groups, setGroups] = useState<G[]>([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [gid, setGid] = useState(groupId);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([client.rpc('radar_admin_users'), client.rpc('radar_admin_groups')]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    setUsers((a.data || []) as U[]);
    setGroups((b.data || []) as G[]);
  }, [client]);
  useEffect(() => { void Promise.resolve().then(load).catch((e) => setError(adminError(e))); }, [load]);

  async function act(fn: () => PromiseLike<unknown>, ok: string) {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const r = (await fn()) as { error?: unknown } | undefined;
      if (r && r.error) throw r.error;
      setInfo(ok);
      await load().catch(() => undefined);
      await onChanged();
    } catch (e) {
      setError(adminError(e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    // Cliente aparte, sin guardar sesión: crear a otra persona no cierra tu sesión de administrador.
    const temp = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error: e } = await temp.auth.signUp({ email: email.trim(), password: pass, options: { data: { full_name: name.trim() } } });
    if (e) throw e;
    if (data.user && data.user.identities && data.user.identities.length === 0) throw new Error('Ese correo ya tiene una cuenta.');
    const r = await client.rpc('radar_admin_add_member', { gid, member_email: email.trim(), member_name: name.trim() });
    if (r.error) throw r.error;
    setEmail(''); setName(''); setPass('');
    return undefined;
  }

  const shown = users.filter((u) => u.email.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section className="content-panel app-admin">
      <span className="eyebrow">ADMINISTRADOR DE LA APP</span>
      <h2>Usuarios y grupos</h2>
      {error && <p role="alert" className="alert">{error}</p>}
      {info && <p role="status" className="notice">{info}</p>}

      <form onSubmit={(e) => { e.preventDefault(); void act(create, 'Usuario creado y agregado al grupo. Si tu proyecto exige confirmar el correo, le llegará un mensaje; también puedes enviarle un enlace para elegir su contraseña.'); }}>
        <h3>Crear usuario</h3>
        <label>Nombre<input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Correo<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Contraseña temporal (mín. 8)<input type="text" required minLength={8} autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
        <label>Grupo<select value={gid} onChange={(e) => setGid(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <button className="primary" disabled={busy || !gid}>Crear usuario</button>
      </form>

      <h3>Usuarios ({users.length})</h3>
      <input className="route-input" placeholder="Buscar por correo…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="member-list">
        {shown.map((u) => (
          <li key={u.user_id}>
            <div className="member-info">
              <strong>{u.email}{u.user_id === userId ? ' (tú)' : ''}</strong>
              <span>{u.is_admin ? 'Administrador de la app · ' : ''}{u.groups} grupo{u.groups === 1 ? '' : 's'} · alta {new Date(u.created_at).toLocaleDateString('es-CO')}{u.last_sign_in_at ? ` · último ingreso ${new Date(u.last_sign_in_at).toLocaleDateString('es-CO')}` : ' · nunca ha ingresado'}</span>
            </div>
            <div className="route-actions">
              <button className="ghost" disabled={busy} onClick={() => void act(() => client.auth.resetPasswordForEmail(u.email, { redirectTo: window.location.origin }), `Enlace para cambiar la contraseña enviado a ${u.email}.`)}>Enviar enlace de contraseña</button>
              {u.user_id !== userId && !u.is_admin && <button className="ghost danger" disabled={busy} onClick={() => { if (window.confirm(`¿ELIMINAR la cuenta de ${u.email}? Se borran también sus salidas y recorridos. No se puede deshacer.`)) void act(() => client.rpc('radar_admin_delete_user', { target: u.user_id }), 'Cuenta eliminada.'); }}>Eliminar cuenta</button>}
            </div>
          </li>
        ))}
      </ul>

      <h3>Todos los grupos ({groups.length})</h3>
      <ul className="member-list">
        {groups.map((g) => (
          <li key={g.id}>
            <div className="member-info"><strong>{g.name}</strong><span>{g.members} integrantes · creador {g.owner_email ?? '—'} · {new Date(g.created_at).toLocaleDateString('es-CO')}</span></div>
            <div className="route-actions">
              <button className="ghost danger" disabled={busy} onClick={() => { const t = window.prompt(`Para ELIMINAR el grupo y todas sus salidas escribe su nombre exacto:\n${g.name}`); if (t === g.name) void act(() => client.rpc('radar_admin_delete_group', { gid: g.id }), 'Grupo eliminado.'); else if (t !== null) setError('El nombre no coincide: no se eliminó nada.'); }}>Eliminar grupo</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
