# SWRP — Contexto del Proyecto

> **Propósito de este documento:** referencia técnica y funcional **estática** de la aplicación Star Wars Roleplay Game (SWRP). Describe qué contiene la app, cómo está organizada y cómo funciona cada parte. **No es un changelog** — al implementar cambios, actualizar aquí el estado resultante del sistema, no el historial de commits.

---

## 1. Visión general

SWRP es una aplicación web de rol Star Wars:

- **Frontend:** HTML5, CSS3 (tema sci-fi/neon), JavaScript ES modules, Bootstrap 5. Todo el código de cliente vive en `public/`.
- **Backend:** Firebase Authentication (email/contraseña) + Cloud Firestore. Sin servidor propio.
- **Hosting:** Firebase Hosting con `cleanUrls: true`. En GitHub Pages la app puede estar bajo `/swrp/public/` (ver `app-path.js` y `swrp-base-init.js`).
- **Assets multimedia:** retratos, mapas VTT y portadas de partida son **URLs externas** (no Firebase Storage).
- **Datos de juego:** semilla en `game-data.js` (generado desde xlsx); overrides editables en Firestore `compendium/data`.

**Proyecto Firebase:** `swrp-f623e`

**Normas de juego:** `RULES.md` (referencia obligatoria para mecánicas).

---

## 2. Desarrollo y despliegue

### Requisitos
Node.js v18+, conexión a Internet (Firebase en la nube).

### Comandos

```bash
cd c:\dev\SWRP
npm install              # primera vez
npm run serve            # http://localhost:3000 — sirve public/
npm run build            # regenera game-data.js desde xlsx (si cambian datos)
firebase deploy --only firestore:rules
firebase deploy --only hosting
```

### URLs limpias
Usar siempre `appUrl()` (`js/app-path.js`) para enlaces internos. Evitar `party.html?id=…` — al redirigir con cleanUrls se pierde el query string.

---

## 3. Rutas y páginas

| Ruta | Archivo | Descripción |
|------|---------|-------------|
| `/` o `/index` | `index.html` | Login |
| `/register` | `register.html` | Registro |
| `/dashboard` | `dashboard.html` | Personajes del usuario + listado de partidas |
| `/admin` | `admin.html` | Otorgar/quitar rol Admin (solo admins) |
| `/character-create` | `character-create.html` | Crear/editar personaje o NPC |
| `/character-view?id=…` | `character-view.html` | Ver carta de personaje |
| `/party?id=…` | `party.html` | Partida: unión, foro narrativo, dados |
| `/board?party=…` | `board.html` | Tablero táctico VTT |
| `/map-editor` | `map-editor.html` | Editor de escaramuzas (plantillas reutilizables) |
| `/compendium` | `compendium.html` | Stats, habilidades, especies, NPCs, tableros VTT |
| `/rules` | `rules.html` | Reglas renderizadas desde `RULES.md` |

Query params habituales:
- `party?id=` — ID de partida (`party-url.js`)
- `board?party=` — ID de partida en tablero
- `character-view?id=` / `character-create?char=` / `?npc=` — personajes
- `map-editor?template=` — editar plantilla propia
- `map-editor?fork=` — copiar plantilla ajena como nueva
- `map-editor?new=1` — nueva escaramuza

---

## 4. Estructura del repositorio

```
SWRP/
├── RULES.md
├── CONTEXT.md              ← este fichero
├── estadisticas.xlsx
├── habilidades.xlsx
├── npcs.xlsx
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── storage.rules           # legacy
├── scripts/
│   ├── parse-xlsx.js
│   └── build-game-data.js
└── public/
    ├── *.html              # vistas (ver tabla anterior)
    ├── css/
    │   ├── theme.css       # tema global, foro, tablero, tarjetas, dificultad
    │   └── character-card.css
    ├── js/                 # módulos ES (ver §10)
    ├── data/
    └── img/
```

---

## 5. Roles y permisos

### Administrador global (`users.rol_global === 'Admin'`)
- Bootstrap automático: `cracktopro@gmail.com` recibe Admin al registrarse o si no existía su doc de usuario.
- Crear, editar y eliminar **partidas personalizadas** (Campaña o Escaramuza sin plantilla).
- CRUD de NPCs en Firestore, compendio, panel `/admin`.
- Nav: enlace **Opciones** → `/admin`.

### Usuario normal (`rol_global: 'User'`)
- CRUD de sus personajes (`characters/`).
- Ver todas las partidas; unirse y participar.
- Crear **instancias** de escaramuza desde plantillas predefinidas (modal Dashboard → Partidas predefinidas).
- Crear y editar **plantillas** propias en Editor de mapas (`escaramuzaTemplates/`).
- No puede crear campañas personalizadas ni editar partidas de admin (salvo slots/spawns como GM — ver §8.3).

