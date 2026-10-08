// Texts of the privacy / terms / support site (T9.3), EN + HU. `scripts/site.ts` renders them to
// static pages for GitHub Pages (`/Blastyard/site/…`, linked from the settings and the paywall).
// The privacy facts here must match the store privacy answers (`docs/store-privacy-answers.md`,
// checked by tests/unit/site.test.ts).

export type SiteLang = 'en' | 'hu';
export type PageId = 'index' | 'privacy' | 'terms' | 'support';

export interface Section {
  readonly h: string;
  /** Paragraphs; a paragraph starting with "- " lines is a list. `{email}` = support address. */
  readonly p: readonly string[];
}

export interface PageText {
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly Section[];
}

/** Last change of the policy texts (shown on the pages). */
export const UPDATED = '2026-10-08';

/** What the app sends anywhere (the store privacy label). Single source for tests and docs. */
export const DATA_FACTS = {
  analytics: false,
  ads: false,
  crashReporting: false,
  account: false,
  tracking: false,
  /** Sent to RevenueCat (purchase processing), not linked to the user's identity. */
  collected: ['Purchase history', 'Anonymous app user ID'],
} as const;

export const NAV: Record<SiteLang, Record<PageId, string>> = {
  en: { index: 'Blastyard', privacy: 'Privacy', terms: 'Terms', support: 'Help & support' },
  hu: { index: 'Blastyard', privacy: 'Adatvédelem', terms: 'Feltételek', support: 'Súgó' },
};

export const UPDATED_LABEL: Record<SiteLang, string> = {
  en: 'Last updated',
  hu: 'Utolsó módosítás',
};

export const CONTACT_FALLBACK: Record<SiteLang, string> = {
  en: 'the developer contact on the app’s store page',
  hu: 'az alkalmazás áruházi oldalán megadott fejlesztői elérhetőség',
};

