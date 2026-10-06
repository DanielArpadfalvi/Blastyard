# Blastyard – megvalósítási terv

> Munkacím: **Blastyard** (később átnevezhető). Felülnézetes, rácsalapú robbantós party-játék: 1–4 játékos
> **egy telefonon/tableten** (asztalra fektetve, mindenkinek saját sarok-vezérlőzóna), botok ellen vagy egyedül
> kihívásokban. Online privát szobák barátokkal a 1.1-ben (rollback netkód).
> Forrás: `swaplight/docs/market-research-2026-10.md`, 4. ötlet (Igény 4 · Rés 5 · Megval. 3 · Trend 3).
> Döntések (2026-10-06): TypeScript + Capacitor 8 · **landscape-only** · az alapjáték teljesen ingyenes, egyszeri
> „Blastyard+” feloldás (≈2,99 USD) + opcionális supporter · 1.0 teljesen offline · kódból generált grafika és hang.

---

## 0. Piac és rés

| Cím | Mit csinál | Mit csinál rosszul / mi hiányzik |
|---|---|---|
| Konami hivatalos mobil Bomberman-címek | A hivatalos F2P mobilcím 2019-ben leállt; az Apple Arcade-exkluzív *Amazing Bomberman* (2022) 2025. május 29-én szintén megszűnt [K] | Hivatalos, igényes mobil változat jelenleg nincs |
| Bomber Friends (Hyperkani) | A rés piacvezetője (~1,3M értékelés), online arénák, skinek, bomba-effektek, progresszió [K] | Online-központú (játékos-sűrűségtől függ), valuta + kozmetikai bolt + reklámok; nincs igazi egy eszközös, 4 fős helyi mód |
| BombSquad | 8 fős fizikás party-játék, ingyenes + „Pro” 2,99 USD + jegyek, 50M+ Android-letöltés | Helyi multihoz minden játékosnak saját telefon (kontroller-app) vagy gamepad kell; nem rácsalapú, kaotikusabb |
| „2 3 4 Player Party MiniGames” típusú gyűjtemények | 30+ minijáték egy eszközön, köztük egy „Bomber” minijáték [K] | Sekély (egy minijáték a sok közül), reklámos, gyenge botok, nincs tartalom-mélység |
| Kisebb klónok (itch.io, F2P) | Klasszikus szabályok | Agresszív, meccs közbeni reklámok és „Upset” értékelés-hangulat [K]; gyenge touch-vezérlés, nincs egy telefonos 4 fős mód |

[K] = keresési kivonatból származó adat (2026-10).

**A rés:** igényes, reklám- és valutamentes, rácsalapú robbantós party-játék, amit **egyetlen eszközön** 2–4 fő
játszhat (vendégeknek semmit sem kell telepíteniük), jó botokkal és egyszemélyes kihívásokkal. Az online módot
szándékosan a 1.1-re hagyjuk, és ott is csak **barátokkal, meghívókóddal** (nincs idegenekkel párosítás → nincs
játékos-sűrűség-kockázat).

**Célközönség:**
- Családok, gyerekes szülők (6+ év), baráti társaságok: kanapé, asztal, utazás, buli – „vegyük elő a telefont”.
- Retro-nosztalgiázók (25–45), akik a műfajt konzolon szerették, de mobilon nincs tisztességes változat.
- Egyedül játszók rövid (2–3 perces) körökre: botok, napi kihívás, kihívás-kampány.

**Pitch (EN):** *Blastyard – the backyard blast party for one phone. Up to four friends, one screen, zero ads.*

---

## 1. Játékterv (GDD)