### Dentro de una partida (`parties/{id}/members/{uid}`)

| `playMode` | Comportamiento |
|------------|----------------|
| `gm` | Control narrativo y tablero; puede actuar como cualquier personaje unido; un solo GM por partida |
| `character` | Juega con personaje propio del jugador |
| `npc` | Juega con un NPC del compendio |

El GM puede tener `characterId` (personaje propio) o `npcId` (NPC elegido como representación en tablero).

---

## 6. Tipos de partida

### Campaña (`type: 'Campaña'`)
- Flujo clásico: foro narrativo en `/party`, tablero opcional.
- `phase: 'narrative'` por defecto.
- Creación solo por **admin** (modal Partida personalizada).

### Escaramuza (`type: 'Escaramuza'`)
Encuentro táctico corto. Dos orígenes:

#### A) Desde plantilla (`templateId` presente)
- Cualquier usuario autenticado la crea desde Dashboard → **Partidas predefinidas**.
- Se copian: nombre, era, dificultad, imagen, descripción, `minPlayers`, `maxSlots`, `allySpawns`, layout del tablero.
- Creador entra como **GM** (figura en mesa opcional: personaje, NPC o ninguna); redirección directa al tablero en escaramuzas predefinidas.
- Otros jugadores se unen con **personaje propio** o **NPC del compendio** (no como GM); plazas limitadas por `maxSlots` si hay config de slots.
- Spawns aliados colocan automáticamente el token al unirse.

#### B) Personalizada admin (`templateId` ausente)
- Admin crea desde Dashboard → Partida personalizada → tipo Escaramuza.
- Sin `minPlayers` / `maxSlots` / `allySpawns` inicialmente.
- El **GM** configura jugadores y spawns en tablero → Opciones → **Jugadores y spawns** (persiste en doc `parties/{id}`).
- Hasta que no hay config completa (mín, máx, spawns ≥ mín), las tarjetas **no muestran** el rango «N - M jugadores».

---

## 7. Sistema de dificultad (escaramuzas)

Definido en `escaramuza-templates.js` → `ESCARAMUZA_DIFFICULTIES`:

| ID | Etiqueta | Subtítulo | Color base |
|----|----------|-----------|------------|
| `padawan` | Padawan | Fácil | `#39ff14` |
| `jedi` | Jedi | Normal | `#00e5ff` |
| `caballero` | Caballero Jedi | Difícil | `#b24bf3` |
| `maestro` | Maestro Jedi | Muy Difícil | `#ff4a1a` |

- Campo obligatorio en plantillas del editor y en partidas creadas/editadas por admin.
- Tarjetas: borde izquierdo + degradado en cuerpo; línea `Dificultad: <nombre>` con color mezclado hacia blanco.
- Fallback visual si falta en datos antiguos: `jedi` (Normal).

Helpers clave: `readDifficulty`, `resolveDifficulty`, `buildDifficultyCardHtml`, `applyDifficultyCardStyle`, `hasEscaramuzaSlotConfig`, `buildPlayerRangeHtml`.

---

## 8. Funcionalidad por área

### 8.1 Dashboard (`dashboard.html` + `dashboard.js`)

**Panel Personajes (izquierda)**
- Selector desplegable + vista previa de carta (`renderCharacterPanel`).
- Crear, editar, eliminar personajes propios.

**Panel Partidas (derecha)**
- Pestañas: **Campañas** | **Escaramuzas** (filtro por `party.type`).
- Filtros: nombre, era.
- Tarjetas (`renderPartyCard`): imagen, tipo, era, dificultad, rango de jugadores (si aplica), lista de unidos, descripción, Entrar/Unirse/Opciones(admin).
- Admin: **+ Partida** abre modal Nueva Partida.

**Modal Nueva Partida**
- Pestañas ampliadas (`swrp-dashboard-tabs`).
- **Partida personalizada** (solo admin): nombre, tipo, era, dificultad, imagen URL, descripción. El creador **siempre es GM**; opcionalmente elige figura en mesa (sin personaje, personaje propio o NPC).
- **Partidas predefinidas** (todos): el creador **siempre es GM** de la escaramuza. Opcionalmente elige figura en mesa (sin personaje, personaje propio o NPC). Luego:
  1. Título **Escaramuzas Predefinidas** + filtros nombre, era, dificultad (`filterEscaramuzaTemplates`).
  2. Lista de plantillas (`renderTemplatePickCard`) — clic para seleccionar.
  3. Botón **Crear escaramuza** → `createEscaramuzaFromTemplate` → tablero.
- Quien se une después a una escaramuza predefinida puede hacerlo con **personaje propio** o **NPC** (no como GM).

