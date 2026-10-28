'use strict';
/* Carga semanal · módulo de planificación
   Lee y escribe a través de las funciones "cargar_*" de la base (Supabase).
   La URL y la clave pública se piden a /api/config (variables de entorno de Vercel), igual que el informe:
   ninguna clave queda escrita en el repositorio. */

const CONFIG = {
  url: null,
  clave: null,
  tareasPorDia: 5,
  esperaGuardado: 1500
};
const CLAVE_SESION = 'cargaSemanal.sesion';
const CLAVE_ADMIN = 'cargaSemanal.claveAdmin';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

const S = {
  sesion: null,
  acciones: [],
  semanas: [],
  semana: null,
  dia: 0,
  filas: [],
  guardadoAt: null,
  guardando: false,
  pendiente: false,
  timer: null,
  avisoOculto: false,
  npAbierto: false,
  admin: { usuarios: null, texto: '', tipo: '', estado: 'activos', editando: null }
};

/* ---------- utilidades ---------- */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const aFecha = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const aIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sumarDias = (s, n) => { const d = aFecha(s); d.setDate(d.getDate() + n); return aIso(d); };
const ddmm = (s) => { const d = aFecha(s); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
const lunesDe = (s) => { const d = aFecha(s); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return aIso(d); };
const hoyIso = () => aIso(new Date());
const nombreDia = (s) => `${DIAS[aFecha(s).getDay()]} ${ddmm(s)}`;
const cortoDia = (s) => `${DIAS_CORTO[aFecha(s).getDay()]} ${String(aFecha(s).getDate()).padStart(2, '0')}`;
const rango = (a, b) => { const out = []; let x = a; while (x <= b && out.length < 7) { out.push(x); x = sumarDias(x, 1); } return out; };
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(',', '.').trim()); return Number.isFinite(n) ? n : NaN; };
const fmtH = (n) => `${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`;
const hora = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
const fechaHora = (ts) => { const d = new Date(ts); return `${ddmm(aIso(d))} a las ${hora(ts)}`; };
const uid = () => Math.random().toString(36).slice(2, 10);

function toast(msg, error = false) {
  $toast.textContent = msg;
  $toast.className = 'toast' + (error ? ' error' : '');
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $toast.hidden = true; }, error ? 6000 : 3000);
}

/* ---------- API ---------- */
async function configurar() {
  if (CONFIG.url) return;
  let cfg = null;
  try { const r = await fetch('/api/config', { cache: 'no-store' }); if (r.ok) cfg = await r.json(); } catch { /* sin función (desarrollo local) */ }
  cfg = cfg && cfg.url ? cfg : globalThis.APP_CONFIG;
  if (!cfg || !cfg.url || !cfg.key) throw new Error('Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en Vercel.');
  CONFIG.url = cfg.url; CONFIG.clave = cfg.key;
}
function cabeceras() {
  return { apikey: CONFIG.clave, Authorization: `Bearer ${CONFIG.clave}`, 'Content-Type': 'application/json' };
}
function mensajeError(data, status) {
  const m = (data && (data.message || data.error_description || data.hint)) || '';
  const k = m.match(/^[A-Z_]+: (.*)$/s);
  if (k) return k[1].charAt(0).toUpperCase() + k[1].slice(1);
  if (m) return m;
  return `No se pudo completar la operación (error ${status}).`;
}
async function pedir(ruta, opciones) {
  await configurar();
  const url = CONFIG.url + ruta;
  if (opciones && opciones.headers === null) opciones.headers = cabeceras();
  let r;
  try { r = await fetch(url, opciones); }
  catch { throw new Error('No hay conexión. Revisá internet y probá de nuevo.'); }
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
  if (!r.ok) { const e = new Error(mensajeError(data, r.status)); e.codigo = (data && data.message || '').split(':')[0]; throw e; }
  return data;
}
const rpc = (fn, params) => pedir(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: null, body: JSON.stringify(params || {}) });
const leerAcciones = () => pedir('/rest/v1/acciones?select=id,nombre,descripcion&activo=eq.true&order=nombre', { headers: null });
const correo = () => S.sesion && S.sesion.correo;

/* ---------- sesión ---------- */
function guardarSesion(p) {
  S.sesion = p;
  try { localStorage.setItem(CLAVE_SESION, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
}
function cerrarSesion() {
  S.sesion = null; S.semana = null; S.admin.usuarios = null;
  try { localStorage.removeItem(CLAVE_SESION); sessionStorage.removeItem(CLAVE_ADMIN); } catch { /* nada */ }
  location.hash = '#/';
  render();
}
function leerSesion() {
  try { const t = localStorage.getItem(CLAVE_SESION); return t ? JSON.parse(t) : null; } catch { return null; }
}

/* ---------- marco ---------- */
function marco(contenido, actual = '') {
  const s = S.sesion;
  const nav = s ? `
    <nav class="nav" aria-label="Cuenta">
      <span class="quien">${esc(s.nombre)} · ${esc(s.tipo || '')}</span>
      <a href="#/semanas" ${actual === 'semanas' ? 'aria-current="page"' : ''}>Mis semanas</a>
      ${s.es_admin ? `<a href="#/usuarios" ${actual === 'usuarios' ? 'aria-current="page"' : ''}>Usuarios</a>` : ''}
      <button type="button" data-accion="salir">Salir</button>
    </nav>` : '';
  $app.innerHTML = `
    <header class="barra">
      <a class="marca" href="#/semanas"><img src="/icons/icon-192.png" alt="">Planificación · Carga semanal</a>
      ${nav}
    </header>
    ${contenido}`;
}
function cargando(texto = 'Cargando…') { marco(`<p class="cargando">${esc(texto)}</p>`); }
function errorPantalla(msg) {
  marco(`<main class="contenido angosto"><div class="tarjeta" style="padding:24px;display:flex;flex-direction:column;gap:12px">
    <h1 style="font-size:20px">No se pudo cargar</h1><p>${esc(msg)}</p>
    <div><button type="button" class="btn btn-p" data-accion="reintentar">Probar de nuevo</button></div></div></main>`);
}

/* ---------- navegación ---------- */
function partes() { return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean); }

async function render() {
  if (!S.sesion) return vistaIngreso();
  await guardarSiHaceFalta();
  const [r, a, b] = partes();
  try {
    if (!S.acciones.length) S.acciones = await leerAcciones();
    if (r === 'semana' && a && b) return await abrirSemana(a, b);
    if (r === 'usuarios' && S.sesion.es_admin) return await vistaUsuarios();
    return await vistaSemanas();
  } catch (e) {
    errorPantalla(e.message);
  }
}
window.addEventListener('hashchange', render);

/* ---------- ingreso ---------- */
function vistaIngreso(error = '') {
  marco(`
    <main>
      <form class="tarjeta ingreso" data-form="ingreso" novalidate>
        <div style="display:flex;flex-direction:column;gap:8px">
          <h1>Ingresar</h1>
          <p style="color:var(--tenue)">Escribí tu correo de la empresa para cargar tu planificación.</p>
        </div>
        <label class="campo grande">Correo electrónico
          <input class="in" type="email" name="correo" inputmode="email" autocomplete="email" required ${error ? 'aria-invalid="true" aria-describedby="err-ingreso"' : ''}>
        </label>
        ${error ? `<p class="error-texto" id="err-ingreso">${esc(error)}</p>` : ''}
        <button type="submit" class="btn btn-p" style="min-height:48px;font-size:16px">Ingresar</button>
        <p class="nota">La sesión queda iniciada en este dispositivo. Si tu correo no está habilitado, pedí el alta al administrador.</p>
      </form>
    </main>`);
  const input = $app.querySelector('input[name=correo]');
  if (input) input.focus();
}
async function ingresar(form) {
  const valor = form.elements.correo.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valor)) return vistaIngreso('Revisá el correo: no parece válido.');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Ingresando…';
  try {
    const p = await rpc('cargar_ingresar', { p_correo: valor });
    guardarSesion(p);
    const antes = location.hash;
    location.hash = '#/semanas';
    if (antes === '#/semanas') render();
  } catch (e) {
    vistaIngreso(e.message);
    const i = $app.querySelector('input[name=correo]'); if (i) i.value = valor;
  }
}

