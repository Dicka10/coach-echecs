// Ouvertures : base libre de Lichess (CC0) et fiches en français pour les grandes familles.

let bookPromise = null;

export function loadBook() {
  bookPromise ??= fetch('data/openings.json').then((res) => {
    if (!res.ok) throw new Error('Base d\'ouvertures indisponible');
    return res.json();
  }).catch((err) => { bookPromise = null; throw err; });
  return bookPromise;
}

const positionKey = (fen) => fen.split(' ').slice(0, 3).join(' ');

// Pour chaque demi-coup : encore dans la théorie ? quel est le nom connu à ce stade ?
export function bookInfo(parsed, book) {
  const inBook = [true];
  const names = [null];
  let current = null;
  let open = true;
  for (let ply = 1; ply < parsed.fens.length; ply++) {
    const entry = book[positionKey(parsed.fens[ply])];
    open = open && entry !== undefined;
    if (open && entry) current = entry;
    inBook.push(open);
    names.push(current);
  }
  return { inBook, names, last: current };
}

const FAMILIES = {
  'Italian Game': ['Partie italienne', 'Les Blancs visent vite f7 avec leur fou et se développent simplement.'],
  'Ruy Lopez': ['Partie espagnole', 'Le fou blanc met la pression sur le cavalier qui défend e5, avec une lutte longue au centre.'],
  'Scotch Game': ['Partie écossaise', 'Les Blancs ouvrent tout de suite le centre avec d4.'],
  'Four Knights Game': ['Partie des quatre cavaliers', 'Développement symétrique et solide des deux cavaliers de chaque camp.'],
  'Three Knights Opening': ['Partie des trois cavaliers', 'Développement simple, proche de la partie des quatre cavaliers.'],
  "Petrov's Defense": ['Défense Petrov', 'Les Noirs contre-attaquent e4 au lieu de défendre e5, pour un jeu solide.'],
  'Philidor Defense': ['Défense Philidor', 'Les Noirs défendent e5 avec d6 : solide, mais un peu passif.'],
  "King's Gambit": ['Gambit du roi', 'Les Blancs offrent un pion pour ouvrir la colonne f et attaquer.'],
  'Vienna Game': ['Partie viennoise', 'Les Blancs préparent f4 après avoir développé leur cavalier.'],
  'Vienna Gambit': ['Gambit viennois', 'Les Blancs jouent f4 pour attaquer, après le cavalier en c3.'],
  "Bishop's Opening": ['Ouverture du fou', 'Le fou sort tôt vers f7 en gardant le choix pour le pion f.'],
  'Center Game': ['Partie du centre', 'Les Blancs ouvrent le centre tôt, au risque de sortir vite leur dame.'],
  'Danish Gambit': ['Gambit danois', 'Les Blancs offrent des pions pour un développement très rapide.'],
  'Ponziani Opening': ['Ouverture Ponziani', 'Les Blancs préparent d4 avec c3, un plan rare et direct.'],
  "King's Pawn Game": ['Partie du pion roi', 'Début classique avec e4, sans système précis encore.'],
  "King's Pawn Opening": ['Partie du pion roi', 'Début classique avec e4, sans système précis encore.'],
  "King's Knight Opening": ['Ouverture du cavalier roi', 'Les Blancs attaquent e5 et développent une pièce.'],
  'Latvian Gambit': ['Gambit letton', 'Les Noirs offrent un pion très tôt : risqué et tranchant.'],
  'Elephant Gambit': ['Gambit de l\'éléphant', 'Les Noirs sacrifient le pion d pour une contre-attaque immédiate.'],
  'Englund Gambit': ['Gambit Englund', 'Les Noirs répondent à d4 par e5 et offrent un pion, avec des pièges.'],
  'Sicilian Defense': ['Défense sicilienne', 'Les Noirs répondent à e4 par c5 et cherchent un jeu asymétrique et combatif.'],
  'French Defense': ['Défense française', 'Les Noirs bâtissent un centre solide avec e6 et d5, mais leur fou de cases blanches reste gêné.'],
  'Caro-Kann Defense': ['Défense Caro-Kann', 'Les Noirs préparent d5 avec c6 : très solide, avec une structure saine.'],
  'Pirc Defense': ['Défense Pirc', 'Les Noirs laissent le centre aux Blancs pour l\'attaquer ensuite avec leur fou en g7.'],
  'Modern Defense': ['Défense moderne', 'Les Noirs placent vite leur fou en g7 et attaquent le centre plus tard.'],
  'Alekhine Defense': ['Défense Alekhine', 'Le cavalier noir provoque les pions blancs pour les attaquer ensuite.'],
  'Scandinavian Defense': ['Défense scandinave', 'Les Noirs attaquent e4 tout de suite avec d5, pour un jeu simple.'],
  'Nimzowitsch Defense': ['Défense Nimzowitsch', 'Les Noirs sortent le cavalier en c6 et contrôlent le centre autrement.'],
  'Owen Defense': ['Défense Owen', 'Les Noirs fianchettent le fou de cases blanches dès b6.'],
  'Rat Defense': ['Défense du rat', 'Les Noirs jouent d6 et restent très flexibles.'],
  'Horwitz Defense': ['Défense Horwitz', 'Les Noirs répondent à d4 par e6 et gardent plusieurs plans possibles.'],
  "Queen's Gambit": ['Gambit dame', 'Les Blancs offrent le pion c pour gagner le contrôle du centre.'],
  "Queen's Gambit Declined": ['Gambit dame refusé', 'Les Noirs gardent leur pion d5 et jouent e6 : un choix très solide.'],
  "Queen's Gambit Accepted": ['Gambit dame accepté', 'Les Noirs prennent le pion c et visent un développement libre.'],
  'Slav Defense': ['Défense slave', 'Les Noirs soutiennent d5 avec c6 sans enfermer leur fou.'],
  'Semi-Slav Defense': ['Défense semi-slave', 'Les Noirs combinent c6 et e6 : solide, avec des lignes tranchantes.'],
  'Tarrasch Defense': ['Défense Tarrasch', 'Les Noirs jouent c5 pour un jeu actif, quitte à avoir un pion isolé.'],
  'London System': ['Système de Londres', 'Les Blancs installent le même schéma solide avec le fou en f4.'],
  'Colle System': ['Système Colle', 'Les Blancs se développent derrière leurs pions et préparent e4.'],
  'Trompowsky Attack': ['Attaque Trompowsky', 'Le fou sort en g5 très tôt pour déséquilibrer le jeu.'],
  'Torre Attack': ['Attaque Torre', 'Les Blancs clouent le cavalier avec le fou en g5, dans un schéma solide.'],
  'Rapport-Jobava System': ['Système Jobava', 'Les Blancs jouent Cc3 et Ff4 pour un jeu actif.'],
  'Blackmar-Diemer Gambit': ['Gambit Blackmar-Diemer', 'Les Blancs offrent le pion e pour ouvrir la colonne f et attaquer.'],
  "Queen's Pawn Game": ['Partie du pion dame', 'Début avec d4, sans système précis encore.'],
  'Indian Defense': ['Défense indienne', 'Les Noirs répondent à d4 par Cf6 et décident plus tard de leur structure.'],
  'Indian Game': ['Défense indienne', 'Les Noirs répondent à d4 par Cf6 et décident plus tard de leur structure.'],
  "King's Indian Defense": ['Défense est-indienne', 'Les Noirs laissent le centre aux Blancs, puis contre-attaquent sur le roi.'],
  'Nimzo-Indian Defense': ['Défense nimzo-indienne', 'Le fou noir cloue le cavalier en c3 pour contrôler e4.'],
  "Queen's Indian Defense": ['Défense ouest-indienne', 'Les Noirs contrôlent les cases centrales avec leur fou en b7.'],
  'Grünfeld Defense': ['Défense Grünfeld', 'Les Noirs laissent un grand centre aux Blancs pour l\'attaquer aussitôt.'],
  'Bogo-Indian Defense': ['Défense bogo-indienne', 'Le fou donne un échec en b4 pour faciliter le développement noir.'],
  'Old Indian Defense': ['Ancienne défense indienne', 'Comme l\'est-indienne, mais avec le fou en e7.'],
  'Benoni Defense': ['Défense Benoni', 'Les Noirs jouent c5 et acceptent un jeu déséquilibré.'],
  'Benko Gambit': ['Gambit Benko', 'Les Noirs offrent un pion pour une pression durable à l\'aile dame.'],
  'Dutch Defense': ['Défense hollandaise', 'Les Noirs jouent f5 pour se battre sur la case e4 et attaquer à l\'aile roi.'],
  'Catalan Opening': ['Ouverture catalane', 'Les Blancs associent d4, c4 et un fou en g2 qui pèse sur le centre.'],
  'English Opening': ['Ouverture anglaise', 'Les Blancs jouent c4 et contrôlent le centre depuis le côté.'],
  'Réti Opening': ['Ouverture Réti', 'Les Blancs se développent avec Cf3 et attaquent le centre à distance.'],
  'Zukertort Opening': ['Ouverture Zukertort', 'Les Blancs commencent par Cf3, un début souple.'],
  'Bird Opening': ['Ouverture Bird', 'Les Blancs jouent f4 pour contrôler e5, avec un jeu moins habituel.'],
  "King's Indian Attack": ['Attaque est-indienne', 'Un schéma blanc polyvalent avec Cf3, g3, Fg2 et d3.'],
  'Nimzo-Larsen Attack': ['Attaque Nimzo-Larsen', 'Les Blancs fianchettent le fou de cases blanches dès b3.'],
  'Polish Opening': ['Ouverture polonaise', 'Les Blancs jouent b4 d\'entrée : surprenant et peu courant.'],
  'Van Geet Opening': ['Ouverture Van Geet', 'Les Blancs commencent par Cc3, un début souple et rare.'],
  'Grob Opening': ['Ouverture Grob', 'Les Blancs jouent g4 d\'entrée : provocateur et risqué.'],
  'Hungarian Opening': ['Ouverture hongroise', 'Les Blancs jouent g3 et préparent un fou en g2.'],
  "Van't Kruijs Opening": ['Ouverture Van\'t Kruijs', 'Les Blancs jouent e3, un début discret et souple.'],
  'Mieses Opening': ['Ouverture Mieses', 'Les Blancs jouent d3, un début discret et souple.'],
  'Bongcloud Attack': ['Attaque Bongcloud', 'Le roi blanc avance dès le deuxième coup : un début surtout pour plaisanter.'],
  'Wayward Queen Attack': ['Attaque de la dame', 'La dame sort tôt pour viser f7 : facile à repousser avec un bon développement.'],
};

