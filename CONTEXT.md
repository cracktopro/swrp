# SWRP — Contexto del Proyecto

> Manuscrito técnico y funcional de la aplicación web Star Wars Roleplay Game.
> **Mantener este fichero actualizado con cada cambio relevante** (modelo de datos, rutas, permisos, UI, comandos).

---

## Arrancar la app (desarrollo local)

**Requisitos:** Node.js (v18+ recomendado), conexión a Internet (Firebase en la nube).

```bash
cd c:\dev\SWRP
npm install          # solo la primera vez
npm run serve        # sirve public/ en http://localhost:3000
```

Abrir en el navegador: **http://localhost:3000**

| Ruta | Página |
|------|--------|
| `/` o `/index` | Login |
| `/register` | Registro |
| `/dashboard` | Dashboard (personajes + partidas) |
| `/admin` | Panel de administración (solo admins) |
| `/character-create` | Crear/editar personaje |
| `/character-view?id=…` | Ver carta de personaje |
| `/party?id=…` | Partida (foro + dados) |
| `/board?party=…` | Tablero táctico VTT |
| `/compendium` | Compendio de reglas/datos |

> **URLs limpias:** Firebase Hosting usa `cleanUrls: true`. En local, `serve` también resuelve rutas sin `.html`. Evitar enlaces del tipo `party.html?id=…` — pierden el query string al redirigir.

**Regenerar datos de juego** (solo si cambian los xlsx):

```bash
npm run build
```

