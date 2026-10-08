// Store listing texts (T9.1), EN + HU – the single source for `docs/store-listing.md`
// (`npm run listing` writes it; tests/unit/storeListing.test.ts checks the store limits, that the
// first line says what is free, that no reference-game trademark appears, and that the doc is
// current). Never "Lite", "Demo" or "Trial" (CLAUDE.md).

import { writeFileSync } from 'node:fs';

export type ListingLang = 'en' | 'hu';

export interface Listing {
  /** App Store name / Google Play title (≤ 30). */
  readonly name: string;
  /** App Store subtitle (≤ 30). */
  readonly subtitle: string;
  /** Google Play short description (≤ 80). */
  readonly shortDescription: string;
  /** App Store promotional text (≤ 170). */
  readonly promo: string;
  /** Full description (≤ 4000); the first line states what is free. */
  readonly description: string;
  /** App Store keywords, comma separated without spaces (≤ 100 bytes). */
  readonly keywords: string;
  /** "What's new" for 1.0.0 (≤ 500). */
  readonly whatsNew: string;
}

export const LIMITS = {
  name: 30,
  subtitle: 30,
  shortDescription: 80,
  promo: 170,
  description: 4000,
  keywords: 100,
  whatsNew: 500,
} as const;

export const LISTING: Record<ListingLang, Listing> = {
  en: {
    name: 'Blastyard: Party Pop Arena',
    subtitle: '1–4 players on one device',
    shortDescription:
      'Free party game for 1–4 players on one phone or tablet. No ads, no tracking.',
    promo:
      'Lay your phone or tablet flat, grab an edge each and pop your friends out of the yard. Free party game for 1–4 players – no ads, no accounts.',
    description: `Free party game – all modes, up to 4 players on one device, no ads. Optional one-time Blastyard+ adds 6 arenas, 24 challenges and extra characters.

Lay your phone or tablet flat on the table. Every player takes an edge and owns the control zone in front of them. Drop pops, blow up crates, grab power-ups and be the last Puff standing.

PARTY ON ONE DEVICE
• 1–4 players on one phone or tablet, bots on any empty seat
• Face to face or four corners, 2 vs 2 teams
• Warm-up lobby: everyone tries their controls and gets ready
• Classic, Fast and Chaos rules, best of 1, 3 or 5

PLAY ALONE TOO
• Quick Match against bots with four difficulty levels
• 12 hand-made challenges with stars, little monsters and a gauntlet
• A new daily challenge every day – keep your streak going
• Five-step tutorial in about 90 seconds

POWER-UPS
Extra Pop, Flame, Roller, Kick, Toss, Pierce, Shield, Max Flame – and the Jinx curse you can pass on with a touch.

MADE FOR THE TABLE
• Controls stay at the edges, never over the arena
• One-finger or two-thumb controls, left-handed layout, adjustable size
• Colour-blind friendly seats (colour, shape and number), reduced motion, larger text
• Game controllers supported

FAIR
• Every mode, player count, bot level and power-up is free
• Blastyard+ (one-time purchase): 6 arenas with ice, belts, teleports, tunnels, trampolines and growing pillars, 24 more challenges, custom rules, extra Puffs, hats and pop skins – one purchase for the whole table, Family Sharing on iOS
• Optional Supporter pack: a crown, a confetti trail and our thanks
• No ads, no energy, no currencies, no loot boxes, no accounts, no tracking
• Works offline`,
    keywords:
      'party,local,multiplayer,friends,family,couch,table,arena,blast,pop,maze,bots,offline,4player',
    whatsNew:
      'First release: party mode for 1–4 players, 36 challenges, daily challenge, tutorial.',
  },
  hu: {
    name: 'Blastyard: party-aréna',
    subtitle: '1–4 játékos egy eszközön',
    shortDescription: 'Ingyenes party-játék 1–4 főnek egy eszközön. Reklám és követés nélkül.',
    promo:
      'Tedd le a telefont vagy tabletet az asztalra, mindenki fogjon egy szélt, és pukkantsd ki a barátaidat az udvarról. Ingyenes party-játék 1–4 főnek, reklám és fiók nélkül.',
    description: `Ingyenes party-játék – minden mód, legfeljebb 4 játékos egy eszközön, reklám nélkül. Az opcionális, egyszeri Blastyard+ 6 arénát, 24 kihívást és extra karaktereket ad.

Tedd le a telefont vagy tabletet laposan az asztalra. Mindenki egy szélnél ül, és az előtte lévő vezérlőzóna az övé. Rakj le pukkancsokat, robbants ládákat, szedd fel az erősítőket, és legyél az utolsó talpon maradt Puff.

PARTY EGY ESZKÖZÖN
• 1–4 játékos egy telefonon vagy tableten, az üres helyekre botok ülhetnek
• Szemben vagy négy sarokban, 2 a 2 ellen csapatban
• Bemelegítő lobbi: mindenki kipróbálja a vezérlését, és jelzi, hogy kész
• Klasszikus, Gyors és Káosz szabályok, 1, 3 vagy 5 győzelemig

EGYEDÜL IS
• Gyors meccs botok ellen, négy nehézségi szinten
• 12 kézzel készített kihívás csillagokkal, kis szörnyekkel és kesztyűpróbával
• Minden nap új napi kihívás – tartsd életben a sorozatod
• Ötlépéses oktatás nagyjából 90 másodpercben

ERŐSÍTŐK
Plusz pukkancs, Láng, Görkori, Rúgás, Dobókesztyű, Átütő láng, Pajzs, Tűzijáték – és az Átok, amit egy érintéssel továbbadhatsz.

AZ ASZTALRA TERVEZVE
• A vezérlők a széleken maradnak, sosem takarják az arénát
• Egyujjas vagy kéthüvelykujjas irányítás, balkezes elrendezés, állítható méret
• Színtévesztő-barát helyek (szín, forma és szám), kevesebb mozgás, nagyobb szöveg
• Kontroller-támogatás

TISZTESSÉGES
• Minden mód, játékosszám, bot-szint és erősítő ingyenes
• Blastyard+ (egyszeri vásárlás): 6 aréna jéggel, futószalaggal, teleporttal, alagúttal, trambulinnal és növő oszlopokkal, 24 további kihívás, saját szabályok, extra Puffok, kalapok és pukkancs-skinek – egy vásárlás az egész asztalnak, iOS-en Családi megosztással
• Opcionális Támogatói csomag: korona, konfetti-nyom és a köszönetünk
• Nincs reklám, energia, valuta, loot box, fiók és követés
• Internet nélkül is működik`,
    keywords:
      'party,társas,többjátékos,barátok,család,asztal,aréna,robbanás,pukkancs,labirintus,offline',
    whatsNew: 'Első kiadás: party mód 1–4 főnek, 36 kihívás, napi kihívás, oktatás.',
  },
};