/* ---------- mis semanas ---------- */
function estadoSemana(s) {
  if (s.estado === 'borrador') return { texto: 'Borrador', clase: 'chip-borrador' };
  const hoy = hoyIso();
  if (s.fecha_inicio > hoy) return { texto: 'Confirmada', clase: 'chip-curso' };
  if (s.fecha_fin >= hoy || s.lunes === lunesDe(hoy)) return { texto: 'En curso', clase: 'chip-curso' };
  return { texto: 'Cerrada', clase: 'chip-cerrada' };
}
function detalleSemana(s) {
  if (s.estado === 'borrador') return `${s.tareas} ${s.tareas === 1 ? 'tarea' : 'tareas'} · ${fmtH(s.horas)} planificadas`;
  const partes = [];
  if (s.origen === 'excel') partes.push('Cargada por Excel');
  else if (s.confirmada_at) partes.push(`Confirmada el ${ddmm(aIso(new Date(s.confirmada_at)))}`);
  if (s.sin_cumplimiento > 0) partes.push(`${s.sin_cumplimiento} sin cumplimiento`);
  if (s.cumplimiento !== null && s.cumplimiento !== undefined) partes.push(`Cumplimiento ${s.cumplimiento}%`);
  return partes.join(' · ');
}
function proximoLunes() {
  const hoy = hoyIso();
  return sumarDias(lunesDe(hoy), 7);
}
async function vistaSemanas() {
  cargando();
  S.semanas = await rpc('cargar_mis_semanas', { p_correo: correo() });
  const lunesHoy = lunesDe(hoyIso());
  const pendiente = S.semanas.find((s) => s.estado === 'confirmada' && s.sin_cumplimiento > 0 && s.lunes <= lunesHoy);
  const inicio = proximoLunes();
  const aviso = pendiente && !S.avisoOculto ? `
    <section class="aviso" aria-label="Cumplimiento pendiente">
      <div class="texto">
        <strong>La semana del ${ddmm(pendiente.fecha_inicio)} al ${ddmm(pendiente.fecha_fin)} tiene ${pendiente.sin_cumplimiento} ${pendiente.sin_cumplimiento === 1 ? 'tarea' : 'tareas'} sin cumplimiento</strong>
        <span>Podés completarlo ahora o más tarde. Lo que no se complete queda vacío.</span>
      </div>
      <div class="botones">
        <a class="btn btn-p" href="#/semana/${pendiente.fecha_inicio}/${pendiente.fecha_fin}">Completar ahora</a>
        <button type="button" class="btn" data-accion="aviso-mas-tarde">Más tarde</button>
      </div>
    </section>` : '';
  const lista = S.semanas.length ? S.semanas.map((s) => {
    const e = estadoSemana(s);
    return `<a class="item-semana" href="#/semana/${s.fecha_inicio}/${s.fecha_fin}">
      <span><span class="rango">${ddmm(s.fecha_inicio)} al ${ddmm(s.fecha_fin)}</span><span class="det">${esc(detalleSemana(s))}</span></span>
      <span class="chip ${e.clase}">${e.texto}</span></a>`;
  }).join('') : '<p class="vacio">Todavía no hay semanas cargadas.</p>';

  marco(`
    <main class="contenido angosto">
      ${aviso}
      <div class="dos-col">
        <form class="tarjeta nueva" data-form="semana" novalidate aria-labelledby="t-nueva">
          <div style="display:flex;flex-direction:column;gap:6px">
            <h1 id="t-nueva">Planificar una semana</h1>
            <p style="color:var(--tenue)">Elegí las fechas de la semana que vas a cargar.</p>
          </div>
          <div class="grid-2">
            <div class="dato"><span>Nombre y apellido</span><span>${esc(S.sesion.nombre)}</span></div>
            <div class="dato"><span>Tipo</span><span>${esc(S.sesion.tipo || '—')}</span></div>
            <label class="campo grande">Fecha de inicio
              <input class="in" type="date" name="inicio" value="${inicio}" required>
            </label>
            <label class="campo grande">Fecha de fin
              <input class="in" type="date" name="fin" value="${sumarDias(inicio, 4)}" min="${inicio}" required>
            </label>
          </div>
          <p class="error-texto" data-error hidden></p>
          <button type="submit" class="btn btn-p" style="min-height:48px;font-size:16px">Entrar</button>
        </form>
        <section class="tarjeta mias" aria-labelledby="t-mias">
          <h2 id="t-mias">Tus semanas</h2>
          ${lista}
        </section>
      </div>
    </main>`, 'semanas');
}
function entrarSemana(form) {
  const ini = form.elements.inicio.value, fin = form.elements.fin.value;
  const err = form.querySelector('[data-error]');
  const mostrar = (m) => { err.textContent = m; err.hidden = false; };
  if (!ini || !fin) return mostrar('Elegí la fecha de inicio y la de fin.');
  if (fin < ini) return mostrar('La fecha de fin no puede ser anterior a la de inicio.');
  if (fin > sumarDias(lunesDe(ini), 6)) return mostrar('La planificación tiene que quedar dentro de una misma semana, de lunes a domingo.');
  location.hash = `#/semana/${ini}/${fin}`;
}