**Modal Opciones de partida** (admin): editar metadatos incl. dificultad.

**Carga de partidas del usuario:** `users.joinedPartyIds` + migración lazy desde `members/{uid}` (no usa `collectionGroup`).

### 8.2 Editor de mapas (`map-editor.html` + `map-editor-page.js`)

- Lista: pestañas **Mis escaramuzas** | **Escaramuzas de la comunidad**.
- Editar ajena → `?fork=id` → guardar crea copia nueva.
- Workspace: metadatos (nombre, era, dificultad, imagen, descripción), mín/máx jugadores, spawns aliados, tablero con enemigos, **cajas de loot**, botín de enemigos y **objetivos** (misma UI que el tablero: pestaña «Objetos» en enemigos, botón «+ Caja»; pestaña «Objetivos» para reglas/misiones/pistas).
- Validación al guardar: al menos 1 enemigo, spawns ≥ mínimo jugadores, dificultad obligatoria.
- `boardLayout` guarda enemigos, cofres, **objetivos** y configuración de loot (sin estado de partida: sin `resolved`, `creditShares` ni `creditsClaimedBy`).
- Persistencia: colección `escaramuzaTemplates/{id}`.

### 8.3 Tablero VTT (`board.html` + `board.js`, `board-page.js`, `board-combat.js`, `board-progress.js`, `board-vision.js`)

**Acceso:** miembro de la partida. Escaramuza oculta enlace al foro; entra directo al tablero.

**Sidebar:** pestañas Combate | Log | **Objetivos** (todos los jugadores) | Opciones (solo GM).

**Escenarios** (`board-scenarios.js`): barra de pestañas sobre el tablero (Escenario 1 por defecto, botón **+** solo GM). Cada escenario es un tablero independiente (mapa, grid, tokens, cofres, objetivos, biblioteca NPC neutral, combate). Mapa y dimensiones de cuadrícula son **por escenario** (se persisten al cambiar URL/mapas o grid y al cambiar de pestaña). Índice en `state/scenarios` (`activeScenarioId`, `items[]` con `name`, `visibleToPlayers`). El GM puede ocultar escenarios a jugadores; los jugadores solo ven y pueden cambiar a pestañas marcadas como visibles. En **Control de chapa → En juego**, el GM puede **mover una chapa a otro escenario** conservando HP, stats, diálogos, botín, etc. Misma UI en **Editor de mapas**; las plantillas guardan `scenarios[]` + `activeScenarioId` (y `boardLayout` del escenario activo por compatibilidad).

**Objetivos** (`board-objectives.js`): lista de entradas con título opcional y texto (reglas, misiones, pistas). Visible para jugadores y GM; solo el GM puede agregar, editar y eliminar. Sincronización en tiempo real vía `state/board.objectives`. En plantillas de escaramuza se guardan en `boardLayout.objectives` y se importan al crear una partida desde la plantilla.

**Opciones GM:**
- Progreso: guardar/cargar snapshots completos del estado (`board-progress.js`), incluyendo cofres, botín resuelto, créditos pendientes, `token.loot`, `neutralNpcPresets` y **todos los escenarios** (`scenarioBoards` + índice `scenarios` en cada guardado `state/progress_*`).
- Mapa URL, tamaño de cuadrícula (4–48 columnas, 4–999 filas; celda fija 48 px). Spawns de aliados solo visibles en **Escenario 1**.
- Cargar tablero predefinido del compendio (opcional) o pegar URL manual.
- Chapas en juego: añadir personajes/NPCs, **NPC neutral** (pestaña con formulario General/Objetos y biblioteca **NPCs Neutrales** guardada en el estado del tablero al colocar), control modal (stats, HP, facción, visión, diálogos).
- **Jugadores y spawns** (solo escaramuza sin `templateId`): mín/máx, lista de spawns, modal minitablero (`escaramuza-spawns-ui.js` → `savePartyEscaramuzaSlots`).
- **Control de NPC aliados** (solo escaramuza, GM): panel en Opciones para asignar cada NPC aliado en mesa a un jugador unido (`npc-control.js` → `parties/{id}.npcControlAssignments`). En escaramuzas el jugador solo controla su personaje; el GM controla enemigos. Los NPC aliados asignados entran en el orden de turnos con `userId` del jugador asignado, que puede moverlos/atacarlos cuando sea su turno.

**Combate:**
- Fase narrativa con turnos (2 acciones: movimiento hasta 6 casillas / atacar) antes y durante combate.
- Iniciativa D20, orden de turnos, log estructurado.
- Visión enemiga: conos, estados alerta (`board-vision.js`). Cada jugador/GM puede mostrar u ocultar los conos con el interruptor junto al título del tablero (preferencia en `localStorage`). Con los conos ocultos, al pasar el cursor sobre un enemigo se muestra su cono en amarillo.
- **NPC neutral** (`side: 'neutral'`): badge amarillo; el GM define diálogos en Control de chapa → pestaña Diálogos. Jugador adyacente (o GM) ve botón «Hablar» y cicla los textos estilo RPG junto a la chapa (`board-neutral-npc-form.js`).
- Sincronización en tiempo real vía `parties/{id}/state/board`.