/**
 * Age-rating questionnaire answers (App Store / IARC). Cartoon blasts with no blood: "infrequent /
 * mild cartoon or fantasy violence"; nothing else applies.
 */
export const AGE_RATING: readonly (readonly [string, string])[] = [
  [
    'Cartoon or fantasy violence',
    'Infrequent/mild (round characters are popped out, no blood or injury)',
  ],
  ['Realistic violence', 'None'],
  ['Sexual content or nudity', 'None'],
  ['Profanity or crude humour', 'None'],
  ['Alcohol, tobacco or drugs', 'None'],
  ['Simulated gambling / loot boxes', 'None'],
  ['Horror / fear themes', 'None'],
  ['Medical / treatment information', 'None'],
  ['User-generated content, chat, web access', 'None (links only to our privacy / support pages)'],
  ['In-app purchases', 'Yes – two optional non-consumables (Blastyard+, Supporter pack)'],
  [
    'Expected rating',
    'App Store 4+ (9+ if Apple maps mild cartoon violence higher), PEGI 3/7, ESRB E',
  ],
];

/** Renders `docs/store-listing.md`. */
export function listingMarkdown(): string {
  const lines: string[] = [
    '# Store listing (EN / HU)',
    '',
    'GENERATED by `npm run listing` from `scripts/storeListing.ts` – edit that file, not this one.',
    'Store limits, the "free" first line and the trademark check: `tests/unit/storeListing.test.ts`.',
    '',
  ];
  for (const lang of ['en', 'hu'] as const) {
    const l = LISTING[lang];
    lines.push(`## ${lang === 'en' ? 'English' : 'Magyar'}`, '');
    lines.push(`- **Name / title** (${l.name.length}/30): ${l.name}`);
    lines.push(`- **Subtitle** (App Store, ${l.subtitle.length}/30): ${l.subtitle}`);
    lines.push(
      `- **Short description** (Google Play, ${l.shortDescription.length}/80): ${l.shortDescription}`,
    );
    lines.push(`- **Promotional text** (App Store, ${l.promo.length}/170): ${l.promo}`);
    lines.push(
      `- **Keywords** (App Store, ${Buffer.byteLength(l.keywords, 'utf8')}/100 bytes): \`${l.keywords}\``,
    );
    lines.push(`- **What's new 1.0.0**: ${l.whatsNew}`, '');
    lines.push(
      `### Description (${l.description.length}/4000)`,
      '',
      '```text',
      l.description,
      '```',
      '',
    );
  }
  lines.push('## Age rating answers', '', '| Question | Answer |', '|---|---|');
  for (const [q, a] of AGE_RATING) lines.push(`| ${q} | ${a} |`);
  lines.push('');
  return lines.join('\n');
}

export function main(): number {
  writeFileSync('docs/store-listing.md', listingMarkdown());
  console.log('listing: docs/store-listing.md written');
  return 0;
}
