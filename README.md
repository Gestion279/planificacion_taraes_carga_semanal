# Carga semanal

Aplicación para que cada persona cargue su planificación semanal y el cumplimiento de sus tareas. Es independiente del informe de gerencia: tiene su propio enlace y no muestra ni enlaza el informe.

- **Arquitectura:** GitHub → Vercel (sitio estático + una función) → Supabase (la misma base que el informe).
- **No requiere compilar nada.** Son archivos HTML, CSS y JavaScript que Vercel publica tal cual.

## Puesta en marcha

### 1. Supabase (ya está hecho)

La base `planificacion_tareas` ya tiene las tablas y funciones del módulo (ver `docs/CARGA_SEMANAL.md` en el repositorio del informe). No hay que hacer nada.

### 2. GitHub

1. Crear un repositorio nuevo, privado (por ejemplo `carga_semanal`).
2. Subir **el contenido** de esta carpeta, de modo que `index.html` quede en la raíz.
   Desde la web: *Add file → Upload files* y arrastrar todos los archivos y carpetas.

### 3. Vercel

1. *Add New → Project* e importar el repositorio nuevo.
2. **Framework Preset:** `Other`. Sin comando de build ni carpeta de salida.
3. **Project Name:** el que defina la dirección, por ejemplo `carga-semanal-fabrica` → `carga-semanal-fabrica.vercel.app`.
4. En **Environment Variables**, las mismas dos variables que el informe:

   | Nombre | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://ozusksrrariroqejasvb.supabase.co` |
   | `SUPABASE_ANON_KEY` | la clave publishable (`sb_publishable_…`) |

5. **Deploy.**

## Uso

- **Ingreso:** cada persona escribe su correo. Si no está habilitado, el administrador lo agrega en **Usuarios** (pide la clave de carga del informe).
- **Celular:** abrir el enlace y elegir *Agregar a pantalla de inicio*. Queda como la app **Carga semanal**.
- **Ciclo:** planificar la semana (idealmente los jueves) y confirmarla. Después se pueden agregar tareas no planificadas y cambiar la importancia. Al cierre, cargar horas reales y cumplimiento.