**Spawns en partida:** `assignSpawnToMember` coloca token aliado en celda según orden de unión si `hasEscaramuzaSlotConfig`.

### 8.4 Partida / Foro (`party.html` + `party-page.js`, `party.js`, `party-markup.js`)

- Pantalla de unión si no es miembro (modos según tipo de partida).
- Escaramuza predefinida: personaje propio o NPC al unirse.
- Escaramuza custom: personaje, NPC o GM (si no hay GM).
- Foro en tiempo real: posts narrativos y tiradas de dados.
- Markup: `[img]`, `[C]color[/C]`, `@` menciones (solo personajes unidos).
- Panel «Mi participación»: cambiar rol/personaje.

### 8.5 Personajes y NPCs

- **Personajes** (`characters/`): héroes del jugador; creador en `character-create.html`.
- **NPCs** (`npcs/`): solo admin; sin campo nivel; stats editables; usados en tablero, compendio y escaramuzas.
- Cartas: `character-card.js` + `character-card.css` (temas por clase).
- Selector reutilizable: `npc-picker.js` (`initCharacterPicker`, `initNpcPicker`) — filas estilo tarjeta con thumb, clase, especie, nivel.

### 8.6 Compendio (`compendium.html` + `compendium-page.js`, `compendium-store.js`)

- Progresión 1–20, habilidades por clase, especies.
- Pestañas: Progresión, Habilidades, Especies, NPCs, **Tableros** (mapas VTT reutilizables, solo admin edita), **Objetos**.
- **Habilidades → Otros:** catálogo de habilidades personalizadas creadas para NPCs (Activa/Pasiva; nombre y descripción). No forman parte de las clases de juego.
- **Objetos** (`compendium/data.items`, solo admin edita): catálogo de objetos para inventarios. Filtros en la pestaña: **nombre**, **tipo** y **clase** (equipo equipable por esa clase o por todas). Campos: nombre, descripción, imagen (URL del icono), tipo, **peso (KG)** y precio de venta. Por tipo:
  - **Equipo:** ocupa la ranura especial del inventario (solo uno equipado). Sube una estadística (HP/Defensa/Ataque/Daño/Fuerza) en `statBonus` mientras esté equipado. Define además **`equipClass`** (clase que puede equiparlo; `'all'` = todas, sin contar «Otros») y **`equipLevel`** (nivel mínimo 1–20); el inventario solo permite equiparlo si el personaje cumple ambos requisitos.
  - **Consumible:** se usa en partida, desaparece y aplica un efecto (estadística + aumento). `temporary: true` → el efecto se revierte al **Finalizar combate**; `false` → permanente. Una cura (HP) nunca supera el máximo del personaje. **Estadística «Ninguna» (`stat: 'none'`):** consumible sin efecto mecánico (llaves, piezas, etc.); solo se gasta y se registra (uso narrativo/rol).
  - **Sin utilidad:** solo se puede vender.
- Galería NPC con filtros.
- Admin: CRUD completo; no admin: solo lectura.

### 8.6.1 Sistema de inventario (`inventory.js`, `inventory-modal.js`)