export const PAGES: Record<SiteLang, Record<PageId, PageText>> = {
  en: {
    index: {
      title: 'Blastyard',
      intro:
        'A free top-down party game for 1–4 players on one phone or tablet: lay the device flat, everyone takes an edge, pop the crates and outlast your friends. No ads, no tracking.',
      sections: [
        {
          h: 'Free, and fair',
          p: [
            'Every mode, 1–4 players, all bot levels and all power-ups are free. The optional one-time Blastyard+ adds 6 arenas, 24 challenges, custom rules and extra characters. The optional Supporter pack is a thank-you with two cosmetic items.',
          ],
        },
      ],
    },
    privacy: {
      title: 'Privacy policy',
      intro:
        'Blastyard is made to be played, not to watch you. It has no analytics, no advertising, no crash reporting and no account.',
      sections: [
        {
          h: 'What stays on your device',
          p: [
            'Your progress (challenge stars, daily streak, stats, trophies), your settings and your Puffs’ looks are saved only on your device. They are not sent anywhere. Deleting the app deletes them.',
          ],
        },
        {
          h: 'Purchases',
          p: [
            'Payments are handled by the App Store or Google Play; we never see your payment details. To confirm and restore purchases the app uses RevenueCat, which receives your purchase history together with a random, anonymous app user ID created on your device. This ID is not linked to your name, e-mail, Apple ID or Google account, and it is not used for tracking or advertising. RevenueCat’s privacy policy: https://www.revenuecat.com/privacy',
          ],
        },
        {
          h: 'What we do not do',
          p: [
            '- no analytics or usage statistics\n- no advertising or ad identifiers\n- no crash-reporting SDKs\n- no sign-in, no account, no contacts, location, camera or microphone\n- no selling or sharing of data, no tracking across apps or websites',
          ],
        },
        {
          h: 'Children',
          p: [
            'Blastyard is suitable for all ages. It collects no personal data from anyone, children included, and contains no ads or external links inside the game except this site and the store.',
          ],
        },
        {
          h: 'Questions',
          p: ['Write to {email}. If this policy ever changes, the new version appears here first.'],
        },
      ],
    },
    terms: {
      title: 'Terms of use',
      intro:
        'Blastyard is free to download and play. These terms cover the optional in-app purchases.',
      sections: [
        {
          h: 'Purchases',
          p: [
            'Blastyard+ and the Supporter pack are one-time, non-consumable purchases: you pay once and keep them on every device signed in to the same App Store or Google Play account (Family Sharing on iOS). “Restore purchases” in the settings or on the Blastyard+ page brings them back after reinstalling. There are no subscriptions, currencies, consumables or loot boxes.',
          ],
        },
        {
          h: 'Refunds',
          p: [
            'Refunds are handled by the store you bought from (Apple: reportaproblem.apple.com; Google Play: your order history).',
          ],
        },
        {
          h: 'Licence',
          p: [
            'You may install and play Blastyard for personal, non-commercial use. On iOS, Apple’s standard Licensed Application End User License Agreement also applies: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
          ],
        },
        {
          h: 'No warranty',
          p: [
            'The game is provided “as is”. We do our best to keep it working and fair, but we cannot guarantee that it is free of bugs on every device.',
          ],
        },
        { h: 'Contact', p: ['{email}'] },
      ],
    },
    support: {
      title: 'Help & support',
      intro: 'Something not working, or an idea? Write to {email}.',
      sections: [
        {
          h: 'How do we play on one device?',
          p: [
            'Lay the phone or tablet flat on the table. In a party every player sits at an edge and owns the control zone in front of them: drag to walk, tap the pop button to drop a pop. The warm-up lobby lets everyone try their controls before the match.',
          ],
        },
        {
          h: 'A swipe from the edge closes or minimises the game',
          p: [
            'The game keeps the system edge gestures away from the control zones where the system allows it. If it still happens, use the touch test (Settings → Controls) to see where your device cancels touches, try a larger control size, or turn on guided access / screen pinning.',
          ],
        },
        {
          h: 'My purchase is missing',
          p: [
            'Open Settings → About → Restore purchases (or the Blastyard+ page) while signed in to the same store account you bought with. A payment marked “pending” unlocks by itself once the store confirms it.',
          ],
        },
        {
          h: 'Can I play with a controller?',
          p: [
            'Yes: press a button on a connected gamepad and it takes the first free player seat.',
          ],
        },
        {
          h: 'Where is my progress saved?',
          p: [
            'On your device only. There is no cloud save, so deleting the app also deletes your progress.',
          ],
        },
      ],
    },
  },
  hu: {
    index: {
      title: 'Blastyard',
      intro:
        'Ingyenes felülnézetes party-játék 1–4 főnek egy telefonon vagy tableten: tedd le az eszközt az asztalra, mindenki kap egy szélt, robbantsd a ládákat és maradj talpon a végéig. Reklám és követés nélkül.',
      sections: [
        {
          h: 'Ingyenes és tisztességes',
          p: [
            'Minden mód, 1–4 játékos, minden bot-szint és minden erősítő ingyenes. Az opcionális, egyszeri Blastyard+ 6 arénát, 24 kihívást, saját szabályokat és extra karaktereket ad. Az opcionális Támogatói csomag egy köszönet két kozmetikai elemmel.',
          ],
        },
      ],
    },
    privacy: {
      title: 'Adatvédelmi tájékoztató',
      intro:
        'A Blastyard játszani való, nem megfigyelni téged. Nincs benne analitika, reklám, hibajelentő SDK és fiók.',
      sections: [
        {
          h: 'Ami az eszközödön marad',
          p: [
            'Az előrehaladásod (kihívás-csillagok, napi sorozat, statisztika, trófeák), a beállításaid és a Puffok kinézete csak az eszközödön van elmentve, sehová nem küldjük. Az alkalmazás törlésével ezek is törlődnek.',
          ],
        },
        {
          h: 'Vásárlások',
          p: [
            'A fizetést az App Store vagy a Google Play intézi; a fizetési adataidat mi sosem látjuk. A vásárlások ellenőrzéséhez és visszaállításához az alkalmazás a RevenueCat szolgáltatást használja, amely megkapja a vásárlási előzményeidet egy, az eszközödön létrehozott véletlen, névtelen felhasználói azonosítóval együtt. Ez az azonosító nincs összekötve a neveddel, e-mail-címeddel, Apple ID-ddel vagy Google-fiókoddal, és nem használjuk követésre vagy reklámra. A RevenueCat adatvédelmi tájékoztatója: https://www.revenuecat.com/privacy',
          ],
        },
        {
          h: 'Amit nem csinálunk',
          p: [
            '- nincs analitika vagy használati statisztika\n- nincs reklám és reklámazonosító\n- nincs hibajelentő SDK\n- nincs bejelentkezés, fiók, névjegy-, hely-, kamera- vagy mikrofonhasználat\n- nem adunk el és nem osztunk meg adatot, nem követünk alkalmazásokon vagy weboldalakon át',
          ],
        },
        {
          h: 'Gyerekek',
          p: [
            'A Blastyard minden korosztálynak való. Senkitől – így gyerekektől sem – gyűjt személyes adatot, és a játékon belül nincs reklám vagy külső hivatkozás, csak erre az oldalra és az áruházra.',
          ],
        },
        {
          h: 'Kérdések',
          p: [
            'Írj ide: {email}. Ha a tájékoztató valaha megváltozik, az új változat először itt jelenik meg.',
          ],
        },
      ],
    },
    terms: {
      title: 'Felhasználási feltételek',
      intro:
        'A Blastyard ingyenesen letölthető és játszható. Ezek a feltételek az opcionális alkalmazáson belüli vásárlásokra vonatkoznak.',
      sections: [
        {
          h: 'Vásárlások',
          p: [
            'A Blastyard+ és a Támogatói csomag egyszeri, nem fogyó vásárlás: egyszer fizetsz, és minden olyan eszközön megmarad, amelyen ugyanazzal az App Store- vagy Google Play-fiókkal vagy bejelentkezve (iOS-en Családi megosztással is). A beállításokban vagy a Blastyard+ oldalon a „Vásárlások visszaállítása” újratelepítés után visszahozza őket. Nincs előfizetés, valuta, fogyóeszköz vagy loot box.',
          ],
        },
        {
          h: 'Visszatérítés',
          p: [
            'A visszatérítést az az áruház intézi, ahol vásároltál (Apple: reportaproblem.apple.com; Google Play: rendelési előzmények).',
          ],
        },
        {
          h: 'Licenc',
          p: [
            'A Blastyardot személyes, nem kereskedelmi célra telepítheted és játszhatod. iOS-en az Apple szabványos végfelhasználói licencszerződése is érvényes: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
          ],
        },
        {
          h: 'Szavatosság',
          p: [
            'A játékot „ahogy van” állapotban adjuk. Mindent megteszünk, hogy működjön és tisztességes legyen, de nem garantálhatjuk, hogy minden eszközön hibátlan.',
          ],
        },
        { h: 'Kapcsolat', p: ['{email}'] },
      ],
    },
    support: {
      title: 'Súgó és támogatás',
      intro: 'Valami nem működik, vagy van egy ötleted? Írj ide: {email}.',
      sections: [
        {
          h: 'Hogyan játszunk egy eszközön?',
          p: [
            'Tedd le a telefont vagy tabletet laposan az asztalra. Partiban mindenki egy szélnél ül, és az előtte lévő vezérlőzóna az övé: húzással jársz, a pukkancs-gombbal lerakod a pukkancsot. A bemelegítő lobbiban meccs előtt mindenki kipróbálhatja a vezérlését.',
          ],
        },
        {
          h: 'A szélről indított húzás bezárja vagy lekicsinyíti a játékot',
          p: [
            'A játék, ahol a rendszer engedi, távol tartja a rendszer szélső gesztusait a vezérlőzónáktól. Ha mégis előfordul, nézd meg az érintés-teszttel (Beállítások → Irányítás), hol szakítja meg az eszközöd az érintéseket, próbálj nagyobb vezérlőméretet, vagy kapcsold be az irányított hozzáférést / képernyő-rögzítést.',
          ],
        },
        {
          h: 'Eltűnt a vásárlásom',
          p: [
            'Nyisd meg a Beállítások → Névjegy → Vásárlások visszaállítása gombot (vagy a Blastyard+ oldalt) ugyanazzal az áruházfiókkal, amellyel vásároltál. A „függőben” lévő fizetés magától feloldódik, amint az áruház jóváhagyja.',
          ],
        },
        {
          h: 'Játszhatok kontrollerrel?',
          p: [
            'Igen: nyomj meg egy gombot a csatlakoztatott kontrolleren, és az elfoglalja az első szabad játékoshelyet.',
          ],
        },
        {
          h: 'Hová mentődik az előrehaladásom?',
          p: [
            'Csak az eszközödre. Nincs felhőmentés, így az alkalmazás törlése az előrehaladást is törli.',
          ],
        },
      ],
    },
  },
};
