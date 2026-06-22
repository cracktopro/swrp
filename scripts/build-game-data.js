const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const statsRaw = require(path.join(root, 'public/data/estadisticas.json')).Hoja1;
const skillsRaw = require(path.join(root, 'public/data/habilidades.json')).Hoja1;

const CLASS_META = {
  'Jedi Guardian': {
    id: 'jedi-guardian',
    label: 'Guardián Jedi',
    theme: 'guardian',
    color: '#00e5ff',
    hasForce: true
  },
  'Jedi Consul': {
    id: 'jedi-consul',
    label: 'Cónsul Jedi',
    theme: 'consul',
    color: '#39ff14',
    hasForce: true
  },
  'Guerrero Sith': {
    id: 'guerrero-sith',
    label: 'Guerrero Sith',
    theme: 'sith-guardian',
    color: '#ff1744',
    hasForce: true,
    homologue: 'Jedi Guardian'
  },
  'Inquisidor Sith': {
    id: 'inquisidor-sith',
    label: 'Inquisidor Sith',
    theme: 'sith-consul',
    color: '#c44dff',
    hasForce: true,
    homologue: 'Jedi Consul'
  },
  Soldado: {
    id: 'soldado',
    label: 'Soldado',
    theme: 'soldado',
    color: '#ff0055',
    hasForce: false
  },
  'Especialista Técnico': {
    id: 'especialista',
    label: 'Especialista Técnico',
    theme: 'tecnico',
    color: '#ff3366',
    hasForce: false
  },
  Cazarrecompensas: {
    id: 'cazarrecompensas',
    label: 'Cazarrecompensas',
    theme: 'cazarrecompensas',
    color: '#ff9100',
    hasForce: false
  },
  Contrabandista: {
    id: 'contrabandista',
    label: 'Contrabandista',
    theme: 'contrabandista',
    color: '#b24bf3',
    hasForce: false
  },
  Noble: {
    id: 'noble',
    label: 'Noble',
    theme: 'noble',
    color: '#d4af37',
    hasForce: false
  }
};

const SPECIES_LIST = [
  'Humanos',
  'Especie de Yoda',
  'Wookiees',
  "Twi'leks",
  'Togrutas',
  'Zabrak',
  'Mon Calamari',
  'Ewoks',
  'Sullustanos',
  'Hutts',
  'Trandoshanos',
  'Jawas',
  'Tusken',
  'Geonosianos',
  'Neimoidianos',
  'Kaminoanos',
  'Cereanos'
];

const SKILL_UNLOCK_LEVELS = [1, 5, 10, 15];
const MAX_SKILLS = 4;
/** Incrementar al cambiar habilidades/progresión de clases derivadas en build-game-data.js */
const COMPENDIUM_SEED_VERSION = 2;
const DERIVED_SEED_CLASSES = ['Guerrero Sith', 'Inquisidor Sith', 'Cazarrecompensas'];

function buildProgression() {
  const byClass = {};
  for (const row of statsRaw) {
    if (!byClass[row.clase]) byClass[row.clase] = {};
    byClass[row.clase][row.nivel] = {
      hp: row['Puntos de Golpe'],
      defense: row['Defensa'],
      attack: row['Ataque'],
      damage: row['Daño'],
      force: row['Fuerza'] ?? null
    };
  }

  if (byClass['Jedi Guardian']) {
    byClass['Guerrero Sith'] = JSON.parse(JSON.stringify(byClass['Jedi Guardian']));
  }
  if (byClass['Jedi Consul']) {
    byClass['Inquisidor Sith'] = JSON.parse(JSON.stringify(byClass['Jedi Consul']));
  }

  if (byClass.Soldado && byClass['Especialista Técnico']) {
    byClass.Cazarrecompensas = {};
    for (let lv = 1; lv <= 20; lv++) {
      const a = byClass.Soldado[lv];
      const b = byClass['Especialista Técnico'][lv];
      if (!a || !b) continue;
      byClass.Cazarrecompensas[lv] = {
        hp: Math.round((a.hp + b.hp) / 2),
        defense: Math.round((a.defense + b.defense) / 2),
        attack: Math.round((a.attack + b.attack) / 2),
        damage: Math.round((a.damage + b.damage) / 2),
        force: null
      };
    }
  }

  return byClass;
}