- Ligado a **personajes de usuario**; el botón de inventario (pill con el color de la clase, abajo-derecha del retrato) aparece en la carta. Se accede desde el foro (Campaña, `party-page.js`) y desde el tablero (Campaña y **Escaramuza**) en la carta del personaje propio.
- Modal con dos pestañas (**Inventario** y **Tienda**): rejilla **4×8 (32 casillas)**, ranura de **Equipo** aparte, **créditos** encima de la barra de **peso** (icono `icons/creditos.svg`, por defecto 0) con aviso de sobrecarga.
- **Tienda:** lista todo el catálogo de objetos con filtros por **nombre, tipo y clase**; permite **vender** los objetos que se poseen (también disponible desde la pestaña Inventario).
- **Peso máximo por clase (KG):** Guardián Jedi / Guerrero Sith 10 · Cónsul Jedi / Inquisidor Sith 8 · Soldado / Contrabandista 15 · Especialista Técnico / Cazarrecompensas 20 · Noble 12 (`CLASS_MAX_WEIGHT`).
- **Agrupación:** objetos del mismo tipo comparten casilla (con contador), pero el peso suma por unidad.
- **Penalización de movimiento (tablero):** normal 6 casillas; si supera el peso máximo → 3; si además la rejilla está llena (32) → 1. El token guarda `moveRange` (recalculado al colocarlo y al cambiar el inventario en partida).
- **Equipo:** suma su `statBonus` a la estadística (en la carta vía `resolveCharacterStats` y en las stats de combate del token).
- **Consumibles:** «Usar» elimina 1 unidad. Cura (HP) sube `currentHp`/HP del token hasta el máximo. No-HP permanente → `statBonuses` del personaje; no-HP temporal → se aplica al token y se registra en `token.tempEffects`, revertido en `endCombat` (board.js). Los consumibles **sin efecto** («Ninguna») se usan en foro o tablero.
- **Acceso desde el tablero:** la carta del personaje propio (Campaña o Escaramuza) muestra el botón de inventario; al **usar** un objeto allí se registra en el log de combate `«Personaje» ha utilizado el objeto «X»` (`logEntryItemUse` / `board.logItemUse`, tipo de log `item`).
- **Vender:** elige cantidad si hay varias; suma `precio × cantidad` a los créditos y descuenta del inventario.
- **Conceder (GM):** panel «Conceder a jugadores» (pestaña Opciones del tablero, `board-grant-panel.js`) para otorgar créditos u objetos del compendio a un personaje de la partida (`grantCreditsToCharacter` / `grantItemToCharacter` en `inventory.js`; recalcula el `moveRange` del token).

### 8.6.2 Sistema de loot (`loot.js`, `loot-modal.js`, `board.js`, `board-page.js`)

- Disponible **solo en el tablero** (Campaña y Escaramuza). Dos fuentes de botín: **enemigos derrotados** y **cajas**.
- **Botín común (`loot`)** en enemigos (`token.loot`) y cajas (`chest.loot`): `{ credits, items: [{ itemId, prob }], creditShares, creditsClaimedBy, resolved }`.
  - `prob` es un nivel **1-5** → porcentaje (1=5 %, 5=100 %, lineal: `LOOT_PROB_PCT = {1:5,2:29,3:53,4:76,5:100}`).
  - `resolved`: lista `[{ itemId, qty }]` que se calcula **una sola vez** (al primer saqueo) tirando cada objeto por su probabilidad (`resolveLoot`); se persiste para que todos vean lo mismo.
- **Configuración (GM):**
  - **Enemigo:** pestaña **«Objetos»** del modal de control de chapa (solo enemigos): créditos + lista de objetos.
  - **Caja:** botón **«+ Caja»** (junto a «+ Añadir») abre un modal con minimapa (`MiniBoardPicker`) y URL de miniatura para colocarla; **clic izquierdo** sobre la caja la edita (imagen, créditos, objetos, eliminar).
  - Añadir objeto: modal compartido `lootItemModal` con filtros **nombre, tipo, clase** y selector de **probabilidad** (1-5). Editar configuración resetea `resolved` (se vuelve a tirar al siguiente saqueo).
- **Saqueo (jugador):**
  - **Enemigo:** debe estar **derrotado** y el jugador en una de las **4 celdas ortogonales** (`isCellAdjacentToUser`); en la carta del enemigo aparece el botón **«Saquear»**.
  - **Caja:** clic en la caja estando en una celda contigua → modal de saqueo.
  - El modal (`loot-modal.js`) muestra los objetos resueltos; **«Coger»** los pasa al inventario del personaje (`grantItemToCharacter`, respeta límite de casillas) y los retira del botín, dejando el resto para otros jugadores. Cada recogida se registra en el log (tipo `loot`).
- **Créditos:** en el **primer saqueo** (cualquier jugador) se calculan las partes (`creditShares`: `{ [characterId]: cantidad }`) dividiendo el total entre los jugadores de la partida. **Cada jugador recibe su parte solo cuando él saquea** (abre el modal estando adyacente): una escritura a su personaje + una al botín (`creditsClaimedBy`). No hay cola global ni escrituras automáticas al cargar el tablero.
- La capa de cajas se dibuja en `#board-chest-layer` (`renderChestLayer`); las cajas vacías se atenúan.

### 8.5.1 Habilidades custom en NPCs (`character-creator.js`)

- Al crear/editar NPC (admin), además de las habilidades de su clase (máx. 4 + Rol):
  - Pestañas **General** y **Objetos** (botín por defecto: créditos + objetos con probabilidad, misma UI que el tablero).
  - El botín del compendio se copia al colocar el NPC en el tablero (`tokenFromNpc`); el GM puede editarlo por partida sin alterar el NPC del compendio.
  - **Origen «Otros»** en el selector de habilidades: reutilizar personalizadas ya guardadas en el compendio.
  - **Formulario «Nueva habilidad custom»:** tipo Activa o Pasiva, nombre y descripción; se selecciona al añadir y se persiste en `compendium/data.skills.Otros` al guardar el NPC.