### 1.1 Alapmechanika (pontos számokkal)
| Paraméter | Érték | Megjegyzés |
|---|---|---|
| Szimuláció | **60 Hz fix tick**, csak egész számok | 1 csempe = **256 alegység** (Q8); minden időzítő tickben |
| Aréna | **13 × 13** csempe (külső fallal) → 11 × 11 belső; oszlopok minden páros (x, y) belső pozíción (25 db) | Négyzet: landscape-ben középen áll, két oldalt egyenlő vezérlősáv; asztalon minden ülésből ugyanolyan |
| Ládák (rombolható) | a szabad cellák **70%-a** (seedelt), kivéve a kezdősarkok 3 cellás L-alakú biztonsági zónáit | Arénánként felülírható (`crateDensity`) |
| Erősítő a ládában | **30%** esély, súlyozott seedelt húzás (lásd 1.2) | A láng elpusztítja a szabadon fekvő erősítőt (kivéve az első 30 tickben a felbukkanás után) |
| Mozgási sebesség | alap **16 alegység/tick = 3,75 csempe/s**; Görkori +2/db, max +4 db → **24 = 5,6 csempe/s** | Fordulás csak csempe-tengelyen; **sarok-segéd:** merőleges irányra, ha ≤ 96 alegységre (37,5%) vagyunk az igazítástól, automatikusan becsúszik |
| Bomba-kapacitás | kezdés **1**, max **6** | |
| Lángtáv | kezdés **2** csempe, max **7** | |
| Gyújtózsinór | **150 tick = 2,5 s** | A bombán körbefutó gyűrű mutatja a hátralévő időt (olvashatóság) |
| Láncreakció | a lánggal eltalált bomba **4 tick** múlva robban | Látható „dominó” |
| Láng élettartam | **30 tick = 0,5 s** (halálos) | |
| Saját bomba | a lerakó átmehet rajta, amíg el nem hagyja a csempét | Mindenki más számára fal |
| Kör hossza | **120 s**, utána **hirtelen halál** | 3-2-1 visszaszámlálás (180 tick) előtte |
| Hirtelen halál („Záródó kert”) | a külső gyűrűtől befelé spirálban **15 tickenként (0,25 s) 1 csempe** válik fallá; aki alatta áll, kiesik | Kb. 25 s alatt 5×5-re szűkül, ott megáll 10 s-ra, majd folytatódik |
| Kör vége | utolsó túlélő nyer; ha a maradék mind ugyanabban a tickben esik ki → döntetlen kör | |
| Meccs | **3 nyert körig** (opció: 1 / 3 / 5) | Tipikus meccs 8–10 perc |
| Kezdőhelyek | négy sarok; 2 fő: átlósan szemközti sarkok; 3 fő: 3 sarok, seedelt | |
| Szellem-bosszú (alapból be) | a kiesett játékos szellemként a külső fal mentén siklik, **8 s-onként** lerakhat egy **1-es lángú, 3 s-os** „szellembombát” a szélső belső sávba | Nincs feltámadás; a kiesettek nem unatkoznak (party-kulcs) |
| Csapat 2v2 (opció) | baráti tűz ki/be (alap: ki), a csapat akkor nyer, ha a másik csapat mind kiesett | |

### 1.2 Erősítők (1.0: 8 + 1 „átok”)
| Erősítő (HU / EN) | Hatás | Súly |
|---|---|---|
| Plusz pukkancs / Extra Pop | +1 bomba-kapacitás | 26 |
| Láng / Flame | +1 lángtáv | 26 |
| Görkori / Roller | +2 alegység/tick sebesség | 16 |
| Rúgás / Kick | rárohanva a bomba **8 csempe/s**-mal csúszik akadályig | 8 |
| Dobókesztyű / Toss | bombagomb a saját bombán állva → 3 csempét dob előre, falon átrepülve | 6 |
| Átütő láng / Pierce | a láng átmegy a ládákon (mindet felrobbantja a távon belül) | 5 |
| Pajzs / Shield | egy találatot elnyel (kör végéig vagy találatig), 60 tick sérthetetlenség utána | 5 |
| Tűzijáték / Max Flame | lángtáv maxra | 3 |
| **Átok / Jinx** (negatív) | 10 s-ig véletlen hatás: fordított irányítás · lassú · „kapkodás” (automatikus bombalerakás) · bomba-tilalom. Érintéssel átadható | 5 |

Rúgás és Dobókesztyű egymást kizárja (az új felülírja a régit) – így egy gomb elég a touch-vezérléshez.
Kieséskor a felvett erősítők legfeljebb 4 db-a szétszóródik szabad cellákra (seedelt).

### 1.3 Egy telefon, 2–4 játékos – a kulcskérdés

**Megvizsgált lehetőségek:**
| Megoldás | Ítélet |
|---|---|
| Körönkénti átadás (pass-and-play) | Valós idejű játékhoz alkalmatlan. Csak egy külön „pontvadász-torna” módnak jó (1.1) |
| Osztott képernyő, mindenki saját arénanézettel | Telefonon túl kicsi; a közös aréna a műfaj lényege |
| Minden játékosnak saját telefon kontrollerként (BombSquad-minta) | Telepítést kér a vendégektől, hálózatfüggő → 1.1 online keretében |
| Bluetooth gamepad / billentyűzet | Kiváló kiegészítés (TV-tükrözés, tablet), de kevesen hoznak 4 kontrollert → **1.0 kiegészítő**, spike-függő |
| **Asztali mód: eszköz laposan az asztalon, mindenkinek saját vezérlőzóna a képernyő szélén** | **Ajánlott fő megoldás** |

**Ajánlás – „Asztali mód” (Table mode):**
- Az eszköz **fekvő (landscape) tájolásban, laposan** fekszik az asztalon. Középen a négyzetes aréna, két oldalt
  egy-egy vezérlősáv. A meccs elején a tájolás **zárolódik** (laposan fekvő eszköznél a giroszkóp megbízhatatlan).
- **Két elrendezés:**
  - **„Szemtől szemben” (2 fő, telefonon is kényelmes):** a két játékos a két rövid oldalnál ül, mindkettő a saját
    teljes oldalsávját kapja (6,5"-os telefonon ≈ 44 × 69 mm) → **kétujjas** vezérlés (bal hüvelyk: kar,
    jobb hüvelyk: bomba), ugyanúgy, mint egyedül.
  - **„Négy sarok” (3–4 fő; tableten ajánlott, telefonon is működik, de szoros):** mindkét oldalsáv kettéosztva →
    4 sarokzóna (telefonon ≈ 44 × 34 mm, tableten ≈ 45 × 60 mm). Egy játékos = egy kéz = **egyujjas vezérlés**
    (lásd 1.4). A sarok-játékosok a hosszú oldalak mentén ülnek, a sarkokba nyúlnak be.