function buildSkills() {
  const byClass = {};
  for (const row of skillsRaw) {
    const cls = row.clase;
    if (!byClass[cls]) byClass[cls] = [];
    byClass[cls].push({
      id: `${cls}-${row.nombre}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: row.nombre,
      unlockLevel: row.nivel === 'Siempre' ? 'always' : row.nivel,
      type: row.tipo_habilidad,
      description: row.descripcion,
      class: cls,
      forceCost: inferForceCost(row.descripcion)
    });
  }

  function cloneSkillsForClass(sourceClass, targetClass) {
    byClass[targetClass] = (byClass[sourceClass] || []).map((skill) => ({
      ...skill,
      id: `${targetClass}-${skill.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      class: targetClass
    }));
  }

  cloneSkillsForClass('Jedi Guardian', 'Guerrero Sith');
  cloneSkillsForClass('Jedi Consul', 'Inquisidor Sith');
  cloneSkillsForClass('Soldado', 'Cazarrecompensas');
  applyDerivedClassSkills(byClass);

  return byClass;
}

function skillId(className, name) {
  return `${className}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function applyDerivedClassSkills(byClass) {
  byClass['Guerrero Sith'] = [
    {
      id: skillId('Guerrero Sith', 'Usar la Fuerza oscura'),
      name: 'Usar la Fuerza oscura',
      unlockLevel: 'always',
      type: 'Rol',
      description: 'Los guerreros sith canalizan el lado oscuro para potenciar su cuerpo, intimidar rivales y dominar el combate cuerpo a cuerpo (11+).',
      class: 'Guerrero Sith',
      forceCost: 0
    },
    {
      id: skillId('Guerrero Sith', 'Torbellino de acero'),
      name: 'Torbellino de acero',
      unlockLevel: 1,
      type: 'Activa',
      description: 'Gasta 1 punto de Fuerza y ataca a cada enemigo adyacente con un barrido de sable.',
      class: 'Guerrero Sith',
      forceCost: 1
    },
    {
      id: skillId('Guerrero Sith', 'Salto sombrío'),
      name: 'Salto sombrío',
      unlockLevel: 1,
      type: 'Activa',
      description: 'Gasta 1 punto de Fuerza; este personaje puede mover el doble de su distancia.',
      class: 'Guerrero Sith',
      forceCost: 1
    },
    {
      id: skillId('Guerrero Sith', 'Golpe preciso'),
      name: 'Golpe preciso',
      unlockLevel: 1,
      type: 'Activa',
      description: 'Gasta 1 punto de Fuerza y gana +10 Daño durante un turno.',
      class: 'Guerrero Sith',
      forceCost: 1
    },
    {
      id: skillId('Guerrero Sith', 'Furia dual'),
      name: 'Furia dual',
      unlockLevel: 5,
      type: 'Activa',
      description: 'Puede realizar dos ataques en un mismo turno, pero no puede realizar acción de movimiento.',
      class: 'Guerrero Sith',
      forceCost: 0
    },
    {
      id: skillId('Guerrero Sith', 'Parada sith'),
      name: 'Parada sith',
      unlockLevel: 5,
      type: 'Activa',
      description: 'Gasta 1 punto de Fuerza y repele un ataque cuerpo a cuerpo con 11+.',
      class: 'Guerrero Sith',
      forceCost: 1
    },
    {
      id: skillId('Guerrero Sith', 'Contraataque implacable'),
      name: 'Contraataque implacable',
      unlockLevel: 5,
      type: 'Pasiva',
      description: 'Si el personaje es alcanzado por un ataque, éste hace un ataque automático (salvable con +11).',
      class: 'Guerrero Sith',
      forceCost: 0
    },
    {
      id: skillId('Guerrero Sith', 'Embestida del odio'),
      name: 'Embestida del odio',
      unlockLevel: 10,
      type: 'Activa',
      description: 'Mueve el doble de distancia y realiza un ataque.',
      class: 'Guerrero Sith',
      forceCost: 0
    },
    {
      id: skillId('Guerrero Sith', 'Sed de destrucción'),
      name: 'Sed de destrucción',
      unlockLevel: 10,
      type: 'Pasiva',
      description: 'Gana +10 Daño.',
      class: 'Guerrero Sith',
      forceCost: 0
    },
    {
      id: skillId('Guerrero Sith', 'Duelista sith'),
      name: 'Duelista sith',
      unlockLevel: 15,
      type: 'Pasiva',
      description: 'Gana +4 Defensa cuando es atacado por un sable de luz.',
      class: 'Guerrero Sith',
      forceCost: 0
    },
    {
      id: skillId('Guerrero Sith', 'Destrozar'),
      name: 'Destrozar',
      unlockLevel: 15,
      type: 'Pasiva',
      description: 'Si dos ataques del personaje en el mismo turno impactan, el segundo recibe +10 Daño.',
      class: 'Guerrero Sith',
      forceCost: 0
    }
  ];

  byClass['Inquisidor Sith'] = [
    {
      id: skillId('Inquisidor Sith', 'Usar la Fuerza oscura'),
      name: 'Usar la Fuerza oscura',
      unlockLevel: 'always',
      type: 'Rol',
      description: 'Los inquisidores emplean el lado oscuro para interrogar, atormentar, percibir miedo y manipular a los débiles de mente (11+).',
      class: 'Inquisidor Sith',
      forceCost: 0
    },
    {
      id: skillId('Inquisidor Sith', 'Estrangulamiento'),
      name: 'Estrangulamiento',
      unlockLevel: 1,
      type: 'Activa',
      description: 'Gasta 1 punto de Fuerza y el objetivo (vivo) pierde su turno; salvación 11+.',
      class: 'Inquisidor Sith',
      forceCost: 1
    },
    {
      id: skillId('Inquisidor Sith', 'Deflexión sith'),
      name: 'Deflexión sith',
      unlockLevel: 1,
      type: 'Activa',
      description: 'Gasta 1 punto de Fuerza y repele un ataque a distancia con 11+.',
      class: 'Inquisidor Sith',
      forceCost: 1
    },
    {
      id: skillId('Inquisidor Sith', 'Empujón oscuro'),
      name: 'Empujón oscuro',
      unlockLevel: 1,
      type: 'Activa',
      description: 'Gasta 1 punto de Fuerza, hace 10 de Daño a enemigos cercanos y los aleja.',
      class: 'Inquisidor Sith',
      forceCost: 1
    },
    {
      id: skillId('Inquisidor Sith', 'Ira oscura'),
      name: 'Ira oscura',
      unlockLevel: 5,
      type: 'Activa',
      description: 'Gasta 1 punto de Fuerza y obliga al enemigo a repetir su tirada.',
      class: 'Inquisidor Sith',
      forceCost: 1
    },
    {
      id: skillId('Inquisidor Sith', 'Relámpago de Fuerza'),
      name: 'Relámpago de Fuerza',
      unlockLevel: 5,
      type: 'Activa',
      description: 'Gasta 1 punto de Fuerza e inflige 20 de daño a un enemigo a distancia.',
      class: 'Inquisidor Sith',
      forceCost: 1
    },
    {
      id: skillId('Inquisidor Sith', 'Alquimia Sith I'),
      name: 'Alquimia Sith I',
      unlockLevel: 5,
      type: 'Activa',
      description: 'Gasta 1 punto de Fuerza; transmuta energía oscura para recuperar 20 de vida propia o a un aliado.',
      class: 'Inquisidor Sith',
      forceCost: 1
    },
    {
      id: skillId('Inquisidor Sith', 'Alquimia Sith II'),
      name: 'Alquimia Sith II',
      unlockLevel: 10,
      type: 'Activa',
      description: 'Gasta 2 puntos de Fuerza; recupera 30 de vida propia o a un aliado.',
      class: 'Inquisidor Sith',
      forceCost: 2
    },
    {
      id: skillId('Inquisidor Sith', 'Disipación sith'),
      name: 'Disipación sith',
      unlockLevel: 10,
      type: 'Activa',
      description: 'Gasta 2 puntos de Fuerza y cancela un poder de la Fuerza usado por un enemigo.',
      class: 'Inquisidor Sith',
      forceCost: 2
    },
    {
      id: skillId('Inquisidor Sith', 'Succión de Fuerza'),
      name: 'Succión de Fuerza',
      unlockLevel: 15,
      type: 'Pasiva',
      description: 'Gana 1 punto de Fuerza en su turno.',
      class: 'Inquisidor Sith',
      forceCost: 0
    },
    {
      id: skillId('Inquisidor Sith', 'Maestro inquisitorial'),
      name: 'Maestro inquisitorial',
      unlockLevel: 15,
      type: 'Pasiva',
      description: 'Este personaje puede usar hasta 2 habilidades de la Fuerza por turno.',
      class: 'Inquisidor Sith',
      forceCost: 0
    }
  ];

  byClass.Cazarrecompensas = [
    {
      id: skillId('Cazarrecompensas', 'Rastrear presa'),
      name: 'Rastrear presa',
      unlockLevel: 'always',
      type: 'Rol',
      description: 'El cazarrecompensas rastrea huellas, identifica objetivos y localiza recompensas en entornos hostiles (11+).',
      class: 'Cazarrecompensas',
      forceCost: 0
    },
    {
      id: skillId('Cazarrecompensas', 'Doble disparo'),
      name: 'Doble disparo',
      unlockLevel: 1,
      type: 'Activa',
      description: 'Puede realizar dos ataques en un mismo turno, pero no puede realizar acción de movimiento.',
      class: 'Cazarrecompensas',
      forceCost: 0
    },
    {
      id: skillId('Cazarrecompensas', 'Cargas térmicas'),
      name: 'Cargas térmicas',
      unlockLevel: 1,
      type: 'Activa',
      description: 'Ataque a distancia: 10 de daño al objetivo y a los adyacentes (salvan 11+).',
      class: 'Cazarrecompensas',
      forceCost: 0
    },
    {
      id: skillId('Cazarrecompensas', 'Disparo en movimiento'),
      name: 'Disparo en movimiento',
      unlockLevel: 1,
      type: 'Activa',
      description: 'Puede atacar al salir de cobertura pesada y volver a ella.',
      class: 'Cazarrecompensas',
      forceCost: 0
    },
    {
      id: skillId('Cazarrecompensas', 'Cadencia letal'),
      name: 'Cadencia letal',
      unlockLevel: 5,
      type: 'Pasiva',
      description: 'Cuando consigue crítico, puede realizar otro ataque.',
      class: 'Cazarrecompensas',
      forceCost: 0
    },
    {
      id: skillId('Cazarrecompensas', 'Disparo de perseguidor'),
      name: 'Disparo de perseguidor',
      unlockLevel: 5,
      type: 'Activa',
      description: 'Ignora las coberturas de los enemigos.',
      class: 'Cazarrecompensas',
      forceCost: 0
    },
    {
      id: skillId('Cazarrecompensas', 'Cañón rotatorio'),
      name: 'Cañón rotatorio',
      unlockLevel: 5,
      type: 'Pasiva',
      description: 'Gana +10 daño pero no puede moverse en ese turno.',
      class: 'Cazarrecompensas',
      forceCost: 0
    },
    {
      id: skillId('Cazarrecompensas', 'Detonadores pesados'),
      name: 'Detonadores pesados',
      unlockLevel: 10,
      type: 'Activa',
      description: 'Ataque a distancia: 20 de daño al objetivo y a los adyacentes (salvan 11+).',
      class: 'Cazarrecompensas',
      forceCost: 0
    },
    {
      id: skillId('Cazarrecompensas', 'Veterano de caza'),
      name: 'Veterano de caza',
      unlockLevel: 10,
      type: 'Pasiva',
      description: 'Mientras el personaje tenga al menos la mitad de vida, gana +2 Ataque y +2 Defensa.',
      class: 'Cazarrecompensas',
      forceCost: 0
    },
    {
      id: skillId('Cazarrecompensas', 'Blindaje beskar'),
      name: 'Blindaje beskar',
      unlockLevel: 15,
      type: 'Pasiva',
      description: 'El daño máximo recibido por turno para este personaje es 40.',
      class: 'Cazarrecompensas',
      forceCost: 0
    },
    {
      id: skillId('Cazarrecompensas', 'Lanzallamas incinerador'),
      name: 'Lanzallamas incinerador',
      unlockLevel: 15,
      type: 'Activa',
      description: 'Ataque a distancia corto. Hace 20 de daño a un objetivo y a los cercanos.',
      class: 'Cazarrecompensas',
      forceCost: 0
    }
  ];
}

function inferForceCost(desc) {
  const m = desc.match(/Gasta (\d+) punto/i);
  return m ? parseInt(m[1], 10) : 0;
}

const gameDataRaw = {
  CLASS_META,
  SPECIES_LIST,
  SKILL_UNLOCK_LEVELS,
  MAX_SKILLS,
  COMPENDIUM_SEED_VERSION,
  progression: buildProgression(),
  skills: buildSkills()
};

const helpers = `
export function getStats(classKey, level) {
  const table = GAME_DATA.progression[classKey];
  if (!table) return null;
  return table[level] || table[20];
}

export function getClassList() {
  return Object.entries(GAME_DATA.CLASS_META).map(([key, meta]) => ({ key, ...meta }));
}

export function getSkillsForClass(classKey, characterLevel) {
  const all = GAME_DATA.skills[classKey] || [];
  return all.filter((s) => {
    if (s.unlockLevel === 'always') return true;
    return s.unlockLevel <= characterLevel;
  });
}

export function getUnlockableSkillLevels(level) {
  return GAME_DATA.SKILL_UNLOCK_LEVELS.filter((l) => l <= level);
}

export function formatAttack(mod) {
  return mod >= 0 ? \`+\${mod}\` : \`\${mod}\`;
}

export function getSpeciesList() {
  return GAME_DATA.SPECIES_LIST || [];
}
`;

const out = `/* Auto-generated from xlsx — run: npm run build:data */
export const GAME_DATA = ${JSON.stringify(gameDataRaw, null, 2)};
${helpers}`;
fs.writeFileSync(path.join(root, 'public/js/game-data.js'), out);
console.log('Generated public/js/game-data.js');