/* ---------- semana ---------- */
async function abrirSemana(ini, fin, mantenerDia = false) {
  if (!mantenerDia) cargando('Abriendo la semana…');
  const sem = await rpc('cargar_semana', { p_correo: correo(), p_inicio: ini, p_fin: fin });
  const mismo = S.semana && S.semana.fecha_inicio === sem.fecha_inicio;
  S.semana = sem;
  if (!(mantenerDia && mismo)) { S.dia = 0; S.npAbierto = false; }
  if (sem.estado === 'borrador') {
    S.guardadoAt = sem.guardado_at;
    S.filas = prepararFilas(sem);
    vistaBorrador();
  } else {
    vistaCumplimiento();
  }
}
const diasSemana = () => rango(S.semana.fecha_inicio, S.semana.fecha_fin);
const filaVacia = (fecha) => ({ uid: uid(), fecha, accion_id: '', detalle: '', prioridad: '', horas: '', recursos: '', riesgos: '', abierta: false });
const filaConDatos = (f) => !!(f.accion_id || (f.detalle || '').trim() || String(f.horas || '').trim() || (f.recursos || '').trim() || (f.riesgos || '').trim());
function prepararFilas(sem) {
  const dias = rango(sem.fecha_inicio, sem.fecha_fin);
  const filas = (sem.tareas || []).filter((t) => dias.includes(t.fecha)).map((t) => ({
    uid: uid(), fecha: t.fecha, accion_id: t.accion_id ? String(t.accion_id) : '', detalle: t.detalle || '',
    prioridad: t.prioridad || '', horas: t.horas ?? '', recursos: t.recursos || '', riesgos: t.riesgos || '',
    abierta: !!((t.recursos || '').trim() || (t.riesgos || '').trim())
  }));
  dias.forEach((d) => completarDia(filas, d));
  return filas;
}
function completarDia(filas, dia) {
  const n = filas.filter((f) => f.fecha === dia).length;
  for (let i = n; i < CONFIG.tareasPorDia; i++) filas.push(filaVacia(dia));
}
function ordenarFilas() {
  const dias = diasSemana();
  S.filas.sort((a, b) => dias.indexOf(a.fecha) - dias.indexOf(b.fecha));
}
const horasDe = (lista) => lista.reduce((t, f) => { const h = num(f.horas); return t + (Number.isFinite(h) && h > 0 ? h : 0); }, 0);