- **Ülés-tájolás:** minden zónának van egy „előre” iránya (0/90/180/270°). A lebegő kar vektorát **nem** forgatjuk:
  az ujj a képernyőn mozog, és a képernyő = aréna-tér, így a „tőle elfelé” húzás bármelyik oldalról a Puffot is
  tőle elfelé viszi (forgatással az oldalt ülők 90°-kal rossz irányba mennének). A tájolás a zóna ülés-relatív
  elrendezését adja (kar-rész a játékos bal 55%-a, bomba gomb a jobb alsó negyede, balkezes csere), és a relatív
  eszközöket (billentyűzet, gamepad, fix D-pad) forgatja a játékos keretéből világkoordinátába.
  Alapértékek: szemtől szemben → az aréna közepe felé; sarkok → a legközelebbi hosszú oldaltól befelé.
  A lobbyban a zóna nyíl-ikonjára koppintva 90°-onként állítható. A zónában minden szöveg/HUD (név, erősítők,
  „KÉSZ?”) a játékos felé fordul. A felülnézetes, kerek karakterek és a forma-alapú csempék bármelyik irányból
  olvashatók.
- **Érintés-hozzárendelés:** egy érintés ahhoz a zónához tartozik, ahol **elkezdődött**, egészen a felengedésig
  (akkor is, ha átcsúszik). A zónák közt 4 mm holt sáv; az aréna fölötti érintéseket figyelmen kívül hagyjuk
  (tenyér-elutasítás). A zónák a képernyő szélétől a safe area + **8 mm** beljebb kezdődnek (rendszer-gesztusok).
- **Bemelegítő lobby:** a csatlakozás képernyője maga egy mini-aréna: mindenki a zónájába bök → megjelenik a
  karaktere és **azonnal mozoghat, bombázhat (sebzés nélkül)**. Így tanulják meg a vezérlést és a tájolást.
  „Kész” = tartsd az ujjad a zónádban 1 s-ig; ha mindenki kész, indul a visszaszámlálás. Az üres helyeket botok
  töltik ki (beállítható: bot / üres).
- **Szünet asztali módban:** a képernyő felső-közép szélén kis szünet-gomb, **0,6 s nyomva tartás** kell (véletlen
  érintés ellen). Háttérbe kerüléskor automatikus szünet.
- **Haptika** asztali módban alapból **ki** (egy eszközön mindenkinek rezegne), egyedül alapból be.
- **Eszköz-ellenőrzés:** Beállítások → „Érintés-teszt”: kiírja, hány egyidejű érintést lát az eszköz; ha < 4,
  a 4 sarkos mód figyelmeztetést ad („ez az eszköz csak N ujjat lát – javasolt: szemtől szemben”).
- **Ajánlás a felhasználónak:** 2 fő → bármelyik telefon; 3–4 fő → tablet vagy nagy telefon; 4 kontroller → gamepad.

### 1.4 Touch-vezérlés részletesen
Mértékegység: dp (CSS px), mm a fizikai méretre (≈ 6,3 dp/mm feltételezve; a layout-solver a valós DPR-ből számol).

**A) Kétujjas séma (egyedül, szemtől szemben):**
- **Lebegő kar (bal):** a zóna bal 55%-ában bárhová lerakott ujj = a kar középpontja. Holt zóna **12 dp** (≈ 2 mm).
  4 irány; főirány = a nagyobb komponens, **15° hiszterézissel** (nem villog a tengelyek közt). A kisebb komponens
  (ha > 35% a főhöz képest) „másodlagos irány” → a sarok-segéd ezt használja kanyarodási szándékként.
  Ha az ujj **60 dp**-nél messzebb húz, a kar középpontja utánamegy (nincs „kifutás”). Felengedés = megállás.
- **Bomba gomb (jobb):** látható átmérő **72 dp**, érintési terület **96 dp**, a zóna jobb alsó negyedében,
  hüvelykujj-ívben. Lenyomás-élre reagál (nem felengedésre). Ha a lerakás épp nem lehetséges, **6 tickig pufferel**.
- Opció: **fix D-pad** a lebegő kar helyett (a játékos felé forgatva rajzolva, ezért ennek irányait az ülés-tájolás
  forgatja); **balkezes csere** (kar jobbra, gomb balra); zónaméret-csúszka (80–120%).

**B) Egyujjas séma (négy sarok; egyedül opcióként is):**
- Az egész zóna lebegő kar (ugyanazok a paraméterek).
- **Bomba = rövid koppintás:** < **180 ms** és < **12 dp** elmozdulás. Mozgás közben bárhol **második ujj**
  a zónában = bomba (aki kényelmesen elfér, használhatja).