**Despliegue a producción** (requiere [Firebase CLI](https://firebase.google.com/docs/cli) instalada y `firebase login`):

```bash
firebase deploy --only firestore:rules
firebase deploy --only hosting
```

**Proyecto Firebase:** `swrp-f623e`

---

## Resumen

Aplicación web de rol Star Wars con Firebase (Auth, Firestore, Hosting).
Frontend estático: HTML5, CSS3 (tema sci-fi/neon), JavaScript ES modules, Bootstrap 5.

---

## Stack

| Capa | Tecnología |
|------|------------|
| Frontend | HTML, CSS, JS (ES modules), Bootstrap 5 |
| Auth | Firebase Authentication (email/password) |
| BD | Cloud Firestore |
| Archivos | URL externa (retratos, mapas VTT, imágenes de tarjetas de partida) |
| Hosting | Firebase Hosting (`cleanUrls: true`) |
| Datos de juego | xlsx → `game-data.js` (semilla); overrides en Firestore `compendium/data` |

---

## Estructura de carpetas

```
SWRP/
├── RULES.md                 # Normas del juego (referencia obligatoria)
├── CONTEXT.md               # Este fichero
├── estadisticas.xlsx
├── habilidades.xlsx
├── npcs.xlsx
├── firebase.json
├── firestore.rules
├── firestore.indexes.json   # Exenciones de índice (opcional; ver nota abajo)
├── storage.rules            # Legacy; retratos/mapas ya no usan Storage
├── scripts/
│   ├── parse-xlsx.js
│   └── build-game-data.js
└── public/
    ├── index.html
    ├── register.html
    ├── dashboard.html
    ├── admin.html           # Panel admin (permisos de usuario)
    ├── character-create.html
    ├── character-view.html
    ├── party.html
    ├── board.html
    ├── compendium.html
    ├── css/
    │   ├── theme.css        # Tema global oscuro, foro, tablero, admin
    │   └── character-card.css
    ├── js/
    │   ├── firebase-config.js
    │   ├── auth.js          # Login, perfil, bootstrap admin
    │   ├── admin.js         # Panel otorgar/quitar Admin
    │   ├── navbar.js        # Nav con enlace "Opciones" solo admins
    │   ├── dashboard.js     # CRUD partidas (admin), personajes, tarjetas
    │   ├── characters.js
    │   ├── character-creator.js
    │   ├── character-card.js
    │   ├── character-url.js
    │   ├── party.js         # Foro, posts, tiradas
    │   ├── party-page.js    # UI partida: join, rol, foro
    │   ├── party-members.js # Membresía, roster, tokens
    │   ├── party-markup.js  # [img], [C], @mentions
    │   ├── party-url.js
    │   ├── board.js         # Tablero VTT
    │   ├── dice.js
    │   ├── assets.js        # Rutas logos
    │   └── game-data.js
    ├── data/
    └── img/
```

---

## Roles y permisos

### Administrador global (`rol_global: 'Admin'`)
- **Bootstrap:** la cuenta `cracktopro@gmail.com` recibe rol Admin al registrarse o al iniciar sesión (si el doc de usuario no existía, se crea automáticamente).
- **Puede:** crear, editar y eliminar partidas; otorgar/quitar Admin a otras cuentas desde `/admin`.
- **Nav:** enlace **Opciones** visible solo para admins.

### Usuario normal (`rol_global: 'User'`)
- Crear/editar/eliminar sus personajes.
- Ver todas las partidas; unirse y participar.
- No puede crear/editar/eliminar partidas ni gestionar admins.

### Dentro de una partida
- **Primera visita:** pantalla de unión — elegir **GM** o **personaje propio**.
- **Cambio en cualquier momento:** panel "Mi participación" en `party.html`.
- **Jugador (`playMode: 'character'`):** solo publica y tira dados con su personaje asignado.
- **GM (`playMode: 'gm'`):** narrativa situacional sin personaje; puede hablar/tirar como cualquier personaje unido; control total del tablero VTT.
- Solo **un GM** por partida.

---

## Modelo de datos (Firestore)

### `users/{uid}`
```js
{
  username, email,
  rol_global: 'User' | 'Admin',
  joinedPartyIds: [partyId, ...],   // cache local de partidas unidas
  createdAt
}
```

### `characters/{id}` (héroes del jugador)
```js
{
  userId, name, species, class, classKey, level, type: 'Heroe',
  hp, maxHp, currentHp, defense, attack, damage, force,
  skills: [skillId, ...],
  portraitUrl,
  createdAt, updatedAt
}
```

### `npcs/{id}` (admin; tablero y compendio)
```js
{
  name, species, class, classKey, level, type: 'NPC',
  hp, maxHp, defense, attack, damage, force,
  skills: [skillId, ...],
  portraitUrl, createdBy, createdAt, updatedAt
}
```

### `compendium/data` (overrides de stats/habilidades/especies; admin CRUD)
```js
{ progression: { ... }, skills: { ... }, species: ['Humanos', ...], seedVersion: 2, updatedAt }
```
Semilla inicial: `game-data.js` (`npm run build:data`). Si Firestore tiene `seedVersion` menor, al cargar se fusionan en memoria las clases derivadas (Guerrero Sith, Inquisidor Sith, Cazarrecompensas). Admin en `/compendium`: **Aplicar semilla a Firestore** (solo esas clases) o **Restaurar todo el compendio**.

### `parties/{id}`
```js
{
  name, type: 'Campaña' | 'Escaramuza',
  imageUrl,                          // URL portada tarjeta dashboard
  description,
  status: 'active',
  phase: 'narrative' | 'combat',
  createdAt, updatedAt
}
```
> Partidas antiguas pueden tener `gmId` / `playerIds` (legacy); el código actual usa la subcolección `members`.

### `parties/{id}/members/{userId}`
```js
{
  userId, username,
  playMode: 'gm' | 'character',
  characterId,                       // null si playMode === 'gm'
  characterSnapshot,                 // snapshot stats al unirse/cambiar
  joinedAt, updatedAt
}
```

### `parties/{id}/posts/{id}`
```js
{
  type: 'narrative' | 'dice',
  authorId,
  content,
  roll?, rollLabel?,                 // si type === 'dice'
  characterSnapshot?,                // null = narrativa situacional (GM)
  createdAt
}
```

### `parties/{id}/state/board`
```js
{
  mapUrl,                            // URL imagen de mapa (no Storage)
  tokens: [{
    id, sourceId, kind: 'character' | 'npc',
    name, level, class, theme, color, side: 'ally' | 'enemy',
    portraitUrl, col, row,
    facing: 'up' | 'down' | 'left' | 'right',  // enemigos
    alerted: false                               // enemigo vio a un aliado alguna vez
  }],
  combatStarted: false,
  grid: { cols: 24, rows: 16, cellSize: 48 },
  log: [{ time, type, actor, ... }],   // objetos estructurados; legacy: strings
  updatedAt
}
```

### Consulta de partidas del usuario
- **No usa** `collectionGroup('members')` (evita índice compuesto en Firestore).
- Lee `users/{uid}.joinedPartyIds`; si falta, migra en la primera carga del dashboard comprobando `members/{uid}` en cada partida.

---

## Reglas Firestore (`firestore.rules`)

| Recurso | Lectura | Escritura |
|---------|---------|-----------|
| `users` | Usuarios autenticados | Propietario; Admin puede cambiar roles |
| `characters` | Autenticados | Propietario |
| `npcs` | Autenticados | Solo Admin |
| `compendium` | Autenticados | Solo Admin |
| `parties` | Autenticados | Solo Admin (create/update/delete) |
| `parties/.../members` | Autenticados | Usuario crea el suyo; update propio o GM de partida |
| `parties/.../posts` | Miembros de partida | Miembros (authorId = uid) |
| `parties/.../state` | Miembros de partida | Miembros |

---

## Clases y temas visuales

| Clave xlsx | Etiqueta UI | Tema CSS | Color neón |
|------------|-------------|----------|------------|
| Jedi Guardian | Guardián Jedi | `theme-guardian` | `#00e5ff` |
| Jedi Consul | Cónsul Jedi | `theme-consul` | `#39ff14` |
| Guerrero Sith | Guerrero Sith | `theme-sith-guardian` | `#ff1744` |
| Inquisidor Sith | Inquisidor Sith | `theme-sith-consul` | `#c44dff` |
| Soldado | Soldado | `theme-soldado` | `#ff0055` |
| Especialista Técnico | Especialista Técnico | `theme-tecnico` | `#ff3366` |
| Cazarrecompensas | Cazarrecompensas | `theme-cazarrecompensas` | `#ff9100` |
| Contrabandista | Contrabandista | `theme-contrabandista` | `#b24bf3` |
| Noble | Noble | `theme-noble` | `#d4af37` |

**Especies** (select): lista en `compendium/data.species` (CRUD admin en compendio); fallback `GAME_DATA.SPECIES_LIST`.

**Badges de habilidad:** Rol → violeta pastel, Pasiva → amarillo pastel, Activa → rojo pastel.

Usados en: cartas de personaje, degradado de posts del foro, tokens del tablero.

---

## Datos de juego

### Progresión de estadísticas
- **Fuente:** `estadisticas.xlsx` (6 clases × 20 niveles)
- **Regenerar:** `npm run build`

### Habilidades
- **Fuente:** `habilidades.xlsx`
- Desbloqueo en niveles **1, 5, 10, 15** (máx. 4 combate); Rol siempre visible
- Reglas en `RULES.md`

### NPCs
- **Fuente:** `npcs.xlsx`
- Paleta del GM en tablero VTT (hasta 12 NPCs del compendio)

---

## Módulos implementados

### Módulo I — Autenticación y Dashboard ✅
- Login / Registro
- Perfil Firestore con auto-creación si falta doc de usuario
- Dashboard: selector + carta completa de personajes; editar/eliminar
- Listado de **todas** las partidas; botón Entrar/Unirse según membresía
- Admin: botón **+ Partida** y modal Opciones (editar partida) en tarjetas

### Módulo II — Creador y cartas ✅
- Pestañas **Personajes** / **NPCs** (NPC solo admin)
- NPCs: stats base de clase editables; guardados en `npcs/`
- Campo **especie** en formulario y carta
- 9 clases (incl. Sith y Cazarrecompensas)
- Stats/habilidades vía `compendium-store.js`

### Módulo III — Partidas (Foro + Dados) ✅
- Pantalla de **unión** (GM o personaje)
- Panel **Mi participación** (cambiar rol/personaje)
- Foro en tiempo real con markup: `[img]URL[/img]`, `[C]texto[/C]`, `@` menciones
- `@` solo lista personajes unidos (GM no aparece)
- Posts con degradado desaturado del color de clase (izquierda → transparente)
- GM: personaje activo seleccionable entre todos los unidos; jugador: solo el suyo
- Tiradas D20/D6 publicadas al foro con snapshot del personaje

### Módulo IV — Tablero VTT ✅
- Grid configurable (4–48); ejes A… / 1… en bordes exteriores; celdas 48px
- **Visión enemiga:** cono unificado (4 celdas, ancho 1→3→5→7), estilo glow; iconos de estado
- **GM:** panel «Chapas en juego» + modal control; botón «Añadir» con minitablero (estilo RPG Maker)
- Log de combate solo tras **Iniciar combate** (GM); entradas con [GM] dorado, actores en color de clase, celdas en cyan
- **Borrar historial** vacía el log (no reset de acciones)

### Módulo V — Compendio ✅
- Progresión 1–20, habilidades por clase, lista de especies
- Galería NPCs desde Firestore con filtros por nombre y clase
- Galería NPCs desde Firestore
- Admin: CRUD progresión (tabla editable), habilidades (+/editar/borrar), especies (+/editar/borrar), enlace crear NPC
- No admin: solo lectura en todas las pestañas (banner informativo)

### Administración ✅
- Página `/admin`: otorgar/quitar `rol_global: 'Admin'`
- Enlace **Opciones** en nav (solo admins)

---

## UI global

- Tema oscuro Star Wars (`theme.css`): inputs, modales, scrollbars personalizados
- Nav: logo SW-RP + logo expandido centrado; nombre de usuario
- Logos: `img/Logo SW-RP.png` (favicon/nav), `img/StarWars Expanded RP Logo.png` (nav centro)

---

## Pendiente / mejoras futuras

- [ ] Fase combate vs narrativa conmutables por GM
- [ ] Conos de luz / línea de visión en VTT
- [ ] Validación de prerequisitos entre habilidades
- [ ] Expulsar miembros de partida (GM)
- [ ] Sincronizar `joinedPartyIds` al abandonar partida
- [ ] Migración automática de partidas legacy (`gmId`/`playerIds`)
- [ ] PWA / notificaciones
- [ ] Tests automatizados

---

## Comandos útiles

```bash
npm install
npm run serve          # http://localhost:3000
npm run build          # Regenera JSON y game-data.js desde xlsx
firebase deploy --only firestore:rules
firebase deploy --only hosting
firebase deploy --only firestore:indexes   # opcional; ya no requerido por el código
```

### Despliegue Firebase (primera vez)
1. Authentication → **Email/Password** activado
2. Firestore creado (modo producción)
3. `firebase deploy --only firestore:rules`
4. `firebase deploy --only hosting`

> **Imágenes:** retratos, mapas VTT y portadas de partida usan URLs externas (ImgBB, ibb.co, etc.). No requiere Firebase Storage.

---

## Referencias de diseño

Cartas de referencia en `public/img/cards/` (Vic Harper, Adaya Kritt, Olu Mirr, Asuryan Tyr, Dak Besand).

---

## Historial de cambios

### 2025-06-21 — Personajes, NPCs, clases y compendio CRUD
- Pestañas Personajes/NPCs en creador; NPCs en Firestore (`npcs/`)
- 3 clases nuevas (Guerrero Sith, Inquisidor Sith, Cazarrecompensas) con habilidades propias (lore sith/caza; mismas mecánicas que sus homólogos)
- `compendium/data` + CRUD admin de stats, habilidades y especies
- Badges de tipo de habilidad con color; npcs.xlsx obsoleto

### 2025-06-21 — Tablero: log, grid, paleta
- Tooltip flotante (fix clip); NPCs con imagen correcta; ejes de celdas
- GM: tamaño de cuadrícula, pestañas+buscador en paleta
- Combate con `combatStarted`; log formateado; borrar historial

### 2025-06-21 — Tablero VTT ampliado
- Grid 24×16 (celdas 48px); chapas ocupan una celda con iniciales
- Mapa URL visible para todos; panel GM añadir/quitar tokens
- Clic en chapa abre carta; tooltip hover; drag con umbral anti-conflicto

### 2025-06-20 — Partidas, admin y tablero (sesión actual)
- Modelo de membresía: `parties/{id}/members/{userId}` con `playMode` gm/character
- Solo admins crean/editan/eliminan partidas; bootstrap admin `cracktopro@gmail.com`
- Panel admin en `/admin` (nav "Opciones"); eliminado del dashboard
- Unión a partida + cambio de rol/personaje en cualquier momento
- Foro: degradado por clase, `@` solo personajes unidos, markup narrativo
- Tablero: mapa URL, tokens badge, reset acciones, tablero vacío inicial
- `users.joinedPartyIds` en lugar de `collectionGroup('members')`
- `auth.js`: creación automática de perfil si falta doc Firestore
- Tarjetas de partida con `imageUrl` + `description` en dashboard
- URLs limpias sin `.html` para preservar query strings

### 2025-06-20 — Retratos por URL
- Creador: campo URL en lugar de Storage; `portraitUrl` en Firestore

### 2025-06-20 — Storage + layout carta
- `storage.rules` (legacy); layout carta sin solapamiento stats/retrato

### 2025-06-20 — Inicialización
- Estructura del proyecto, pipeline xlsx, módulos I–V base, `firestore.rules`