- En la carta (`character-card.js`) se renderizan con el mismo estilo que las habilidades de clase.
- Los NPCs siguen guardando `skills: [skillId, ...]` (IDs de clase u `otros-…` del compendio).

### 8.7 Administración (`admin.html` + `admin.js`)

- Listado de usuarios; toggle `rol_global` Admin/User.

---

## 9. Modelo de datos Firestore

### `users/{uid}`
```js
{
  username, email,
  rol_global: 'User' | 'Admin',
  joinedPartyIds: [partyId, ...],
  createdAt
}
```

### `characters/{id}`
```js
{
  userId, name, species, class, classKey, level, type: 'Heroe',
  hp, maxHp, defense, attack, damage, force,
  skills: [skillId, ...],
  portraitUrl, era?,
  activePartyId?,  // enlace a partida activa
  // Inventario (solo personajes de usuario):
  credits: number,                          // por defecto 0
  inventory: [{ itemId, qty }, ...],        // agrupado por objeto; máx. 32 casillas
  equippedItemId?: string | null,           // ranura de Equipo (uno)
  statBonuses?: { [stat]: number },         // bonos permanentes de consumibles
  currentHp?,
  createdAt, updatedAt
}
```

### `npcs/{id}`
```js
{
  name, species, class, classKey, type: 'NPC', era?,
  hp, maxHp, defense, attack, damage, force,
  skills: [skillId, ...],
  portraitUrl / image,
  loot?: { credits, items: [{ itemId, prob }] },  // botín por defecto (plantilla)
  createdBy, createdAt, updatedAt
}
```

### `compendium/data`
```js
{
  progression: { [classKey]: { [n]: { hp, defense, attack, damage, force } } },
  skills: {
    [classKey]: [{ id, name, type, unlockLevel, description, class, forceCost }, ...],
    Otros: [{ id, name, type: 'Activa'|'Pasiva', description, class: 'Otros', unlockLevel: 1, custom: true }, ...]
  },
  species: ['Humanos', ...],
  boards: [{ id, name, mapUrl, cols, rows, cellWidth, cellHeight }],
  items: [{
    id, name, description, imageUrl,
    type: 'Equipo' | 'Consumible' | 'Sin utilidad',
    weight,           // KG
    price,            // créditos de venta
    stat?, statBonus?,        // Equipo y Consumible
    temporary?,               // solo Consumible
    equipClass?, equipLevel?  // solo Equipo ('all'|claseKey · nivel 1-20)
  }, ...],
  seedVersion: number,
  updatedAt
}
```

### `escaramuzaTemplates/{templateId}`
```js
{
  creatorId, creatorUsername,
  name, imageUrl, description, era, difficulty,
  minPlayers, maxSlots,
  allySpawns: [{ col, row }, ...],
  boardLayout: { ... },      // escenario activo (compatibilidad)
  activeScenarioId?: string,
  scenarios?: [{
    id, name, visibleToPlayers, order,
    boardLayout: { tokens, chests, objectives, mapUrl, grid, neutralNpcPresets }
  }],
  createdAt, updatedAt
}
```

### `parties/{partyId}/state/scenarios`
```js
{
  activeScenarioId: 'scenario_1',
  items: [{ id, name, visibleToPlayers, order }],
  updatedAt
}
```

### `parties/{partyId}/state/{scenarioId}`
Misma forma que `state/board` (snapshot del escenario cuando no está activo).

### `parties/{partyId}`
```js
{
  name,
  type: 'Campaña' | 'Escaramuza',
  era, difficulty,           // dificultad obligatoria en partidas nuevas/editadas
  imageUrl, description,
  status: 'active',
  phase: 'narrative' | 'board' | ...,
  // Escaramuza desde plantilla:
  templateId?, createdBy?, creatorUsername?,
  minPlayers?, maxSlots?, allySpawns?,
  npcControlAssignments?: { [userId: string]: string[] },  // escaramuza: sourceId de NPC aliados por jugador
  createdAt, updatedAt
}
```

### `parties/{partyId}/members/{userId}`
```js
{
  userId, username,
  playMode: 'gm' | 'character' | 'npc',
  characterId, npcId,       // según modo
  characterSnapshot,
  joinedAt, updatedAt
}
```

### `parties/{partyId}/posts/{postId}`
```js
{
  type: 'narrative' | 'dice',
  authorId, content,
  roll?, rollLabel?,
  characterSnapshot?,
  createdAt
}
```