- Kiegészítő segítség: a koppintás után a karakter a csempe közepére igazodik (a lerakás mindig a csempe-középpont
  szerinti cellára történik).

**C) Gamepad / billentyűzet (1.0, ha a T5.5 spike zöld):** Gamepad API (Android WebView, iOS WKWebView),
D-pad/bal kar + A = bomba; billentyűzet: WASD+Space, nyilak+Enter (webes fejlesztéshez is). Egy zóna helyett
egy kontroller rendelhető minden üléshez.

**Bemenet a magnak:** játékosonként tickenként 1 bájt: bit 0–2 főirány (0 nincs, 1 fel, 2 jobb, 3 le, 4 bal),
bit 3–5 másodlagos irány, bit 6 bomba-él, bit 7 tartalék. 4 játékos = 32 bit/tick.

### 1.5 Tájolás: landscape-only (döntés)
- A négyzetes aréna a fekvő képernyő közepén áll, a vezérlők **soha nem takarják** az arénát.
- A csempeméret ugyanaz, mint portréban lenne (a rövid oldal a szűk keresztmetszet: 6,5"-os telefonon ≈ 5,2 mm/csempe),
  viszont landscape-ben jut hely két kényelmes hüvelykujj-zónának → egyedül is jobb.
- Az asztali mód eleve landscape; egyetlen layout-rendszert kell karbantartani.
- Mindkét landscape irány engedélyezett a menükben; meccs/lobby alatt zárolva.
- **Layout-solver:** aréna oldal = min(0,94 × magasság − HUD, szélesség − 2 × max(38 mm, 0,22 × szélesség)).
  4:3 tableten így az aréna ≈ 0,75 × magasság (≈ 8,5 mm/csempe), és ≥ 38 mm széles oldalsávok maradnak.
  A külső fal vékonyabb sávként (0,4 csempe) rajzolódik, hogy a belső 11 × 11 nagyobb legyen.

### 1.6 Játékmódok
| Mód | Leírás | 1.0 | 1.1 | Ingyenes? |
|---|---|---|---|---|
| **Party (helyi)** | 1–4 ember egy eszközön + botok a maradék helyre; Klasszikus vagy Csapat 2v2; szabály-presetek (Klasszikus / Gyors: 90 s kör, 2 bomba kezdés / Káosz: 45% erősítő esély, Átok gyakoribb) | ✔ | | **Igen, teljes egészében** |
| **Gyors meccs vs. botok** | Party-preset 1 emberrel, egy koppintással | ✔ | | Igen, minden nehézség |
| **Kihívások (kampány)** | 3 világ × 12 pálya: célok, csillagok, kis szörnyek | ✔ | | 1. világ ingyen, 2–3. a Blastyard+-ban |
| **Napi kihívás** | dátum-seed: aréna-variáns + módosító + cél, helyi rekord és sorozat | ✔ | | Igen |
| **Oktatás** | 5 lépés, ≈ 90 s | ✔ | | Igen |
| **Saját szabályok** | körhossz, erősítők ki/be és súly, kezdő statok, hirtelen halál típusa, szellem-bosszú | ✔ | | Blastyard+ (a presetek ingyenesek) |
| Online privát szoba | 2–4 fő, meghívókód, rollback netkód, botok kitölthetnek | | ✔ | Igen (vendég is ingyen) |
| Pontvadász-torna (pass-and-play) | mindenki ugyanazt a seedelt kihívást játssza egymás után, legjobb pont nyer | | ✔ | Igen |
| Új módok | „Domb királya”, „Aranyláz” (érmegyűjtés), 6 fős nagy aréna (15 × 15) tableten | | ✔ | Igen / Blastyard+ arénák |
| Pályaszerkesztő + kódos megosztás | | | ✔ | Szerkesztés ingyen |

### 1.7 Kihívás-kampány (retenció egyedül)
- **36 pálya** (3 világ × 12): *Hátsókert* (ingyenes), *Roncstelep*, *Háztető*. Minden pálya 30–90 s.
- **Céltípusok:** „robbants fel minden ládát N s alatt” · „győzd le a szörnyeket” · „juss el a zászlóig” ·
  „éld túl N s-ot 2 bot ellen” · „győzz egy Nehéz bot ellen 1 bombával” · „gyűjts össze N erősítőt”.
- **Csillagok:** 1 = teljesítve, 2 = időlimit alatt, 3 = extra feltétel (pl. sérülés nélkül, ≤ N bomba).
- **Szörnyek (3 típus, determinisztikus, egyszerű):** *Csiga* (véletlen bolyongás, 1,5 csempe/s), *Kopó* (BFS-sel
  üldöz, ha ≤ 5 csempére van, 3 csempe/s), *Szöcske* (3 s-onként átugrik egy ládát/oszlopot).
- Minden világ 12. pályája „kesztyűpróba”: sorozatban több bot-ellenfél.
- Minden beépített pályához tartozik egy **referencia-megoldás input log**, amit a `npm run check` visszajátszik
  (bizonyítja, hogy teljesíthető, és hogy a szimuláció nem változott).

### 1.8 Tartalom az 1.0-ban
- **Arénák: 12** (13 × 13, eltérő oszlop-/fal-elrendezéssel). 6 ingyenes: 4 klasszikus elrendezés + *Jégpálya*
  (jég: megcsúszás 2 csempéig) + *Teleport-kert* (2 pár teleport). 6 Blastyard+: *Futószalag-gyár* (szalagok
  8 alegység/tick), *Alagút* (átjárás a szélek közt), *Trambulin* (a bombák átpattannak 2 csempét), *Omladék*
  (90 s után új oszlopok nőnek), *Labirintus* (kevesebb láda, több fal), *Vegyes* (kombináció).
- **Erősítők:** 8 + Átok (fent), mind ingyenes – a játékszabály soha nincs fizetőfal mögött.
- **Karakterek („Puffok”):** kerek, felülnézetből olvasható lények eltérő sziluettel (fül, antenna, tüske, csőr…),
  **csak kozmetikai különbség, nincs stat-eltérés**. 8 ingyenes + 4 Blastyard+. Minden játékos színe + egyedi
  forma-jelvény (kör, háromszög, négyzet, csillag) + sorszám → színvak-barát.
- **Bombák:** „pukkancsok” – lüktető, kerek gubók körbefutó gyújtó-gyűrűvel (nem a klasszikus kanócos fekete gömb).
- **Kozmetikumok:** 12 kalap, 6 pukkancs-skin, 6 nyom-effekt; ingyenesen játékkal megszerezhető mérföldkövekkel
  (pl. 10 nyert meccs, 30 csillag) – nincs valuta, nincs bolt. A Blastyard+ +4 karaktert, +6 kalapot, +3 skint ad.

### 1.9 Progresszió
- Valuta nélkül: **mérföldkövek** (meccsek, győzelmek, csillagok, napi sorozat) oldanak fel kozmetikumot.
- Statisztikák (meccsek, győzelmek, kiütések, saját bombától kiesések, kedvenc aréna), helyi „trófeák” (20 db).
- Kihívás-világok: a következő világ ingyenesen is látszik, a Blastyard+ nyitja (a 2–3. világon belül csillagküszöb
  nincs, hogy a vásárló azonnal kapja, amit vett).

### 1.10 Botok
- **A szimuláció része** (`src/core/ai`), determinisztikus, saját RNG-folyammal → a replay és a jövőbeli online
  meccs botokkal is reprodukálható.
- **Veszélytérkép:** cellánként „hány tick múlva ég” (a láncreakciókat is propagálva), BFS a biztonságos cellákig.
- **Célok prioritással:** túlélés > menekülőút ellenőrzése bombalerakás előtt (csak akkor rak, ha a lerakás után is
  van ≤ zsinóridő alatt elérhető biztonságos cella) > erősítő felvétel > ellenfél csapdába ejtése > láda robbantás.
- **Nehézség (4 szint):**
| Szint | Döntési intervallum | Reakció-késés | Hibaarány (rossz menekülés) | Agresszió | Képességek |
|---|---|---|---|---|---|
| Könnyű | 12 tick | 24 tick (400 ms) | 12% | alacsony | nem rúg, nem dob |
| Normál | 8 tick | 15 tick | 5% | közepes | rúg |
| Nehéz | 6 tick | 7 tick | 1,5% | magas | rúg, dob, csapdáz |
| Mester | 4 tick | 3 tick | 0,3% | magas | + láncreakció-tervezés, 2 lépéses csapda |
- Teljesítmény: 4 bot döntése < 0,3 ms/tick egy gyenge telefonon (11 × 11 rácson triviális).
- Minőségi célok (seedelt bot-vs-bot szimulációk a CI-ban): Mester > Könnyű ≥ 90%, Nehéz > Normál ≥ 70%;
  Könnyű bot halálainak legfeljebb 35%-a saját bomba, Mesteré ≤ 10%; 4 Normál bot átlagos kör ideje 60–150 s.

### 1.11 Oktatás
- **5 interaktív lépés (≈ 90 s):** mozgás (érj a zászlóhoz) → bomba lerakás + elbújás → láda robbantás és
  erősítő felvétel → láncreakció → győzz le egy Könnyű botot. Minden lépés a valós vezérléssel, kihagyható.
- Első asztali módnál a bemelegítő lobby a tanító (felirat a zónákban: „Húzd az ujjad: mozgás · Koppints: bomba”).
- Kontextuális tippek első alkalommal (első Rúgás, első Átok, első hirtelen halál) – 1 sor, 3 s.

### 1.12 Akadálymentesség
- Színvak-barát: szín + forma-jelvény + sorszám minden játékosnál; a lángok és a veszélyes cellák mintázattal is.
- **Játéksebesség 70% / 85% / 100%** (gyerekeknek): a szimuláció változatlan, csak a valós idejű tick-ütem lassul
  → determinisztika megmarad.
- „Barátságos” szabály: saját bomba nem sebez (opció). Sarok-segéd erőssége állítható.
- Csökkentett mozgás (nincs képernyőrázás, villanás), nagyobb betű, zónaméret-csúszka, balkezes mód, külön
  hangerő zene/effekt, hang-jelzés a zsinór utolsó 0,5 s-ában.

### 1.13 Látvány és hang (kódból generált)
- **Stílus:** „játszótér-hátsókert”: meleg, telített színek, vastag körvonal, enyhe felülnézeti árnyék; eltér a
  Swaplight/Craterpult neon stílusától. Pixi `Graphics` → `generateTexture` egyszer, utána **sprite-ok és pool**
  (nincs képkockánkénti újrarajzolás). Ikon, splash, store-képek is kódból (SVG → PNG).
- **Animáció:** a Puffok procedurálisan pattognak (squash & stretch), pislognak, ijedt arc a láng közelében,
  győzelmi tánc. Robbanás: kereszt alakú láng, részecskék, ládatörmelék, rövid rázás (≤ 6 px), villanás.
- Render-interpoláció a tickek között (alpha), 60 FPS cél, 30 FPS-re visszaesés esetén is helyes játék.
- **Hang:** Web Audio procedurális SFX (zsinór-sistergés gyorsuló pittyegéssel, robbanás = zajimpulzus + mély
  szinusz-dobbanás, felvétel = arpeggio, kiesés = ereszkedő „pfff”), generatív zene 3 sávval
  (menü / meccs / hirtelen halál – tempó +15%). Haptika a `platform` rétegen át.

### 1.14 Nyelvek
EN + HU az 1.0-ban (i18n), később DE, ES, PT-BR.

---

## 2. Üzleti modell

**Cél: minél több játékos.** Party-játéknál a belépés ingyenessége döntő (BombSquad-tanulság), és egy eszközös
módban **egy vásárlás az egész társaságot kiszolgálja**.

| | Ingyenes (örökre, teljes értékű) | **Blastyard+** (non-consumable, ≈ **2,99 USD**, regionálisan lejjebb) | **Supporter** (non-consumable, ≈ 1,99 USD, opcionális) |
|---|---|---|---|
| Party / Gyors meccs / 2v2 / Napi kihívás / Oktatás | ✔ mind | | |
| Játékosszám, bot-nehézség, erősítők | ✔ 1–4 fő, mind a 4 szint, mind a 9 erősítő | | |
| Arénák | 6 | +6 (különleges mechanikák) | |
| Kihívások | 1. világ (12) | 2–3. világ (+24) | |
| Szabályok | 3 preset | Saját szabályok szerkesztő | |
| Kozmetika | 8 Puff, 12 kalap, 6 skin, 6 nyom (játékkal) | +4 Puff, +6 kalap, +3 skin | aranykorona + konfetti-nyom, köszönő képernyő |

- **Nincs** reklám, energia, valuta, fogyóeszköz, loot box, pay-to-win; minden költés összesen ≤ 4,98 USD.
- Restore Purchases (Beállítások + paywall), iOS Family Sharing bekapcsolva, RevenueCat a `platform` mögött.
  Termékek: `blastyard_plus` (entitlement `plus`), `blastyard_supporter` (entitlement `supporter`).
- **Miért nem riaszt el:** a party-mag (amiért letöltik) teljesen ingyenes és nincs benne zár; a vendégeknek nem kell
  semmit telepíteni/venni; a feloldás változatosság + kozmetika + egyszemélyes tartalom, nem erő; nincs nyaggatás:
  a paywall csak zárolt elemre koppintva nyílik, és **egyszer**, az 5. befejezett meccs után egy nem-blokkoló
  „Tetszik? Blastyard+ – 6 új aréna” kártya a meccs-eredmény alatt.
- Store-leírás első sora (EN): *„Free party game – all modes, up to 4 players on one device, no ads. Optional
  one-time Blastyard+ adds 6 arenas, 24 challenges and extra characters.”* Soha nem írjuk: „Lite”, „Demo”, „Trial”.
- **Adatvédelem:** nincs analitika-, crash- vagy reklám-SDK; minden mentés helyben. A store-címke a RevenueCat miatt: Purchase History + anonim User ID, nem a felhasználóhoz kötve, nincs követés (Craterpult `docs/store-privacy-answers.md` mintájára).

---

## 3. Technikai terv

Stack (a Swaplighttal/Craterpulttal azonos): **Vite + TypeScript strict + PixiJS v8 + Preact + Capacitor 8 +
Vitest + Playwright** (Chromium: `/opt/pw-browsers`).

```
src/
  core/      # tiszta, determinisztikus szimuláció – NINCS DOM/Pixi/Math.random/Date.now, NINCS float az állapotban
    rng.ts         # sfc32, állapota a snapshot része; több folyam (aréna, erősítő, botonként)
    state.ts       # struct-of-arrays állapot (typed arrays), snapshot/restore, hash (FNV-1a)
    arena.ts       # rács, csempe-típusok, generálás (ládák, rejtett erősítők), mechanikák (jég, szalag, teleport…)
    movement.ts    # alegységes mozgás, sarok-segéd, ütközés, bomba-áthaladás
    bombs.ts       # zsinór, lánc, láng-terjedés, rúgás, dobás
    powerups.ts    # erősítők, Átok
    round.ts       # visszaszámlálás, időzítő, hirtelen halál spirál, kiesés, szellem-bosszú, győzelem/döntetlen
    match.ts       # körök, pontok, csapatok, szabály-preset
    step.ts        # step(state, inputs[4]) → events; az egyetlen belépési pont
    ai/            # veszélytérkép, BFS, bot-célok, nehézségek; szörnyek viselkedése
    replay.ts      # input log (RLE), visszajátszás, golden hash-ek, SIM_VERSION
  game/      # meccs-életciklus: lobby/ülések, fix tick-hurok (akkumulátor), játéksebesség, mód-logika, kihívás-célok
  render/    # Pixi: aréna, Puffok, pukkancsok, lángok, effektek, interpoláció, ülés-felé forduló zóna-HUD
  input/     # érintés-zónák (pointerId → zóna), lebegő kar, bomba gomb/koppintás, ülés-forgatás, gamepad, billentyű
  audio/     # Web Audio SFX + generatív zene
  ui/        # Preact: menük, lobby-overlay, beállítások, paywall, eredmények, kihívás-térkép
  platform/  # Capacitor-wrapperek web mockkal: storage, haptics, IAP, lifecycle, képernyő-ébrenlét,
             # tájolás-zár, rendszer-gesztus kizárás, status bar
  i18n/      # EN + HU
  content/   # arénák, kihívások (+ referencia-megoldások), presetek, kozmetika-katalógus (JSON/TS adat)
  net/       # (1.1) csak interfész + mock – az 1.0-ban nem készül
tests/unit, tests/e2e, scripts/ (validate-content, sim-bench, bot-league, make-assets, store-frames)
```

### 3.1 Adatformátumok
- **Aréna** (`content/arenas/*.ts`, JSON-kompatibilis): `{ id, theme, size: 13, rows: string[13] }` ASCII-rács
  (`#` fal, `o` oszlop, `.` szabad, `+` fix láda, `?` véletlen láda-jelölt, `1–4` kezdőhely, `T` teleport,
  `> < ^ v` szalag, `~` jég, `=` alagút-vég), `crateDensity`, `powerupWeights?`, `mechanics`. Validátor:
  minden kezdőhelyen 3 cellás biztonsági L, összefüggő bejárható tér, szimmetria-ellenőrzés (fair spawn).
- **Szabály-preset:** `{ roundSeconds, winsToMatch, startBombs, startRange, startSpeed, powerupChance, weights,
  suddenDeath: 'spiral'|'none', ghosts: boolean, friendlyFire, teams }` – a meccs seedjével együtt a replay része.
- **Kihívás:** `{ id, world, arenaId|inlineArena, preset, actors (botok/szörnyek), objective, stars[3],
  solution: InputLogRLE }`.
- **Mentés:** verziózott JSON (`save.v1`) a `platform/storage` mögött, migrációkkal; replay csak a legutóbbi meccsé.
- **Replay:** `{ SIM_VERSION, seed, preset, arenaId, seats, inputs: RLE<uint32 per tick> }`.

### 3.2 Determinizmus és felkészülés a rollback netkódra (1.1)
- Egész aritmetika mindenhol (alegység, tick), seedelt RNG az állapotban, bejárási sorrend rögzítve (játékos-index,
  bomba-létrehozási sorrend) – nincs `Map`/`Set` iterációs sorrendre épülő logika.
- `step(state, inputs)` **tiszta**: csak az állapotot és a bemenetet használja; az események (robbanás, felvétel…)
  tick-azonosítóval jönnek, így a render rollback után újra-szimulált eseményeket duplikálás nélkül kezelni tudja.
- **Olcsó snapshot:** az állapot typed array-ekben (cél ≤ 4 KB), `snapshot()`/`restore()` ≤ 0,05 ms.
- **Teljesítmény-büdzsé a rollbackhez:** `step` átlag ≤ 0,1 ms (4 bottal ≤ 0,3 ms) középkategóriás telefonon →
  8 tick újraszimulálása < 3 ms/képkocka. `scripts/sim-bench` méri, a CI-ban figyelmeztet regresszióra.
- Golden hash tesztek: fix seed + input log → ismert állapot-hash az 1., 600. és utolsó ticken.
  `SIM_VERSION` emelése kötelező minden szimuláció-változásnál; a kihívás-megoldásokat újra kell validálni.
- A játéksebesség-opció és a render-interpoláció a `game`/`render` rétegben él, a magot nem érinti.

### 3.3 Teljesítmény- és platformkockázatok
- **Multi-touch:** egyes olcsó Androidok 2–5 egyidejű érintést kezelnek; iOS/Android szél-gesztusok (vissza,
  értesítési sáv, home indicator) elnyelik a szélső érintéseket → zónák beljebb, Android
  `setSystemGestureExclusionRects` (max 200 dp oldalanként), iOS `preferredScreenEdgesDeferringSystemGestures`
  natív konfiggal a `platform` rétegben; Érintés-teszt képernyő; korai valós eszközös spike (T2.4).
- **Bemeneti késleltetés:** pointer-esemény → következő tick; cél érintés→kép ≤ 50 ms. Nincs CSS-animáció a
  canvas fölött meccs közben; `touch-action: none`, passzív listenerek.
- **WebView render:** ≤ 600 sprite, textúra-atlasz a generált textúrákból, részecske-pool (max 300), effekt-
  minőség automatikus csökkentése, ha az FPS 3 s-ig < 50. Csökkentett mozgás = kevesebb részecske is.
- **Hosszú party-szeánsz:** melegedés/akkumulátor → 60 FPS sapka, menüben 30 FPS, képernyő ébren csak meccs alatt.
- **Tájolás laposan:** a meccs/lobby indításakor zárolás az aktuális landscape irányra.

---

## 4. Mérföldkövek (részletek: `docs/TASKS.md`)

| # | Mérföldkő | Kész, ha… |
|---|---|---|
| M0 | Alapozás + CI | check/build/e2e zöld a CI-ban |
| M1 | Mag-szimuláció | determinizmus- és golden-hash tesztek zöldek, sim-bench a büdzsén belül |
| M2 | Játszható prototípus | egyedül egy bot ellen és 2 fő szemtől szemben játszható webről; valós eszközös touch-spike lezárva |
| M3 | Játékélmény | effektek, hang, haptika, 60 FPS a referencia-eszközön; screenshot-review |
| M4 | Tartalom + botok | 9 erősítő, 12 aréna, 12 Puff; bot-liga célértékei teljesülnek |
| M5 | Módok | asztali mód 4 sarokkal, kihívások, napi, oktatás, (gamepad) |
| M6 | Meta & UI | menük, mentés, progresszió, EN/HU, akadálymentesség |
| M7 | Mobil héj | Capacitor android/ios, ikon/splash, natív CI, rendszer-gesztusok kezelve |
| M8 | Monetizáció | Blastyard+ / Supporter, paywall, restore |
| M9 | Kiadás 1.0 | store-anyagok EN/HU, screenshot-generátor, adatvédelem/support oldal, QA, 1.0.0 |
| M10 | 1.1 ötletek | online privát szobák rollbackkel, torna, szerkesztő, új módok |

Becslés: az 1.0 ≈ 12–14 iteráció (M0–M2: 3, M3–M5: 5, M6–M9: 5).

---

## 5. Kockázatok

| Kockázat | Hatás | Kezelés |
|---|---|---|
| **Multi-touch és rendszer-gesztusok** egy telefonon 4 ujjal | A party-ígéret nem működik bizonyos eszközökön | T2.4 valós eszközös spike M2-ben; Érintés-teszt; zónák beljebb; gesztus-kizárás; 2 fős mód a biztos alap |
| **4 fő egy telefonon szűkös** (kis csempe, egyujjas vezérlés) | Frusztráció, rossz értékelés | Tableten ajánlott; szemtől szemben a fő telefonos ajánlás; sarok-segéd, bomba-puffer, zónaméret; korai playtest |
| **Bot-minőség** (túl buta / túl tökéletes) | Egyedül unalmas | Veszélytérképes AI, bot-liga statisztikák a CI-ban, emberibb hibák (reakcióidő, hiba-arány) |
| **Felfedezhetőség** (a store-keresést a nagy F2P címek uralják, védjegyes kulcsszó nem használható) | Kevés letöltés | ASO: „party game, 4 player, one phone, offline, no ads” kulcsszavak, generált store-videó/képek |
| **Determinizmus a rollbackhez** | 1.1-ben újraírás | Most: tiszta `step`, snapshot, golden hash, sim-bench – a netkód maga a 1.1 |
| **Védjegy / IP** | Elutasítás, jogi kockázat | Eredeti név, karakterek, bombaforma, erősítő-nevek; a referencia-cím neve sehol a játékban, store-szövegben, kulcsszavakban |
| **WebView teljesítmény** gyenge Androidon | Akadozás | sprite-pool, generált atlasz, automatikus minőség-csökkentés, referencia low-end eszköz a QA-ban |

### Szándékosan a 1.1-re hagyva
- **Online** privát szobák (2–4 fő, meghívókód, rollback, WebRTC peer-to-peer + jelzőszerver; backend-döntés a
  1.1 elején; nincs idegenekkel párosítás, nincs ranglista → nincs játékos-sűrűség-kockázat, nincs adatgyűjtés).
- Pontvadász-torna (pass-and-play), pályaszerkesztő + kódos megosztás, 6 fős 15 × 15 arénák, új módok
  (Domb királya, Aranyláz), további nyelvek, TV-re optimalizált nézet.
