'use client';

export default function ErrorPage({retry}:{error:unknown;retry:()=>void}) {
  return <main className="app-shell"><section className="auth-card" style={{margin:'64px auto'}}>
    <span className="eyebrow">SELFIE BIKE RADAR</span>
    <h1>No pudimos abrir el radar</h1>
    <p className="subtle">La pantalla encontró un problema. Vuelve a intentarlo o recarga la página para obtener la versión actual.</p>
    <button className="primary" onClick={retry}>Volver a intentar</button>
    <button className="text-button" onClick={()=>window.location.reload()}>Recargar la página</button>
  </section></main>;
}