const normalize = (text) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/'/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

const FAMILY_KEYS = Object.keys(FAMILIES)
  .map((key) => ({ key, norm: normalize(key) }))
  .sort((a, b) => b.norm.length - a.norm.length);

// « Sicilian Defense: Bowdler Attack » devient { title: 'Défense sicilienne', variation: 'Bowdler Attack', ... }
export function describeOpening(name) {
  if (!name) return { title: 'Ouverture inconnue', variation: '', description: '' };
  const norm = normalize(name);
  const family = FAMILY_KEYS.find((f) => norm === f.norm || norm.startsWith(`${f.norm} `) || norm.startsWith(`${f.norm}:`));
  if (!family) return { title: name, variation: '', description: '' };
  const [title, description] = FAMILIES[family.key];
  const variation = name.includes(':')
    ? name.split(':').slice(1).join(':').trim()
    : name.split(' ').slice(family.key.split(' ').length).join(' ');
  return { title, variation, description };
}

// Genre de l'ouverture, déduit des deux premiers demi-coups : valable pour toutes les parties.
export function openingGenre(moves) {
  const [first, second] = moves.map((m) => m.san);
  if (first === 'e4') {
    return second === 'e5'
      ? { label: 'Partie ouverte', hint: 'Le centre s\'ouvre vite : le développement et les tactiques comptent beaucoup.' }
      : { label: 'Partie semi-ouverte', hint: 'Les Noirs ne répondent pas symétriquement : la partie devient vite déséquilibrée.' };
  }
  if (first === 'd4') {
    return second === 'd5'
      ? { label: 'Partie fermée', hint: 'Le centre reste bloqué plus longtemps : les plans comptent plus que les tactiques immédiates.' }
      : { label: 'Partie semi-fermée', hint: 'Les Noirs évitent d5 et attaquent le centre avec leurs pièces.' };
  }
  return { label: 'Ouverture de flanc', hint: 'Le centre est contrôlé à distance plutôt qu\'occupé tout de suite.' };
}