### `parties/{partyId}/state/board`
```js
{
  mapUrl,
  grid: { cols, rows, cellWidth, cellHeight },
  tokens: [{
    id, sourceId, kind: 'character' | 'npc',
    name, class, theme, color,
    level?,  // solo personajes jugador, no NPC
    side: 'ally' | 'enemy' | 'neutral',
    dialogues?: string[],  // solo NPC neutral
    col, row, facing?, portraitUrl,
    hp, maxHp, defense, ...
    moveRange?,          // casillas/acción según peso del inventario (personajes)
    tempEffects?,        // [{ stat, amount }] efectos temporales de consumibles
    loot?,               // botín: { credits, items, creditShares, creditsClaimedBy, resolved }
    alerted?, spawnCol?, spawnRow?
  }],
  chests: [{             // cajas de loot
    id, col, row, imageUrl, opened?,
    loot: { credits, items, creditShares, creditsClaimedBy, resolved }
  }],
  objectives: [{ id, title?, text }],  // reglas / misiones / pistas (GM edita)
  neutralNpcPresets: [{ presetId, name, classKey, species, era, portraitUrl, hp, skills, loot, ... }],
  combatStarted: boolean,
  log: [...],
  initiativeLog: [...],
  initiativeOpen: boolean,
  turnOrder: [...],
  turnOrderIndex: number,
  activeTurn: string | null,
  turnActions: { movesUsed, attacksUsed, activeMode, bonusMoves, bonusAttacks },
  updatedAt
}
```

---

## 10. Reglas Firestore (resumen)

| Recurso | Lectura | Escritura |
|---------|---------|-----------|
| `users` | Autenticados | Propietario; Admin actualiza roles |
| `characters` | Autenticados | Propietario; GM de partida puede editar personaje de miembro |
| `npcs` | Autenticados | Solo Admin |
| `compendium` | Autenticados | Solo Admin |
| `escaramuzaTemplates` | Autenticados | Crear cualquiera; update/delete solo `creatorId` |
| `parties` | Autenticados | Create: Admin **o** escaramuza con `templateId`+`createdBy`; Update: Admin **o** GM slots en escaramuza sin plantilla; Delete: Admin |
| `parties/.../members` | Autenticados | Usuario crea el suyo; update propio o GM; delete propio, GM o Admin |
| `parties/.../posts` | Miembros | Miembros (`authorId` = uid) |
| `parties/.../state` | Miembros | Cualquier miembro (tablero colaborativo) |

Funciones auxiliares en reglas: `isAdmin`, `isPartyMember`, `isPartyGM`, `isEscaramuzaPartyCreate`, `isEscaramuzaGmSlotUpdate`, `isEscaramuzaGmNpcControlUpdate`.

---

## 11. Módulos JavaScript (`public/js/`)

| Módulo | Responsabilidad |
|--------|-----------------|
| `firebase-config.js` | Init Firebase, exports Firestore helpers |
| `auth.js` | Login, registro, perfil, bootstrap admin |
| `app-path.js` | `appUrl()`, rutas base, fix GitHub Pages |
| `swrp-base-init.js` | Redirect rutas mal formadas al cargar |
| `navbar.js` | Nav global con enlaces según rol |
| `dashboard.js` | CRUD partidas (admin), tarjetas, filtros, personajes panel |
| `characters.js` | CRUD personajes Firestore |
| `character-creator.js` | Formulario crear/editar héroe o NPC |
| `character-card.js` | Render carta, temas de clase, normalización |
| `character-url.js` | URLs de personaje |
| `npcs.js` | CRUD NPC, eras, filtros, `npcToCardData` |
| `npc-picker.js` | Selectores tarjeta personaje/NPC |
| `party.js` | Carga partida, posts, tiradas foro |
| `party-page.js` | UI partida: join, rol, foro |
| `party-members.js` | Membresía, roster, tokens, `joinParty` |
| `party-markup.js` | Parser `[img]`, `[C]`, `@` |
| `party-url.js` | URLs partida/tablero, `rememberPartyId` |
| `escaramuza-templates.js` | Plantillas, dificultad, crear instancia, tarjetas pick/list |
| `escaramuza-spawns-ui.js` | UI spawns en tablero y editor |
| `npc-control.js` | Panel GM: asignar NPC aliados en mesa a jugadores (escaramuza) |
| `map-editor-page.js` | Vista editor de mapas |
| `board.js` | `TacticalBoard`, grid, tokens, persistencia |
| `board-page.js` | UI GM: añadir/controlar chapas, `MiniBoardPicker` |
| `board-neutral-npc-form.js` | Formulario NPC neutral en modal «Añadir al tablero»; biblioteca en `state/board.neutralNpcPresets` |
| `board-grid-panel.js` | Panel GM cuadrícula y carga de tableros del compendio |
| `board-combat.js` | Turnos, iniciativa, dados en tablero |
| `board-progress.js` | Guardados de progreso del tablero |
| `board-scenarios.js` | Pestañas de escenarios (tablero y editor de mapas) |
| `board-objectives.js` | Pestaña Objetivos: reglas/misiones/pistas (lectura jugadores, edición GM) |
| `board-vision.js` | Conos visión, normalización tokens |
| `compendium-store.js` | Carga/merge compendio, stats, clases, objetos |
| `compendium-page.js` | UI compendio (incl. pestaña Objetos) |
| `inventory.js` | Lógica inventario: peso/clase, slots, moveRange, equipo, consumibles, persistencia, conceder GM |
| `inventory-modal.js` | Modal inventario (pestañas Inventario/Tienda, rejilla 4×8, créditos, equipar, vender, usar) |
| `board-grant-panel.js` | Panel GM (tablero) para otorgar créditos/objetos a personajes |
| `loot.js` | Lógica de loot: probabilidades 1-5, normalización, tirada, reparto de créditos |
| `loot-modal.js` | Modal de saqueo (jugador): coger objetos, reparto de créditos |
| `loot-editor-ui.js` | UI compartida para editar listas de botín y modal de elección de objetos |
| `dice.js` | Utilidades tiradas |
| `token-stats-editor.js` | Editor stats inline en modal chapa |
| `admin.js` | Panel admin usuarios |
| `assets.js` | Rutas logos |
| `swrp-dialog.js` | Modales confirmación/alerta |
| `rules-renderer.js` | Render `RULES.md` |
| `game-data.js` | Semilla generada (no editar a mano) |