/* ---------- borrador ---------- */
function opcionesAcciones(sel) {
  return `<option value="">Elegí una acción</option>` + S.acciones.map((a) =>
    `<option value="${a.id}" ${String(a.id) === String(sel) ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('');
}
const descAccion = (id) => { const a = S.acciones.find((x) => String(x.id) === String(id)); return a ? a.descripcion : ''; };
function opcionesImportancia(sel) {
  return ['', 'Alta', 'Media', 'Baja'].map((v) => `<option value="${v}" ${v === (sel || '') ? 'selected' : ''}>${v || '—'}</option>`).join('');
}
function filaBorradorHtml(f, i) {
  return `
  <article class="tarjeta fila" data-uid="${f.uid}" aria-label="Tarea ${i + 1}">
    <div class="fila-principal">
      <span class="num" aria-hidden="true">${i + 1}</span>
      <label class="campo f-accion">Acción
        <select class="in" data-campo="accion_id">${opcionesAcciones(f.accion_id)}</select>
        <span class="ayuda" data-ayuda>${esc(descAccion(f.accion_id))}</span>
      </label>
      <label class="campo f-detalle">Detalle
        <input class="in" type="text" data-campo="detalle" value="${esc(f.detalle)}" placeholder="Obra, cliente o aclaración" maxlength="300">
      </label>
      <label class="campo f-imp">Importancia
        <select class="in" data-campo="prioridad">${opcionesImportancia(f.prioridad)}</select>
      </label>
      <label class="campo f-horas">Horas
        <input class="in" type="text" inputmode="decimal" data-campo="horas" value="${esc(f.horas)}" placeholder="0" autocomplete="off">
      </label>
      <button type="button" class="btn-icono" data-accion="quitar-fila" aria-label="Quitar tarea ${i + 1}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>
    ${f.abierta ? `
    <div class="fila-opc">
      <label class="campo">Recursos necesarios (opcional)
        <input class="in" type="text" data-campo="recursos" value="${esc(f.recursos)}" placeholder="Sistema, planilla, vehículo…" maxlength="300">
      </label>
      <label class="campo">Riesgos o problemas (opcional)
        <input class="in" type="text" data-campo="riesgos" value="${esc(f.riesgos)}" placeholder="Qué podría demorarla" maxlength="300">
      </label>
    </div>` : `
    <div class="abrir"><button type="button" class="btn-texto" data-accion="abrir-opcionales">+ Recursos y riesgos (opcional)</button></div>`}
  </article>`;
}
function diasNavBorrador() {
  return diasSemana().map((d, i) => {
    const lista = S.filas.filter((f) => f.fecha === d && f.accion_id);
    return `<button type="button" class="dia" data-accion="dia" data-i="${i}" aria-current="${i === S.dia}">
      <span class="nombre"><span>${window.innerWidth <= 760 ? cortoDia(d) : nombreDia(d)}</span></span>
      <span class="res" data-res-dia="${d}">${lista.length} ${lista.length === 1 ? 'tarea' : 'tareas'} · ${fmtH(horasDe(lista))}</span>
    </button>`;
  }).join('');
}
function textoGuardado() {
  if (S.guardando) return 'Guardando…';
  if (S.pendiente) return 'Cambios sin guardar';
  if (S.guardadoAt) return `Borrador guardado a las ${hora(S.guardadoAt)}`;
  return 'Todavía no se guardó';
}
function vistaBorrador(foco) {
  const dias = diasSemana();
  if (S.dia >= dias.length) S.dia = 0;
  const dia = dias[S.dia];
  const filasDia = S.filas.filter((f) => f.fecha === dia);
  const conAccion = S.filas.filter((f) => f.accion_id);
  const jornada = Number(S.sesion.jornada_horas) || 44;
  marco(`
  <main class="contenido">
    <div class="encabezado">
      <div class="titulo">
        <div><h1>Semana del ${ddmm(S.semana.fecha_inicio)} al ${ddmm(S.semana.fecha_fin)}</h1><span class="chip chip-borrador">Borrador</span></div>
        <span class="sub">Total planificado: <strong data-total-semana>${fmtH(horasDe(conAccion))}</strong> de ${fmtH(jornada)} semanales</span>
      </div>
      <div class="herramientas">
        <button type="button" class="btn btn-chico" data-accion="copiar-semana">Copiar una semana anterior</button>
        <button type="button" class="btn btn-chico" data-accion="copiar-a-dias" ${dias.length < 2 ? 'disabled' : ''}>Copiar este día a otros</button>
      </div>
    </div>
    <div class="layout">
      <nav class="tarjeta dias" aria-label="Días de la semana">${diasNavBorrador()}</nav>
      <section class="panel" aria-labelledby="t-dia">
        <div class="panel-cab">
          <h2 id="t-dia">${nombreDia(dia)}</h2>
          <span>Total del día: <strong data-total-dia>${fmtH(horasDe(filasDia.filter((f) => f.accion_id)))}</strong></span>
        </div>
        ${filasDia.map((f, i) => filaBorradorHtml(f, i)).join('')}
        <div class="herramientas">
          <button type="button" class="btn btn-linea" data-accion="agregar-fila">+ Agregar tarea</button>
          ${S.dia > 0 ? '<button type="button" class="btn" data-accion="copiar-dia-anterior">Copiar del día anterior</button>' : ''}
        </div>
      </section>
    </div>
    <footer class="tarjeta pie">
      <p>Al confirmar, las tareas y las horas quedan fijas. Después solo vas a poder agregar tareas no planificadas y cambiar la importancia.
        <span class="estado" data-estado-guardado>${textoGuardado()}</span></p>
      <div class="botones">
        <button type="button" class="btn" data-accion="guardar-borrador">Guardar borrador</button>
        <button type="button" class="btn btn-p" data-accion="confirmar">Confirmar planificación</button>
      </div>
    </footer>
  </main>`, 'semanas');
  if (foco) { const el = $app.querySelector(`[data-uid="${foco}"] select`); if (el) el.focus(); }
}
function actualizarTotales() {
  const dias = diasSemana();
  const dia = dias[S.dia];
  const t = (sel, v) => { const el = $app.querySelector(sel); if (el) el.textContent = v; };
  t('[data-total-semana]', fmtH(horasDe(S.filas.filter((f) => f.accion_id))));
  t('[data-total-dia]', fmtH(horasDe(S.filas.filter((f) => f.fecha === dia && f.accion_id))));
  dias.forEach((d) => {
    const lista = S.filas.filter((f) => f.fecha === d && f.accion_id);
    t(`[data-res-dia="${d}"]`, `${lista.length} ${lista.length === 1 ? 'tarea' : 'tareas'} · ${fmtH(horasDe(lista))}`);
  });
}
function marcarEstadoGuardado() {
  const el = $app.querySelector('[data-estado-guardado]');
  if (el) el.textContent = textoGuardado();
}
function cambioBorrador() {
  S.pendiente = true;
  marcarEstadoGuardado();
  clearTimeout(S.timer);
  S.timer = setTimeout(() => guardarBorrador(), CONFIG.esperaGuardado);
}
function payloadFilas() {
  return S.filas.filter(filaConDatos).map((f) => ({
    fecha: f.fecha, accion_id: f.accion_id ? Number(f.accion_id) : '', detalle: f.detalle.trim(),
    prioridad: f.prioridad, horas: String(f.horas).trim(), recursos: f.recursos.trim(), riesgos: f.riesgos.trim()
  }));
}
async function guardarBorrador(avisar = false) {
  clearTimeout(S.timer);
  if (!S.semana || S.semana.estado !== 'borrador') return;
  if (S.guardando) { S.pendiente = true; return; }
  S.guardando = true; S.pendiente = false; marcarEstadoGuardado();
  try {
    const r = await rpc('cargar_guardar_borrador', { p_correo: correo(), p_inicio: S.semana.fecha_inicio, p_fin: S.semana.fecha_fin, p_tareas: payloadFilas() });
    S.guardadoAt = r.guardado_at;
    if (avisar) toast('Borrador guardado.');
  } catch (e) {
    S.pendiente = true;
    toast(`No se guardó el borrador: ${e.message}`, true);
  } finally {
    S.guardando = false; marcarEstadoGuardado();
    if (S.pendiente) { clearTimeout(S.timer); S.timer = setTimeout(() => guardarBorrador(), CONFIG.esperaGuardado * 2); }
  }
}
async function guardarSiHaceFalta() {
  if (S.semana && S.semana.estado === 'borrador' && S.pendiente) await guardarBorrador();
}
window.addEventListener('pagehide', () => { if (S.pendiente) guardarBorrador(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S.pendiente) guardarBorrador(); });

function copiarFila(f, fecha) {
  return { ...f, uid: uid(), fecha };
}
function reemplazarVacias(fecha, nuevas) {
  const llenas = S.filas.filter((f) => f.fecha === fecha && filaConDatos(f));
  S.filas = S.filas.filter((f) => f.fecha !== fecha).concat(llenas, nuevas);
  completarDia(S.filas, fecha);
  ordenarFilas();
}
function copiarDiaAnterior() {
  const dias = diasSemana();
  const origen = S.filas.filter((f) => f.fecha === dias[S.dia - 1] && filaConDatos(f));
  if (!origen.length) return toast('El día anterior no tiene tareas para copiar.');
  reemplazarVacias(dias[S.dia], origen.map((f) => copiarFila(f, dias[S.dia])));
  cambioBorrador(); vistaBorrador();
  toast(`Se copiaron ${origen.length} ${origen.length === 1 ? 'tarea' : 'tareas'}. Ajustá lo que cambie.`);
}
async function copiarADias() {
  const dias = diasSemana();
  const actual = dias[S.dia];
  const origen = S.filas.filter((f) => f.fecha === actual && filaConDatos(f));
  if (!origen.length) return toast('Este día todavía no tiene tareas para copiar.');
  const otros = dias.filter((d) => d !== actual);
  const r = await dialogo({
    titulo: `Copiar las tareas del ${nombreDia(actual).toLowerCase()}`,
    cuerpo: `<p>Se agregan a los días que elijas, sin borrar lo que ya tengan.</p>
      <div class="opcion-lista">${otros.map((d) => `<label><input type="checkbox" name="d" value="${d}" checked> ${nombreDia(d)}</label>`).join('')}</div>`,
    ok: 'Copiar'
  });
  if (!r) return;
  const elegidos = r.getAll('d');
  if (!elegidos.length) return;
  elegidos.forEach((d) => reemplazarVacias(d, origen.map((f) => copiarFila(f, d))));
  cambioBorrador(); vistaBorrador();
  toast(`Tareas copiadas a ${elegidos.length} ${elegidos.length === 1 ? 'día' : 'días'}.`);
}
async function copiarSemana() {
  let semanas = S.semanas;
  if (!semanas.length) {
    try { semanas = S.semanas = await rpc('cargar_mis_semanas', { p_correo: correo() }); } catch (e) { return toast(e.message, true); }
  }
  const previas = semanas.filter((s) => s.fecha_inicio !== S.semana.fecha_inicio && s.tareas > 0);
  if (!previas.length) return toast('No hay semanas anteriores para copiar.');
  const r = await dialogo({
    titulo: 'Copiar una semana anterior',
    cuerpo: `<p>Las tareas se agregan día por día (el lunes al lunes, el martes al martes…), sin borrar lo que ya cargaste.</p>
      <div class="opcion-lista">${previas.map((s, i) => `<label><input type="radio" name="s" value="${i}" ${i === 0 ? 'checked' : ''}>
        <span>${ddmm(s.fecha_inicio)} al ${ddmm(s.fecha_fin)}<small>${s.tareas} tareas · ${fmtH(s.horas)}${s.origen === 'excel' ? ' · cargada por Excel' : ''}</small></span></label>`).join('')}</div>`,
    ok: 'Copiar semana'
  });
  if (!r) return;
  const s = previas[Number(r.get('s'))];
  try {
    const sem = await rpc('cargar_semana', { p_correo: correo(), p_inicio: s.fecha_inicio, p_fin: s.fecha_fin });
    const dias = diasSemana();
    const porDia = {};
    (sem.tareas || []).filter((t) => !t.no_planificada && t.fecha).forEach((t) => {
      const offset = Math.round((aFecha(t.fecha) - aFecha(lunesDe(t.fecha))) / 86400000);
      const destino = sumarDias(lunesDe(S.semana.fecha_inicio), offset);
      if (!dias.includes(destino)) return;
      (porDia[destino] = porDia[destino] || []).push({
        uid: uid(), fecha: destino, accion_id: t.accion_id ? String(t.accion_id) : '', detalle: t.detalle || '',
        prioridad: t.prioridad || '', horas: t.horas_planificadas ?? t.horas ?? '', recursos: t.recursos || '', riesgos: t.riesgos || '',
        abierta: !!((t.recursos || '').trim() || (t.riesgos || '').trim())
      });
    });
    let total = 0;
    Object.entries(porDia).forEach(([d, lista]) => { reemplazarVacias(d, lista); total += lista.length; });
    if (!total) return toast('Esa semana no tiene tareas que coincidan con los días elegidos.');
    cambioBorrador(); vistaBorrador();
    const sinAccion = Object.values(porDia).flat().filter((f) => !f.accion_id).length;
    toast(`Se copiaron ${total} tareas.${sinAccion ? ` ${sinAccion} no tienen acción: elegila antes de confirmar.` : ''}`);
  } catch (e) { toast(e.message, true); }
}
async function confirmarSemana() {
  const conAccion = S.filas.filter((f) => f.accion_id);
  const sinAccion = S.filas.filter((f) => !f.accion_id && filaConDatos(f));
  const malas = conAccion.filter((f) => { const h = num(f.horas); return Number.isNaN(h) || h < 0; });
  if (malas.length) {
    const f = malas[0];
    S.dia = diasSemana().indexOf(f.fecha); vistaBorrador(f.uid);
    return toast('Hay horas que no son un número válido. Usá, por ejemplo, 1,5.', true);
  }
  if (!conAccion.length) return toast('Elegí la acción de al menos una tarea antes de confirmar.', true);
  const r = await dialogo({
    titulo: 'Confirmar la planificación',
    cuerpo: `<p>Vas a confirmar <strong>${conAccion.length} ${conAccion.length === 1 ? 'tarea' : 'tareas'}</strong> por <strong>${fmtH(horasDe(conAccion))}</strong> para la semana del ${ddmm(S.semana.fecha_inicio)} al ${ddmm(S.semana.fecha_fin)}.</p>
      <p>Después vas a poder agregar tareas no planificadas y cambiar la importancia, pero no modificar ni quitar estas tareas.</p>
      ${sinAccion.length ? `<p class="error-texto">${sinAccion.length} ${sinAccion.length === 1 ? 'tarea tiene' : 'tareas tienen'} datos pero no tienen acción, y no se van a guardar.</p>` : ''}`,
    ok: 'Confirmar planificación'
  });
  if (!r) return;
  clearTimeout(S.timer);
  try {
    cargando('Confirmando la planificación…');
    await rpc('cargar_confirmar', { p_correo: correo(), p_inicio: S.semana.fecha_inicio, p_fin: S.semana.fecha_fin, p_tareas: payloadFilas() });
    S.pendiente = false;
    S.semanas = [];
    toast('Planificación confirmada.');
    await abrirSemana(S.semana.fecha_inicio, S.semana.fecha_fin);
  } catch (e) {
    vistaBorrador();
    toast(e.message, true);
  }
}

/* ---------- cumplimiento ---------- */
const ESCALA = [['0', '0%'], ['25', '25%'], ['50', '50%'], ['75', '75%'], ['100', '100%'], ['reprogramada', 'Reprogramada']];
function pesoTarea(t) { return Number(t.horas_planificadas) || Number(t.horas_reales) || 1; }
function cumplimientoDe(lista) {
  const ev = lista.filter((t) => t.cumplimiento && t.cumplimiento !== 'reprogramada');
  if (!ev.length) return null;
  const peso = ev.reduce((s, t) => s + pesoTarea(t), 0);
  return Math.round(ev.reduce((s, t) => s + Number(t.cumplimiento) * pesoTarea(t), 0) / peso);
}
function chipPct(p) {
  if (p === null) return '<span class="pct" style="background:var(--gris-chip)">—</span>';
  const [bg, fg] = p < 25 ? ['var(--rojo)', '#fff'] : p < 50 ? ['var(--naranja)', 'var(--tinta)'] : p < 75 ? ['var(--amarillo)', 'var(--tinta)'] : ['var(--verde)', '#fff'];
  return `<span class="pct" style="background:${bg};color:${fg}">${p}%</span>`;
}
function diasCumplimiento() {
  const dias = rango(S.semana.fecha_inicio, S.semana.fecha_fin);
  (S.semana.tareas || []).forEach((t) => { if (t.fecha && !dias.includes(t.fecha)) dias.push(t.fecha); });
  dias.sort();
  return dias;
}
function filaCumplimientoHtml(t) {
  const accion = t.accion ? `<strong>${esc(t.accion)}</strong>` : '<strong class="sin">Sin acción asignada</strong>';
  return `
  <article class="tarjeta cumpl-fila" data-id="${t.id}" aria-label="${esc(t.accion || 'Tarea')}: ${esc(t.detalle || '')}">
    <div class="cumpl-cab">
      <div class="que">
        <div>${accion}${t.no_planificada ? '<span class="chip chip-np">No planificada</span>' : ''}</div>
        ${t.detalle ? `<span class="detalle">${esc(t.detalle)}</span>` : ''}
      </div>
      <div class="cumpl-datos">
        <label class="campo f-imp">Importancia
          <select class="in" data-cumpl="prioridad">${opcionesImportancia(t.prioridad)}</select>
        </label>
        <div class="campo plan"><span>Planificadas</span><span>${t.horas_planificadas !== null ? fmtH(Number(t.horas_planificadas)) : '—'}</span></div>
        <label class="campo f-horas">Reales
          <input class="in" type="text" inputmode="decimal" data-cumpl="horas_reales" value="${t.horas_reales !== null && t.horas_reales !== undefined ? String(Number(t.horas_reales)).replace('.', ',') : ''}" placeholder="—" autocomplete="off">
        </label>
      </div>
    </div>
    <fieldset class="escala">
      <legend>Cumplimiento</legend>
      <div class="ops">${ESCALA.map(([v, l]) => `<button type="button" class="op" data-accion="cumpl" data-v="${v}" aria-pressed="${t.cumplimiento === v}">${l}</button>`).join('')}</div>
    </fieldset>
  </article>`;
}
function formularioNoPlanificada() {
  return `
  <form class="tarjeta np-form" data-form="no-planificada" novalidate>
    <h3>Tarea no planificada</h3>
    <div class="fila-principal">
      <label class="campo">Acción<select class="in" name="accion" required>${opcionesAcciones('')}</select></label>
      <label class="campo" style="flex:2 1 220px">Detalle<input class="in" name="detalle" type="text" placeholder="Obra, cliente o aclaración" maxlength="300"></label>
    </div>
    <div class="fila-principal">
      <label class="campo">Importancia<select class="in" name="prioridad">${opcionesImportancia('')}</select></label>
      <label class="campo">Horas reales<input class="in" name="horas" type="text" inputmode="decimal" placeholder="0" autocomplete="off"></label>
      <label class="campo">Cumplimiento<select class="in" name="cumplimiento"><option value="">Sin informar</option>${ESCALA.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    </div>
    <p class="error-texto" data-error hidden></p>
    <div class="herramientas">
      <button type="submit" class="btn btn-p">Agregar tarea</button>
      <button type="button" class="btn" data-accion="cerrar-np">Cancelar</button>
    </div>
  </form>`;
}
function vistaCumplimiento() {
  const sem = S.semana;
  const tareas = sem.tareas || [];
  const dias = diasCumplimiento();
  if (S.dia >= dias.length) S.dia = 0;
  const dia = dias[S.dia];
  const delDia = tareas.filter((t) => t.fecha === dia);
  const plan = tareas.reduce((s, t) => s + (Number(t.horas_planificadas) || 0), 0);
  const reales = tareas.reduce((s, t) => s + (Number(t.horas_reales) || 0), 0);
  const sinEval = tareas.filter((t) => !t.cumplimiento).length;
  const np = tareas.filter((t) => t.no_planificada);
  const c = cumplimientoDe(tareas);
  const chip = sem.origen === 'excel' ? 'Cargada por Excel' : sem.confirmada_at ? `Confirmada el ${fechaHora(sem.confirmada_at)}` : 'Confirmada';
  const hoy = hoyIso();
  marco(`
  <main class="contenido">
    <div class="encabezado">
      <div class="titulo">
        <div><h1>Semana del ${ddmm(sem.fecha_inicio)} al ${ddmm(sem.fecha_fin)}</h1><span class="chip chip-curso">${esc(chip)}</span></div>
        <span class="sub">Cargá las horas reales y cuánto se cumplió de cada tarea. Los cambios se guardan solos.</span>
      </div>
    </div>
    <div class="resumen">
      <div class="tarjeta"><span class="t">Horas planificadas</span><span class="v">${fmtH(plan)}</span><span class="n">De ${fmtH(Number(S.sesion.jornada_horas) || 44)} semanales</span></div>
      <div class="tarjeta"><span class="t">Horas reales</span><span class="v">${fmtH(reales)}</span><span class="n">Cargadas hasta ahora</span></div>
      <div class="tarjeta"><span class="t">Cumplimiento</span><span class="v">${c === null ? '—' : c + '%'}</span><span class="n">Ponderado por horas, sobre lo evaluado</span></div>
      <div class="tarjeta"><span class="t">Sin evaluar</span><span class="v">${sinEval} ${sinEval === 1 ? 'tarea' : 'tareas'}</span><span class="n">Quedan vacías si no se completan</span></div>
      <div class="tarjeta"><span class="t">No planificadas</span><span class="v">${np.length} ${np.length === 1 ? 'tarea' : 'tareas'}</span><span class="n">${fmtH(np.reduce((s, t) => s + (Number(t.horas_reales) || 0), 0))} agregadas</span></div>
    </div>
    <div class="layout">
      <nav class="tarjeta dias" aria-label="Días de la semana">
        ${dias.map((d, i) => {
          const l = tareas.filter((t) => t.fecha === d);
          const ev = l.filter((t) => t.cumplimiento).length;
          return `<button type="button" class="dia" data-accion="dia" data-i="${i}" aria-current="${i === S.dia}">
            <span class="nombre"><span>${window.innerWidth <= 760 ? cortoDia(d) : nombreDia(d)}</span>${chipPct(cumplimientoDe(l))}</span>
            <span class="res">${l.length ? `${ev} de ${l.length} evaluadas` : 'Sin tareas'}</span></button>`;
        }).join('')}
      </nav>
      <section class="panel" aria-labelledby="t-dia">
        <div class="panel-cab">
          <h2 id="t-dia">${nombreDia(dia)}</h2>
          <span>Planificado <strong>${fmtH(delDia.reduce((s, t) => s + (Number(t.horas_planificadas) || 0), 0))}</strong> · Real <strong>${fmtH(delDia.reduce((s, t) => s + (Number(t.horas_reales) || 0), 0))}</strong></span>
        </div>
        ${delDia.length ? delDia.map(filaCumplimientoHtml).join('') : '<p class="tarjeta" style="padding:16px;color:var(--tenue)">No hay tareas planificadas para este día.</p>'}
        ${S.npAbierto ? formularioNoPlanificada() : `<div class="herramientas"><button type="button" class="btn btn-linea" data-accion="abrir-np" ${dia > hoy ? 'title="Podés agregarla aunque el día no haya llegado"' : ''}>+ Agregar tarea no planificada</button></div>`}
        <p class="nota-fija">La acción, el detalle y las horas planificadas no se pueden cambiar después de confirmar.</p>
      </section>
    </div>
  </main>`, 'semanas');
  if (S.npAbierto) { const s = $app.querySelector('[data-form="no-planificada"] select'); if (s) s.focus(); }
}
async function guardarCumplimiento(id, cambios) {
  const t = S.semana.tareas.find((x) => x.id === id);
  if (!t) return;
  const antes = { prioridad: t.prioridad, horas_reales: t.horas_reales, cumplimiento: t.cumplimiento };
  Object.assign(t, cambios);
  try {
    await rpc('cargar_actualizar_tarea', {
      p_correo: correo(), p_id: id, p_prioridad: t.prioridad || null,
      p_horas_reales: t.horas_reales === '' || t.horas_reales === undefined ? null : t.horas_reales,
      p_cumplimiento: t.cumplimiento || null
    });
    return true;
  } catch (e) {
    Object.assign(t, antes);
    toast(`No se guardó: ${e.message}`, true);
    vistaCumplimiento();
    return false;
  }
}
async function agregarNoPlanificada(form) {
  const err = form.querySelector('[data-error]');
  const mostrar = (m) => { err.textContent = m; err.hidden = false; };
  if (!form.elements.accion.value) return mostrar('Elegí la acción de la tarea.');
  const h = num(form.elements.horas.value);
  if (Number.isNaN(h) || (h !== null && h < 0)) return mostrar('Las horas reales tienen que ser un número, por ejemplo 0,5.');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await rpc('cargar_agregar_no_planificada', {
      p_correo: correo(), p_fecha: diasCumplimiento()[S.dia], p_accion_id: Number(form.elements.accion.value),
      p_detalle: form.elements.detalle.value.trim() || null, p_prioridad: form.elements.prioridad.value || null,
      p_horas_reales: h, p_cumplimiento: form.elements.cumplimiento.value || null
    });
    S.npAbierto = false;
    toast('Tarea no planificada agregada.');
    await abrirSemana(S.semana.fecha_inicio, S.semana.fecha_fin, true);
  } catch (e) {
    btn.disabled = false;
    mostrar(e.message);
  }
}

/* ---------- usuarios (administrador) ---------- */
function claveAdmin() { try { return sessionStorage.getItem(CLAVE_ADMIN); } catch { return null; } }
async function vistaUsuarios(error = '') {
  const clave = claveAdmin();
  if (!clave && !error) return pedirClaveAdmin();
  cargando('Cargando usuarios…');
  try {
    S.admin.usuarios = await rpc('cargar_admin_usuarios', { p_correo: correo(), p_clave: clave });
  } catch (e) {
    try { sessionStorage.removeItem(CLAVE_ADMIN); } catch { /* nada */ }
    return pedirClaveAdmin(e.message);
  }
  pintarUsuarios();
}
function pedirClaveAdmin(error = '') {
  marco(`
  <main>
    <form class="tarjeta ingreso" data-form="clave-admin" novalidate>
      <div style="display:flex;flex-direction:column;gap:8px">
        <h1>Usuarios</h1>
        <p style="color:var(--tenue)">Para administrar usuarios, ingresá la clave de carga del informe.</p>
      </div>
      <label class="campo grande">Clave de carga
        <input class="in" type="password" name="clave" autocomplete="current-password" ${error ? 'aria-invalid="true"' : ''}>
      </label>
      ${error ? `<p class="error-texto">${esc(error)}</p>` : ''}
      <button type="submit" class="btn btn-p" style="min-height:48px">Continuar</button>
    </form>
  </main>`, 'usuarios');
  const i = $app.querySelector('input[name=clave]'); if (i) i.focus();
}
function usuariosFiltrados() {
  const a = S.admin;
  const q = a.texto.trim().toLowerCase();
  return (a.usuarios || []).filter((u) =>
    (!q || (u.nombre || '').toLowerCase().includes(q) || (u.correo || '').toLowerCase().includes(q)) &&
    (!a.tipo || u.tipo === a.tipo) &&
    (a.estado === 'todos' || (a.estado === 'activos' ? u.activo : !u.activo)));
}
function filasUsuarios() {
  const lista = usuariosFiltrados();
  if (!lista.length) return '<tr><td colspan="5" style="color:var(--tenue);padding:16px 12px">No hay usuarios con esos filtros.</td></tr>';
  return lista.map((u) => `<tr>
    <td class="nombre">${esc(u.nombre)}${u.es_admin ? ' <span class="chip chip-borrador" style="font-size:12px">Administrador</span>' : ''}</td>
    <td>${esc(u.tipo || '—')}</td>
    <td class="correo">${esc(u.correo || 'Sin correo')}</td>
    <td><span class="chip ${u.activo ? 'chip-cerrada' : 'chip-curso'}" style="font-size:12px">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
    <td class="acciones"><button type="button" class="btn-texto" data-accion="editar-usuario" data-id="${u.id}">Editar</button></td>
  </tr>`).join('');
}
function pintarUsuarios() {
  const us = S.admin.usuarios || [];
  const act = us.filter((u) => u.activo);
  const g = act.filter((u) => u.tipo === 'Gestión').length, p = act.filter((u) => u.tipo === 'Producción').length;
  marco(`
  <main class="contenido">
    <div class="titulo" style="display:flex;flex-direction:column;gap:6px">
      <h1 style="font-size:24px">Usuarios</h1>
      <span style="font-size:14px;color:var(--tenue)">${act.length} usuarios activos · ${g} de Gestión y ${p} de Producción.</span>
    </div>
    <div class="layout">
      <section class="tarjeta usuarios-lista" aria-label="Lista de usuarios">
        <div class="filtros">
          <label class="campo">Buscar<input class="in" type="search" data-filtro="texto" value="${esc(S.admin.texto)}" placeholder="Nombre o correo"></label>
          <label class="campo">Tipo<select class="in" data-filtro="tipo">
            ${[['', 'Todos'], ['Gestión', 'Gestión'], ['Producción', 'Producción']].map(([v, l]) => `<option value="${v}" ${S.admin.tipo === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
          <label class="campo">Estado<select class="in" data-filtro="estado">
            ${[['activos', 'Activos'], ['inactivos', 'Inactivos'], ['todos', 'Todos']].map(([v, l]) => `<option value="${v}" ${S.admin.estado === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
        </div>
        <div class="tabla-caja">
          <table>
            <thead><tr><th scope="col">Nombre y apellido</th><th scope="col">Tipo</th><th scope="col">Correo</th><th scope="col">Estado</th><th scope="col"><span class="sr">Acciones</span></th></tr></thead>
            <tbody data-tbody>${filasUsuarios()}</tbody>
          </table>
        </div>
      </section>
      <form class="tarjeta usuario-form" data-form="nuevo-usuario" novalidate aria-labelledby="t-nuevo">
        <h2 id="t-nuevo">Agregar usuario</h2>
        <label class="campo grande">Nombre y apellido<input class="in" name="nombre" type="text" autocomplete="off" required></label>
        <label class="campo grande">Correo<input class="in" name="correo" type="email" inputmode="email" autocomplete="off" required></label>
        <label class="campo grande">Tipo<select class="in" name="tipo" required><option value="">Elegí el tipo</option><option>Gestión</option><option>Producción</option></select></label>
        <p class="error-texto" data-error hidden></p>
        <button type="submit" class="btn btn-p" style="min-height:46px">Agregar usuario</button>
        <p class="nota">Si un correo de sector pasa a otra persona, desactivá el usuario anterior y agregá uno nuevo con el mismo correo. Así el historial queda asignado a quien lo cargó.</p>
      </form>
    </div>
  </main>`, 'usuarios');
}
async function guardarUsuario(datos) {
  await rpc('cargar_admin_guardar_usuario', {
    p_correo: correo(), p_clave: claveAdmin(), p_id: datos.id || null, p_nombre: datos.nombre,
    p_correo_usuario: datos.correo, p_tipo: datos.tipo, p_activo: datos.activo
  });
}
async function nuevoUsuario(form) {
  const err = form.querySelector('[data-error]');
  const mostrar = (m) => { err.textContent = m; err.hidden = false; };
  const d = { nombre: form.elements.nombre.value.trim(), correo: form.elements.correo.value.trim(), tipo: form.elements.tipo.value, activo: true };
  if (!d.nombre) return mostrar('Escribí el nombre y apellido.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.correo)) return mostrar('El correo no parece válido.');
  if (!d.tipo) return mostrar('Elegí el tipo.');
  try {
    await guardarUsuario(d);
    toast('Usuario agregado.');
    await vistaUsuarios();
  } catch (e) { mostrar(e.message); }
}
async function editarUsuario(id) {
  const u = (S.admin.usuarios || []).find((x) => x.id === id);
  if (!u) return;
  const propio = u.correo && S.sesion.correo && u.correo.toLowerCase() === S.sesion.correo.toLowerCase();
  const r = await dialogo({
    titulo: `Editar a ${u.nombre}`,
    cuerpo: `
      <label class="campo grande">Nombre y apellido<input class="in" name="nombre" type="text" value="${esc(u.nombre)}" required></label>
      <label class="campo grande">Correo<input class="in" name="correo" type="email" value="${esc(u.correo || '')}" required></label>
      <label class="campo grande">Tipo<select class="in" name="tipo">${['Gestión', 'Producción'].map((t) => `<option ${u.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="activo" ${u.activo ? 'checked' : ''} ${propio ? 'disabled' : ''}> Usuario activo</label>
      ${propio ? '<p class="ayuda">No podés desactivar tu propio usuario.</p>' : ''}`,
    ok: 'Guardar cambios'
  });
  if (!r) return;
  try {
    await guardarUsuario({ id: u.id, nombre: String(r.get('nombre') || '').trim(), correo: String(r.get('correo') || '').trim(),
      tipo: r.get('tipo'), activo: propio ? true : r.get('activo') === 'on' });
    toast('Cambios guardados.');
    await vistaUsuarios();
  } catch (e) { toast(e.message, true); }
}

/* ---------- diálogo genérico ---------- */
function dialogo({ titulo, cuerpo, ok = 'Aceptar', cancelar = 'Cancelar' }) {
  return new Promise((resolver) => {
    const d = document.createElement('dialog');
    d.className = 'dialogo';
    d.innerHTML = `<form method="dialog"><h2>${esc(titulo)}</h2><div class="cuerpo">${cuerpo}</div>
      <div class="botones"><button type="button" class="btn" value="no">${esc(cancelar)}</button><button type="submit" class="btn btn-p" value="si">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d);
    const form = d.querySelector('form');
    let resultado = null;
    form.addEventListener('submit', (e) => { e.preventDefault(); resultado = new FormData(form); d.close(); });
    form.querySelector('button[value=no]').addEventListener('click', () => d.close());
    d.addEventListener('close', () => { d.remove(); resolver(resultado); });
    d.showModal();
  });
}

/* ---------- eventos ---------- */
$app.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const tipo = f.dataset.form;
  if (tipo === 'ingreso') ingresar(f);
  else if (tipo === 'semana') entrarSemana(f);
  else if (tipo === 'no-planificada') agregarNoPlanificada(f);
  else if (tipo === 'nuevo-usuario') nuevoUsuario(f);
  else if (tipo === 'clave-admin') {
    try { sessionStorage.setItem(CLAVE_ADMIN, f.elements.clave.value); } catch { /* nada */ }
    vistaUsuarios();
  }
});

$app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.campo) {
    const fila = el.closest('[data-uid]');
    const f = fila && S.filas.find((x) => x.uid === fila.dataset.uid);
    if (!f) return;
    f[el.dataset.campo] = el.value;
    if (el.dataset.campo === 'horas') {
      const h = num(el.value);
      el.setAttribute('aria-invalid', Number.isNaN(h) || (h !== null && h < 0) ? 'true' : 'false');
    }
    actualizarTotales();
    cambioBorrador();
  } else if (el.dataset.filtro) {
    S.admin[el.dataset.filtro] = el.value;
    const tb = $app.querySelector('[data-tbody]'); if (tb) tb.innerHTML = filasUsuarios();
  } else if (el.name === 'inicio' && el.form && el.form.dataset.form === 'semana' && el.value) {
    el.form.elements.fin.value = sumarDias(el.value, 4);
    el.form.elements.fin.min = el.value;
  }
});

$app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.campo === 'accion_id') {
    const fila = el.closest('[data-uid]');
    const ay = fila && fila.querySelector('[data-ayuda]');
    if (ay) ay.textContent = descAccion(el.value);
  }
  if (el.dataset.cumpl) {
    const card = el.closest('[data-id]');
    if (!card) return;
    if (el.dataset.cumpl === 'prioridad') {
      guardarCumplimiento(card.dataset.id, { prioridad: el.value || null });
    } else if (el.dataset.cumpl === 'horas_reales') {
      const h = num(el.value);
      if (Number.isNaN(h) || (h !== null && h < 0)) {
        el.setAttribute('aria-invalid', 'true');
        return toast('Las horas reales tienen que ser un número, por ejemplo 1,5.', true);
      }
      el.setAttribute('aria-invalid', 'false');
      guardarCumplimiento(card.dataset.id, { horas_reales: h }).then((ok) => { if (ok) refrescarResumen(el); });
    }
  }
});
function refrescarResumen(origen) {
  const activo = origen || document.activeElement;
  const card = activo && activo.closest ? activo.closest('[data-id]') : null;
  const id = card ? card.dataset.id : null;
  const sel = activo && activo.dataset ? (activo.dataset.cumpl ? `[data-cumpl="${activo.dataset.cumpl}"]` : activo.dataset.v !== undefined ? `.op[data-v="${activo.dataset.v}"]` : null) : null;
  const y = window.scrollY;
  vistaCumplimiento();
  window.scrollTo({ top: y });
  if (id && sel) { const el = $app.querySelector(`[data-id="${id}"] ${sel}`); if (el) el.focus({ preventScroll: true }); }
}

$app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-accion]');
  if (!b) return;
  const a = b.dataset.accion;
  const fila = b.closest('[data-uid]');
  switch (a) {
    case 'salir': await guardarSiHaceFalta(); cerrarSesion(); break;
    case 'reintentar': render(); break;
    case 'aviso-mas-tarde': S.avisoOculto = true; b.closest('.aviso').remove(); break;
    case 'dia':
      S.dia = Number(b.dataset.i); S.npAbierto = false;
      if (S.semana.estado === 'borrador') vistaBorrador(); else vistaCumplimiento();
      window.scrollTo({ top: 0 });
      break;
    case 'agregar-fila': {
      const f = filaVacia(diasSemana()[S.dia]);
      const idx = S.filas.map((x) => x.fecha).lastIndexOf(f.fecha);
      S.filas.splice(idx + 1, 0, f);
      vistaBorrador(f.uid);
      break;
    }
    case 'quitar-fila': {
      const f = S.filas.find((x) => x.uid === fila.dataset.uid);
      S.filas = S.filas.filter((x) => x !== f);
      if (!S.filas.some((x) => x.fecha === f.fecha)) S.filas.push(filaVacia(f.fecha));
      ordenarFilas();
      if (filaConDatos(f)) cambioBorrador();
      vistaBorrador();
      break;
    }
    case 'abrir-opcionales': {
      const f = S.filas.find((x) => x.uid === fila.dataset.uid);
      f.abierta = true; vistaBorrador();
      const i = $app.querySelector(`[data-uid="${f.uid}"] [data-campo="recursos"]`); if (i) i.focus();
      break;
    }
    case 'copiar-dia-anterior': copiarDiaAnterior(); break;
    case 'copiar-a-dias': copiarADias(); break;
    case 'copiar-semana': copiarSemana(); break;
    case 'guardar-borrador': guardarBorrador(true); break;
    case 'confirmar': confirmarSemana(); break;
    case 'cumpl': {
      const card = b.closest('[data-id]');
      const t = S.semana.tareas.find((x) => x.id === card.dataset.id);
      const nuevo = t.cumplimiento === b.dataset.v ? null : b.dataset.v;
      card.querySelectorAll('.op').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.v === nuevo)));
      if (await guardarCumplimiento(card.dataset.id, { cumplimiento: nuevo })) refrescarResumen(b);
      break;
    }
    case 'abrir-np': S.npAbierto = true; vistaCumplimiento(); break;
    case 'cerrar-np': S.npAbierto = false; vistaCumplimiento(); break;
    case 'editar-usuario': editarUsuario(b.dataset.id); break;
  }
});

/* ---------- inicio ---------- */
(async function iniciar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  S.sesion = leerSesion();
  if (S.sesion) {
    // Se revalida en segundo plano: si el correo fue desactivado, se cierra la sesión.
    rpc('cargar_ingresar', { p_correo: S.sesion.correo })
      .then((p) => { const cambio = p.es_admin !== S.sesion.es_admin || p.nombre !== S.sesion.nombre; guardarSesion(p); if (cambio) render(); })
      .catch((e) => { if (/no está habilitado/.test(e.message)) { cerrarSesion(); toast(e.message, true); } });
    if (!location.hash || location.hash === '#/') { location.hash = '#/semanas'; return; }
  }
  render();
})();