---

## 12. Datos de juego y clases

### Pipeline xlsx
- `estadisticas.xlsx` → progresión por clase y nivel
- `habilidades.xlsx` → habilidades (desbloqueo niveles 1/5/10/15; máx. 4 + Rol)
- Habilidades **Otros** (NPC): solo en Firestore / UI admin; no vienen del xlsx.
- **Objetos** (`items`): solo en Firestore / UI admin; no vienen del xlsx.
- `npm run build` → `public/js/game-data.js`

### Clases y temas CSS (`theme-*`)

| Clave | Etiqueta | Color neón |
|-------|----------|------------|
| Jedi Guardian | Guardián Jedi | `#00e5ff` |
| Jedi Consul | Cónsul Jedi | `#39ff14` |
| Guerrero Sith | Guerrero Sith | `#ff1744` |
| Inquisidor Sith | Inquisidor Sith | `#c44dff` |
| Soldado | Soldado | `#ff0055` |
| Especialista Técnico | Especialista Técnico | `#ff3366` |
| Cazarrecompensas | Cazarrecompensas | `#ff9100` |
| Contrabandista | Contrabandista | `#b24bf3` |
| Noble | Noble | `#d4af37` |

Especies: lista en `compendium/data.species` (CRUD admin).

---

## 13. UI y convenciones

- **Tema:** `theme.css` — fondo oscuro, acentos dorados (`--swrp-gold`), neón por clase.
- **Botones:** clases `btn-swrp`, variantes `-primary`, `-ghost`, `-success`, `-danger`.
- **Paneles:** `swrp-panel`, títulos `swrp-panel__title`.
- **Tarjetas partida:** `swrp-party-card` + clases dificultad `swrp-difficulty-card--{id}`.
- **Cache bust CSS:** query `?v=…` en enlaces `theme.css` por página cuando cambia el tema.
- **Logos:** `img/Logo SW-RP.png` (favicon/nav), `img/StarWars Expanded RP Logo.png` (nav centro).

---

## 14. Flujos principales (diagrama)

```
Registro/Login → Dashboard
  ├─ Personajes → character-create / character-view
  └─ Partidas
       ├─ Campaña (admin crea) → party (foro) ⇄ board
       └─ Escaramuza
            ├─ Predefinida (plantilla) → board (GM creador)
            └─ Custom admin → party o board; GM configura slots/spawns en tablero

Editor mapas → escaramuzaTemplates → usadas en Dashboard (predefinidas)
```

---

## 15. Notas para desarrollo

- **Minimizar scope:** reutilizar `npc-picker`, `escaramuza-templates`, `appUrl`.
- **Partidas antiguas:** pueden carecer de `difficulty`, `era`, slots; el código aplica fallbacks visuales.
- **Índices Firestore:** no se usa `collectionGroup('members')`; `joinedPartyIds` evita índices compuestos.
- **Despliegue reglas:** tras cambiar `firestore.rules`, ejecutar `firebase deploy --only firestore:rules`.
- **Tests:** no hay suite automatizada actualmente.

---

## 16. Referencias de diseño

Cartas de referencia en `public/img/cards/` (Vic Harper, Adaya Kritt, Olu Mirr, Asuryan Tyr, Dak Besand).
