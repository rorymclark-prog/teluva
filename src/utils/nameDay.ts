// Namenstag — the Austrian name day.
//
// WHY THIS EXISTS
// In Austria a name day is a real, celebrated date: colleagues bring a cake,
// grandparents phone, a child gets a small present. It is not a birthday and it
// is not a substitute for one — a family here keeps both. This app already
// knows everyone's first name and already has a daily "who are we celebrating"
// pass, so the only thing missing was the mapping from a name to its day.
//
// THE ONE RULE THIS FILE OBEYS: NEVER INVENT A NAME DAY.
// Two things make that easy to get wrong.
//
//   1. Most of the world has no name day at all. Shyam, Nomvula, Kayla, Rory
//      have no place in the Catholic sanctoral calendar this table is built
//      from. "No name day for this name" is therefore the ORDINARY answer, not
//      an edge case, and the UI must be able to say it plainly. Guessing a
//      plausible-looking date for a Zulu or Sanskrit name would be both wrong
//      and, in a family with South African and Austrian children side by side,
//      quietly insulting.
//   2. Several names genuinely have more than one day, and which one a family
//      keeps is a family fact, not a lookup. Maria is the clearest case: the
//      name day proper is Mariä Namen (12 September), but plenty of Austrian
//      Marias are congratulated on Mariä Himmelfahrt (15 August) because it is
//      the public holiday everyone notices. Benedikt moved from 21 March to
//      11 July when the calendar was revised and both are still in use.
//
// So this table only ever SUGGESTS. Nothing here is celebrated, notified or
// put on the calendar until a person is stored with `nameDay` set — see
// FamilyMember.nameDay in types.ts. The suggestion is offered with the feast
// named ("Hl. Josef"), the family taps it once, and from then on the stored
// month-day is the fact. That also keeps the server honest: the daily
// notification cron reads the stored `nameDay` string and needs no copy of
// this table, so there is no second dataset to drift out of sync.
//
// SOURCE OF THE DATES
// The Austrian Namenskalender, i.e. the sanctoral calendar as kept in Austria.
// Where the Roman and the traditional Austrian date differ, the entry carries
// the one Austrian families actually use and `alsoOn` records the other, so a
// family that keeps the other date can see it rather than think we are wrong.

export interface NameDaySuggestion {
  /** 'MM-DD' — a recurring month/day, never a full date: a name day has no year. */
  date: string;
  /** The feast this day belongs to, e.g. 'Hl. Josef'. Shown so the date is checkable. */
  feast: string;
  /** The catalogued name that matched — 'Josef' when the member is a 'Sepp'. */
  matched: string;
  /** The other date this name is also kept on, when there genuinely is one. */
  alsoOn?: { date: string; feast: string };
}

interface Entry {
  date: string;
  feast: string;
  display: string;
  alsoOn?: { date: string; feast: string };
}

/* Canonical names, keyed by their normalised form (see normalize()).
 * Add a name here ONLY with its feast — an entry without a nameable feast is a
 * guess wearing a date. */
const CALENDAR: Record<string, Entry> = {
  // — January —
  basilius: { date: '01-02', feast: 'Hl. Basilius', display: 'Basilius' },
  genoveva: { date: '01-03', feast: 'Hl. Genoveva', display: 'Genoveva' },
  kaspar: { date: '01-06', feast: 'Hl. Drei Könige', display: 'Kaspar' },
  melchior: { date: '01-06', feast: 'Hl. Drei Könige', display: 'Melchior' },
  balthasar: { date: '01-06', feast: 'Hl. Drei Könige', display: 'Balthasar' },
  raimund: { date: '01-07', feast: 'Hl. Raimund von Peñafort', display: 'Raimund' },
  ernst: { date: '01-12', feast: 'Hl. Ernst', display: 'Ernst' },
  hilarius: { date: '01-13', feast: 'Hl. Hilarius', display: 'Hilarius' },
  antonius: { date: '01-17', feast: 'Hl. Antonius der Einsiedler', display: 'Antonius', alsoOn: { date: '06-13', feast: 'Hl. Antonius von Padua' } },
  sebastian: { date: '01-20', feast: 'Hl. Sebastian', display: 'Sebastian' },
  fabian: { date: '01-20', feast: 'Hl. Fabian', display: 'Fabian' },
  agnes: { date: '01-21', feast: 'Hl. Agnes', display: 'Agnes' },
  vinzenz: { date: '01-22', feast: 'Hl. Vinzenz', display: 'Vinzenz', alsoOn: { date: '09-27', feast: 'Hl. Vinzenz von Paul' } },
  timotheus: { date: '01-26', feast: 'Hl. Timotheus', display: 'Timotheus' },
  titus: { date: '01-26', feast: 'Hl. Titus', display: 'Titus' },
  angela: { date: '01-27', feast: 'Hl. Angela Merici', display: 'Angela' },
  thomas: { date: '07-03', feast: 'Hl. Thomas, Apostel', display: 'Thomas', alsoOn: { date: '01-28', feast: 'Hl. Thomas von Aquin' } },
  martina: { date: '01-30', feast: 'Hl. Martina', display: 'Martina' },
  johannabosco: { date: '01-31', feast: 'Hl. Johannes Bosco', display: 'Don Bosco' },

  // — February —
  brigitta: { date: '02-01', feast: 'Hl. Brigitta von Irland', display: 'Brigitta' },
  blasius: { date: '02-03', feast: 'Hl. Blasius', display: 'Blasius' },
  veronika: { date: '02-04', feast: 'Hl. Veronika', display: 'Veronika' },
  agatha: { date: '02-05', feast: 'Hl. Agatha', display: 'Agatha' },
  dorothea: { date: '02-06', feast: 'Hl. Dorothea', display: 'Dorothea' },
  scholastika: { date: '02-10', feast: 'Hl. Scholastika', display: 'Scholastika' },
  valentin: { date: '02-14', feast: 'Hl. Valentin', display: 'Valentin' },
  faustina: { date: '02-15', feast: 'Hl. Faustina', display: 'Faustina' },
  julian: { date: '02-16', feast: 'Hl. Julian', display: 'Julian' },
  konstantin: { date: '02-17', feast: 'Hl. Konstantin', display: 'Konstantin' },
  petrusdamiani: { date: '02-21', feast: 'Hl. Petrus Damiani', display: 'Petrus Damiani' },
  matthias: { date: '02-24', feast: 'Hl. Matthias, Apostel', display: 'Matthias', alsoOn: { date: '05-14', feast: 'Hl. Matthias (röm. Kalender)' } },
  walburga: { date: '02-25', feast: 'Hl. Walburga', display: 'Walburga' },

  // — March —
  kunigunde: { date: '03-03', feast: 'Hl. Kunigunde', display: 'Kunigunde' },
  kasimir: { date: '03-04', feast: 'Hl. Kasimir', display: 'Kasimir' },
  fridolin: { date: '03-06', feast: 'Hl. Fridolin', display: 'Fridolin' },
  perpetua: { date: '03-07', feast: 'Hl. Perpetua', display: 'Perpetua' },
  felizitas: { date: '03-07', feast: 'Hl. Felizitas', display: 'Felizitas' },
  franziska: { date: '03-09', feast: 'Hl. Franziska von Rom', display: 'Franziska', alsoOn: { date: '10-04', feast: 'Hl. Franz von Assisi' } },
  gregor: { date: '03-12', feast: 'Hl. Gregor der Große', display: 'Gregor', alsoOn: { date: '09-03', feast: 'Hl. Gregor der Große (röm. Kalender)' } },
  klemens: { date: '03-15', feast: 'Hl. Klemens Maria Hofbauer', display: 'Klemens' },
  gertrud: { date: '03-17', feast: 'Hl. Gertrud von Nivelles', display: 'Gertrud', alsoOn: { date: '11-16', feast: 'Hl. Gertrud von Helfta' } },
  patrick: { date: '03-17', feast: 'Hl. Patrick', display: 'Patrick' },
  cyrill: { date: '03-18', feast: 'Hl. Cyrill von Jerusalem', display: 'Cyrill' },
  josef: { date: '03-19', feast: 'Hl. Josef', display: 'Josef' },
  benedikt: { date: '03-21', feast: 'Hl. Benedikt', display: 'Benedikt', alsoOn: { date: '07-11', feast: 'Hl. Benedikt (röm. Kalender)' } },
  hermann: { date: '04-07', feast: 'Hl. Hermann Josef', display: 'Hermann' },

  // — April —
  franzvonpaola: { date: '04-02', feast: 'Hl. Franz von Paola', display: 'Franz von Paola' },
  isidor: { date: '04-04', feast: 'Hl. Isidor', display: 'Isidor' },
  stanislaus: { date: '04-11', feast: 'Hl. Stanislaus', display: 'Stanislaus' },
  bernadette: { date: '04-16', feast: 'Hl. Bernadette', display: 'Bernadette' },
  konrad: { date: '04-21', feast: 'Hl. Konrad von Parzham', display: 'Konrad' },
  anselm: { date: '04-21', feast: 'Hl. Anselm', display: 'Anselm' },
  georg: { date: '04-23', feast: 'Hl. Georg', display: 'Georg' },
  adalbert: { date: '04-23', feast: 'Hl. Adalbert', display: 'Adalbert' },
  fidelis: { date: '04-24', feast: 'Hl. Fidelis', display: 'Fidelis' },
  markus: { date: '04-25', feast: 'Hl. Markus, Evangelist', display: 'Markus' },
  katharinavonsiena: { date: '04-29', feast: 'Hl. Katharina von Siena', display: 'Katharina von Siena' },
  pius: { date: '04-30', feast: 'Hl. Pius V.', display: 'Pius' },

  // — May —
  athanasius: { date: '05-02', feast: 'Hl. Athanasius', display: 'Athanasius' },
  philipp: { date: '05-03', feast: 'Hl. Philippus, Apostel', display: 'Philipp' },
  jakob: { date: '07-25', feast: 'Hl. Jakobus der Ältere', display: 'Jakob', alsoOn: { date: '05-03', feast: 'Hl. Jakobus der Jüngere' } },
  florian: { date: '05-04', feast: 'Hl. Florian', display: 'Florian' },
  gotthard: { date: '05-05', feast: 'Hl. Gotthard', display: 'Gotthard' },
  pankratius: { date: '05-12', feast: 'Hl. Pankratius', display: 'Pankratius' },
  servatius: { date: '05-13', feast: 'Hl. Servatius', display: 'Servatius' },
  sophie: { date: '05-15', feast: 'Hl. Sophie', display: 'Sophie' },
  johannesnepomuk: { date: '05-16', feast: 'Hl. Johannes Nepomuk', display: 'Johannes Nepomuk' },
  bernhardin: { date: '05-20', feast: 'Hl. Bernhardin von Siena', display: 'Bernhardin' },
  rita: { date: '05-22', feast: 'Hl. Rita von Cascia', display: 'Rita' },
  julia: { date: '05-22', feast: 'Hl. Julia', display: 'Julia' },
  beda: { date: '05-25', feast: 'Hl. Beda', display: 'Beda' },
  urban: { date: '05-25', feast: 'Hl. Urban', display: 'Urban' },
  ferdinand: { date: '05-30', feast: 'Hl. Ferdinand', display: 'Ferdinand' },

  // — June —
  justin: { date: '06-01', feast: 'Hl. Justin', display: 'Justin' },
  bonifatius: { date: '06-05', feast: 'Hl. Bonifatius', display: 'Bonifatius' },
  norbert: { date: '06-06', feast: 'Hl. Norbert', display: 'Norbert' },
  barnabas: { date: '06-11', feast: 'Hl. Barnabas', display: 'Barnabas' },
  vitus: { date: '06-15', feast: 'Hl. Vitus (Veit)', display: 'Vitus' },
  romuald: { date: '06-19', feast: 'Hl. Romuald', display: 'Romuald' },
  juliana: { date: '06-19', feast: 'Hl. Juliana', display: 'Juliana' },
  alois: { date: '06-21', feast: 'Hl. Aloisius', display: 'Alois' },
  paulinus: { date: '06-22', feast: 'Hl. Paulinus', display: 'Paulinus' },
  johannes: { date: '06-24', feast: 'Hl. Johannes der Täufer', display: 'Johannes', alsoOn: { date: '12-27', feast: 'Hl. Johannes, Evangelist' } },
  hemma: { date: '06-27', feast: 'Hl. Hemma von Gurk', display: 'Hemma' },
  irenaeus: { date: '06-28', feast: 'Hl. Irenäus', display: 'Irenäus' },
  peter: { date: '06-29', feast: 'Hl. Petrus, Apostel', display: 'Peter' },
  paul: { date: '06-29', feast: 'Hl. Paulus, Apostel', display: 'Paul', alsoOn: { date: '01-25', feast: 'Pauli Bekehrung' } },

  // — July —
  theobald: { date: '07-01', feast: 'Hl. Theobald', display: 'Theobald' },
  ulrich: { date: '07-04', feast: 'Hl. Ulrich', display: 'Ulrich' },
  heinrich: { date: '07-13', feast: 'Hl. Heinrich', display: 'Heinrich' },
  bonaventura: { date: '07-15', feast: 'Hl. Bonaventura', display: 'Bonaventura' },
  carmen: { date: '07-16', feast: 'Maria vom Berge Karmel', display: 'Carmen' },
  margareta: { date: '07-20', feast: 'Hl. Margareta', display: 'Margareta' },
  magdalena: { date: '07-22', feast: 'Hl. Maria Magdalena', display: 'Magdalena' },
  birgitta: { date: '07-23', feast: 'Hl. Birgitta von Schweden', display: 'Birgitta' },
  christoph: { date: '07-24', feast: 'Hl. Christophorus', display: 'Christoph' },
  christina: { date: '07-24', feast: 'Hl. Christina', display: 'Christina' },
  anna: { date: '07-26', feast: 'Hl. Anna', display: 'Anna' },
  joachim: { date: '07-26', feast: 'Hl. Joachim', display: 'Joachim' },
  marta: { date: '07-29', feast: 'Hl. Marta', display: 'Marta' },
  ignaz: { date: '07-31', feast: 'Hl. Ignatius von Loyola', display: 'Ignaz' },

  // — August —
  alfons: { date: '08-01', feast: 'Hl. Alfons', display: 'Alfons' },
  dominik: { date: '08-08', feast: 'Hl. Dominikus', display: 'Dominik' },
  laurenz: { date: '08-10', feast: 'Hl. Laurentius', display: 'Laurenz' },
  klara: { date: '08-11', feast: 'Hl. Klara', display: 'Klara' },
  maximilian: { date: '08-14', feast: 'Hl. Maximilian Kolbe', display: 'Maximilian' },
  // Maria: the name day proper is Mariä Namen; Mariä Himmelfahrt is the public
  // holiday and is what many Austrian Marias are actually congratulated on.
  // Which of the two a family keeps is a family fact — hence alsoOn.
  maria: { date: '09-12', feast: 'Mariä Namen', display: 'Maria', alsoOn: { date: '08-15', feast: 'Mariä Himmelfahrt' } },
  rochus: { date: '08-16', feast: 'Hl. Rochus', display: 'Rochus' },
  stefan: { date: '12-26', feast: 'Hl. Stefan', display: 'Stefan', alsoOn: { date: '08-16', feast: 'Hl. Stefan von Ungarn' } },
  helena: { date: '08-18', feast: 'Hl. Helena', display: 'Helena' },
  bernhard: { date: '08-20', feast: 'Hl. Bernhard von Clairvaux', display: 'Bernhard' },
  rosa: { date: '08-23', feast: 'Hl. Rosa von Lima', display: 'Rosa' },
  bartholomaeus: { date: '08-24', feast: 'Hl. Bartholomäus, Apostel', display: 'Bartholomäus' },
  ludwig: { date: '08-25', feast: 'Hl. Ludwig', display: 'Ludwig' },
  monika: { date: '08-27', feast: 'Hl. Monika', display: 'Monika' },
  augustin: { date: '08-28', feast: 'Hl. Augustinus', display: 'Augustin' },
  sabina: { date: '08-29', feast: 'Hl. Sabina', display: 'Sabina' },
  felix: { date: '08-30', feast: 'Hl. Felix', display: 'Felix' },

  // — September —
  verena: { date: '09-01', feast: 'Hl. Verena', display: 'Verena' },
  aegidius: { date: '09-01', feast: 'Hl. Ägidius', display: 'Ägidius' },
  regina: { date: '09-07', feast: 'Hl. Regina', display: 'Regina' },
  notburga: { date: '09-13', feast: 'Hl. Notburga', display: 'Notburga' },
  dolores: { date: '09-15', feast: 'Mariä Schmerzen', display: 'Dolores' },
  kornelius: { date: '09-16', feast: 'Hl. Kornelius', display: 'Kornelius' },
  hildegard: { date: '09-17', feast: 'Hl. Hildegard von Bingen', display: 'Hildegard' },
  lambert: { date: '09-17', feast: 'Hl. Lambert', display: 'Lambert' },
  matthaeus: { date: '09-21', feast: 'Hl. Matthäus, Evangelist', display: 'Matthäus' },
  robert: { date: '09-17', feast: 'Hl. Robert Bellarmin', display: 'Robert' },
  moritz: { date: '09-22', feast: 'Hl. Mauritius', display: 'Moritz' },
  thekla: { date: '09-23', feast: 'Hl. Thekla', display: 'Thekla' },
  rupert: { date: '09-24', feast: 'Hl. Rupert', display: 'Rupert' },
  kosmas: { date: '09-26', feast: 'Hl. Kosmas', display: 'Kosmas' },
  damian: { date: '09-26', feast: 'Hl. Damian', display: 'Damian' },
  wenzel: { date: '09-28', feast: 'Hl. Wenzel', display: 'Wenzel' },
  michael: { date: '09-29', feast: 'Hl. Michael, Erzengel', display: 'Michael' },
  gabriel: { date: '09-29', feast: 'Hl. Gabriel, Erzengel', display: 'Gabriel' },
  raphael: { date: '09-29', feast: 'Hl. Raphael, Erzengel', display: 'Raphael' },
  hieronymus: { date: '09-30', feast: 'Hl. Hieronymus', display: 'Hieronymus' },

  // — October —
  therese: { date: '10-01', feast: 'Hl. Therese von Lisieux', display: 'Therese', alsoOn: { date: '10-15', feast: 'Hl. Theresia von Avila' } },
  franz: { date: '10-04', feast: 'Hl. Franz von Assisi', display: 'Franz' },
  bruno: { date: '10-06', feast: 'Hl. Bruno', display: 'Bruno' },
  dionys: { date: '10-09', feast: 'Hl. Dionysius', display: 'Dionys' },
  theresia: { date: '10-15', feast: 'Hl. Theresia von Avila', display: 'Theresia' },
  hedwig: { date: '10-16', feast: 'Hl. Hedwig', display: 'Hedwig' },
  gallus: { date: '10-16', feast: 'Hl. Gallus', display: 'Gallus' },
  lukas: { date: '10-18', feast: 'Hl. Lukas, Evangelist', display: 'Lukas' },
  ursula: { date: '10-21', feast: 'Hl. Ursula', display: 'Ursula' },
  kordula: { date: '10-22', feast: 'Hl. Kordula', display: 'Kordula' },
  simon: { date: '10-28', feast: 'Hl. Simon, Apostel', display: 'Simon' },
  judas: { date: '10-28', feast: 'Hl. Judas Thaddäus', display: 'Judas Thaddäus' },
  wolfgang: { date: '10-31', feast: 'Hl. Wolfgang', display: 'Wolfgang' },

  // — November —
  hubert: { date: '11-03', feast: 'Hl. Hubertus', display: 'Hubert' },
  silvia: { date: '11-03', feast: 'Hl. Silvia', display: 'Silvia' },
  karl: { date: '11-04', feast: 'Hl. Karl Borromäus', display: 'Karl' },
  emmerich: { date: '11-05', feast: 'Hl. Emmerich', display: 'Emmerich' },
  leonhard: { date: '11-06', feast: 'Hl. Leonhard', display: 'Leonhard' },
  gottfried: { date: '11-08', feast: 'Hl. Gottfried', display: 'Gottfried' },
  theodor: { date: '11-09', feast: 'Hl. Theodor', display: 'Theodor' },
  leo: { date: '11-10', feast: 'Hl. Leo der Große', display: 'Leo' },
  martin: { date: '11-11', feast: 'Hl. Martin von Tours', display: 'Martin' },
  christian: { date: '11-12', feast: 'Hl. Christian', display: 'Christian' },
  leopold: { date: '11-15', feast: 'Hl. Leopold', display: 'Leopold' },
  // Elisabeth: kept on 19 November in the Austrian calendar; the revised Roman
  // calendar moved it to the 17th and both are in everyday use here.
  elisabeth: { date: '11-19', feast: 'Hl. Elisabeth von Thüringen', display: 'Elisabeth', alsoOn: { date: '11-17', feast: 'Hl. Elisabeth (röm. Kalender)' } },
  caecilia: { date: '11-22', feast: 'Hl. Cäcilia', display: 'Cäcilia' },
  kolumban: { date: '11-23', feast: 'Hl. Kolumban', display: 'Kolumban' },
  katharina: { date: '11-25', feast: 'Hl. Katharina von Alexandrien', display: 'Katharina', alsoOn: { date: '04-29', feast: 'Hl. Katharina von Siena' } },
  andreas: { date: '11-30', feast: 'Hl. Andreas, Apostel', display: 'Andreas' },

  // — December —
  xaver: { date: '12-03', feast: 'Hl. Franz Xaver', display: 'Xaver' },
  barbara: { date: '12-04', feast: 'Hl. Barbara', display: 'Barbara' },
  nikolaus: { date: '12-06', feast: 'Hl. Nikolaus', display: 'Nikolaus' },
  ambros: { date: '12-07', feast: 'Hl. Ambrosius', display: 'Ambros' },
  damasus: { date: '12-11', feast: 'Hl. Damasus', display: 'Damasus' },
  luzia: { date: '12-13', feast: 'Hl. Luzia', display: 'Luzia' },
  adam: { date: '12-24', feast: 'Adam und Eva', display: 'Adam' },
  eva: { date: '12-24', feast: 'Adam und Eva', display: 'Eva' },
  silvester: { date: '12-31', feast: 'Hl. Silvester', display: 'Silvester' },
};

/* Spellings, national forms and the diminutives Austrians actually use, mapped
 * to the catalogued name. A Sepp is a Josef; a Hansi is a Johannes; an English
 * Joseph or an Italian Giuseppe keeps the same saint's day. Anything not here
 * and not in CALENDAR gets no suggestion at all — which is the correct answer
 * far more often than it looks. */
const ALIASES: Record<string, string> = {
  // Josef
  joseph: 'josef', jozef: 'josef', giuseppe: 'josef', jose: 'josef', pepi: 'josef',
  sepp: 'josef', seppl: 'josef', josefa: 'josef', josefine: 'josef', josephine: 'josef',
  // Johannes
  johann: 'johannes', hans: 'johannes', hansi: 'johannes', jonas: 'johannes', jan: 'johannes',
  john: 'johannes', jean: 'johannes', juan: 'johannes', ivan: 'johannes', janos: 'johannes',
  johanna: 'johannes', hanna: 'johannes', hannah: 'johannes', jana: 'johannes', jane: 'johannes',
  giovanni: 'johannes', sean: 'johannes', shane: 'johannes', ian: 'johannes',
  // Maria
  marie: 'maria', mary: 'maria', mia: 'maria', mimi: 'maria', mariam: 'maria', miriam: 'maria',
  marion: 'maria', marika: 'maria', mariella: 'maria', marianne: 'maria', mariska: 'maria',
  // Peter / Paul
  petra: 'peter', pieter: 'peter', pietro: 'peter', pedro: 'peter', petrus: 'peter',
  paula: 'paul', pauline: 'paul', paulus: 'paul', paolo: 'paul', pablo: 'paul',
  // Franz
  francis: 'franz', francesco: 'franz', francisco: 'franz', frank: 'franz', franzi: 'franz',
  fanny: 'franziska', francesca: 'franziska', frances: 'franziska', francoise: 'franziska',
  // Katharina
  katharine: 'katharina', catherine: 'katharina', catharina: 'katharina', katrin: 'katharina',
  kathrin: 'katharina', katja: 'katharina', kati: 'katharina', kate: 'katharina', katie: 'katharina',
  Klara: 'katharina', caren: 'katharina', karen: 'katharina', kathleen: 'katharina', caitlin: 'katharina',
  // Elisabeth
  elizabeth: 'elisabeth', elsa: 'elisabeth', else: 'elisabeth', lisa: 'elisabeth', liesl: 'elisabeth',
  liesbeth: 'elisabeth', betty: 'elisabeth', beth: 'elisabeth', bettina: 'elisabeth', sissi: 'elisabeth',
  isabel: 'elisabeth', isabella: 'elisabeth', elise: 'elisabeth', eliza: 'elisabeth', ilse: 'elisabeth',
  // Anna
  anne: 'anna', ann: 'anna', anita: 'anna', anja: 'anna', annika: 'anna', annemarie: 'anna',
  nina: 'anna', nancy: 'anna', anouk: 'anna', anka: 'anna',
  // Michael / Gabriel / Raphael
  michaela: 'michael', michel: 'michael', michele: 'michael', mikael: 'michael', mischa: 'michael',
  micha: 'michael', mike: 'michael', miguel: 'michael', michal: 'michael',
  gabriele: 'gabriel', gabriela: 'gabriel', gabi: 'gabriel', gabrielle: 'gabriel',
  raffael: 'raphael', rafael: 'raphael', rafaela: 'raphael',
  // Martin
  maarten: 'martin', martino: 'martin', martijn: 'martin',
  // Georg
  george: 'georg', jorge: 'georg', jurgen: 'georg', juergen: 'georg', georgia: 'georg',
  georgina: 'georg', gjorgji: 'georg', jiri: 'georg', gyorgy: 'georg', schorsch: 'georg',
  // Andreas
  andrew: 'andreas', andre: 'andreas', andrea: 'andreas', andrej: 'andreas', andi: 'andreas',
  andras: 'andreas', anders: 'andreas',
  // Stefan
  stephan: 'stefan', stephen: 'stefan', steven: 'stefan', steffen: 'stefan', steve: 'stefan',
  stefanie: 'stefan', stephanie: 'stefan', steffi: 'stefan', istvan: 'stefan', etienne: 'stefan',
  // Thomas
  tom: 'thomas', tommy: 'thomas', tomas: 'thomas', tommaso: 'thomas', tamas: 'thomas',
  // Jakob
  jacob: 'jakob', jacobus: 'jakob', james: 'jakob', jamie: 'jakob', jacques: 'jakob',
  giacomo: 'jakob', diego: 'jakob', jacoba: 'jakob', koby: 'jakob',
  // Markus / Matthäus / Matthias
  marcus: 'markus', marco: 'markus', marc: 'markus', mark: 'markus', marko: 'markus',
  matthaus: 'matthaeus', matthew: 'matthaeus', matteo: 'matthaeus', mateo: 'matthaeus',
  mathias: 'matthias', mats: 'matthias', matze: 'matthias',
  // Nikolaus
  nikolas: 'nikolaus', nicolas: 'nikolaus', nicholas: 'nikolaus', nick: 'nikolaus',
  niklas: 'nikolaus', nico: 'nikolaus', nikola: 'nikolaus', klaus: 'nikolaus', claus: 'nikolaus',
  colin: 'nikolaus', nicole: 'nikolaus', nikolai: 'nikolaus',
  // Christoph / Christina / Christian
  christopher: 'christoph', christophe: 'christoph', chris: 'christoph', kristof: 'christoph',
  cristina: 'christina', kristina: 'christina', kirsten: 'christina', kerstin: 'christina',
  tina: 'christina', christine: 'christina', kristin: 'christina',
  christiane: 'christian', kristian: 'christian', carsten: 'christian', karsten: 'christian',
  // Barbara
  barbra: 'barbara', barbi: 'barbara', babsi: 'barbara', varvara: 'barbara',
  // Theresia / Therese
  teresa: 'therese', theresa: 'therese', tereza: 'therese', resi: 'theresia', tessa: 'therese',
  // Magdalena
  magdalene: 'magdalena', lena: 'magdalena', leni: 'magdalena', madeleine: 'magdalena',
  maddalena: 'magdalena', magda: 'magdalena',
  // Margareta
  margarete: 'margareta', margarethe: 'margareta', margarita: 'margareta', margit: 'margareta',
  margret: 'margareta', greta: 'margareta', gretl: 'margareta', gretchen: 'margareta',
  daisy: 'margareta', margot: 'margareta', 
  // Sophie
  sophia: 'sophie', sofia: 'sophie', sofie: 'sophie', sonja: 'sophie',
  // Klara
  clara: 'klara', claire: 'klara', chiara: 'klara', klarissa: 'klara',
  // Ludwig / Leopold / Leo / Leonhard
  louis: 'ludwig', luis: 'ludwig', lewis: 'ludwig', lutz: 'ludwig', luigi: 'ludwig',
  ludovica: 'ludwig', luise: 'ludwig', louise: 'ludwig', lois: 'ludwig',
  poldi: 'leopold', leopoldine: 'leopold',
  leon: 'leo', lion: 'leo', leonie: 'leo', leona: 'leo',
  leonard: 'leonhard', lenny: 'leonhard', lennard: 'leonhard',
  // Lukas
  luca: 'lukas', lucas: 'lukas', luke: 'lukas', 
  // Simon / Sebastian
  simone: 'simon', szymon: 'simon', simeon: 'simon',
  basti: 'sebastian', bastian: 'sebastian', sebastiano: 'sebastian',
  // Anton / Antonius
  anton: 'antonius', antonia: 'antonius', antonio: 'antonius', toni: 'antonius', tonia: 'antonius',
  antoinette: 'antonius', antal: 'antonius',
  // Alois
  aloisia: 'alois', aloys: 'alois',
  // Heinrich / Hermann / Hubert
  henry: 'heinrich', henrik: 'heinrich', heinz: 'heinrich', harry: 'heinrich', henrietta: 'heinrich',
  enrico: 'heinrich', hendrik: 'heinrich',
  hubertus: 'hubert', huberta: 'hubert',
  // Karl
  carl: 'karl', charles: 'karl', carlo: 'karl', carlos: 'karl', carla: 'karl', karla: 'karl',
  charlotte: 'karl', karoline: 'karl', caroline: 'karl', karolina: 'karl', karli: 'karl',
  // Ferdinand / Florian / Felix
  ferdi: 'ferdinand', fernando: 'ferdinand',
  flo: 'florian', floriane: 'florian', flora: 'florian',
  felicia: 'felix', felizia: 'felix',
  // Wolfgang / Werner-ish
  wolfi: 'wolfgang', wolf: 'wolfgang',
  // Rosa / Regina / Rita
  rose: 'rosa', rosalia: 'rosa', rosi: 'rosa', roswitha: 'rosa', rosemarie: 'rosa',
  regine: 'regina',
  // Ursula / Veronika / Verena
  uschi: 'ursula', ulla: 'ursula',
  vroni: 'veronika', verona: 'veronika',
  // Valentin / Vinzenz / Vitus
  valentina: 'valentin', valentine: 'valentin',
  vincent: 'vinzenz', vincenzo: 'vinzenz',
  veit: 'vitus',
  // Dominik / Damian / David-less
  dominic: 'dominik', domenico: 'dominik', dominika: 'dominik',
  // Gertrud / Hedwig / Helena
  trude: 'gertrud', traudl: 'gertrud',
  helene: 'helena', helen: 'helena', ilona: 'helena', jelena: 'helena', 
  // Agnes / Agatha / Angela
  agneta: 'agnes', ines: 'agnes', inez: 'agnes', neza: 'agnes',
  agathe: 'agatha',
  angelika: 'angela', angelina: 'angela', angel: 'angela', angie: 'angela',
  // Cäcilia / Silvia / Silvester
  caecilie: 'caecilia', cecilia: 'caecilia', cilli: 'caecilia',
  sylvia: 'silvia', silke: 'silvia',
  sylvester: 'silvester',
  // Rupert / Wenzel / Moritz
  ruppert: 'rupert', 
  vaclav: 'wenzel',
  maurice: 'moritz', mauritius: 'moritz',
  // Bernhard / Benedikt
  bernd: 'bernhard', bernie: 'bernhard', bernardo: 'bernhard', bernadett: 'bernadette',
  benedict: 'benedikt', benedetto: 'benedikt', bene: 'benedikt', benno: 'benedikt',
  // Emmerich / Ernst / Eva / Adam
  imre: 'emmerich',
  ernest: 'ernst', ernestine: 'ernst',
  evi: 'eva', evelyn: 'eva', eve: 'eva', chava: 'eva',
  // Notburga / Hildegard / Hemma
  hilde: 'hildegard', hildegund: 'hildegard',
  emma: 'hemma', gemma: 'hemma',
  // Ignaz / Isidor / Irene
  ignatius: 'ignaz', ignatz: 'ignaz', inigo: 'ignaz',
  // Kunigunde / Konrad / Kasimir
  kuni: 'kunigunde',
  kurt: 'konrad', conrad: 'konrad', konni: 'konrad',
  casimir: 'kasimir',
};

/* Normalise a written name to a lookup key.
 *
 * Two forms are produced because German has two competing conventions and
 * people use both when typing: "Jürgen" is written jurgen by anyone stripping
 * accents and juergen by anyone transliterating properly. Trying both means a
 * name typed either way still finds its day, and neither form can invent a
 * match that isn't in the table. */
function normalizeForms(raw: string): string[] {
  const base = raw
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}]/gu, '');
  if (!base) return [];

  const transliterated = base
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const stripped = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

  return Array.from(new Set([transliterated, stripped].filter(Boolean)));
}

function lookupOne(token: string): { key: string; entry: Entry } | null {
  for (const form of normalizeForms(token)) {
    const direct = CALENDAR[form];
    if (direct) return { key: form, entry: direct };
    const via = ALIASES[form];
    if (via && CALENDAR[via]) return { key: via, entry: CALENDAR[via] };
  }
  return null;
}

/**
 * The name day this person's name suggests, or null when the calendar has
 * nothing for it — which is the honest answer for most non-European names and
 * must be shown as such, never filled in with something that rhymes.
 *
 * Tries the first name first (that is what a name day belongs to), then any
 * further given names, then the nickname last: a "Sepp" whose passport says
 * Josef should match on the passport name, but a "Mia" recorded only as a
 * nickname should still find Maria.
 */
export function suggestNameDay(fullName?: string, nickname?: string): NameDaySuggestion | null {
  const tokens = String(fullName || '').split(/[\s\-–]+/).filter(Boolean);
  const candidates = [...tokens, ...String(nickname || '').split(/[\s\-–]+/).filter(Boolean)];

  for (const token of candidates) {
    const hit = lookupOne(token);
    if (hit) {
      return {
        date: hit.entry.date,
        feast: hit.entry.feast,
        matched: hit.entry.display,
        alsoOn: hit.entry.alsoOn,
      };
    }
  }
  return null;
}

/** True for a well-formed recurring month-day, e.g. '03-19'. */
export function isValidNameDay(value?: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1) return false;
  // A name day is a slot in the church calendar, so 29 February is legitimate
  // and simply lands on the 28th in ordinary years (see occurrenceInYear).
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= maxDay;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '03-19' → '19 March'. Returns '' for anything malformed rather than 'NaN undefined'. */
export function formatNameDay(value?: string): string {
  if (!isValidNameDay(value)) return '';
  const [m, d] = String(value).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** Whole days from `today` to the next occurrence of this month-day (0 = today). */
export function daysUntilNameDay(value: string, today: Date = new Date()): number | null {
  if (!isValidNameDay(value)) return null;
  const [m, d] = value.split('-').map(Number);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Same Feb-29 convention as OnThisDay's occurrenceInYear: collapse to the
  // 28th in ordinary years instead of letting Date roll it into March.
  const occurrence = (year: number): Date => {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return m === 2 && d === 29 && !leap ? new Date(year, 1, 28) : new Date(year, m - 1, d);
  };

  let next = occurrence(t0.getFullYear());
  if (next.getTime() < t0.getTime()) next = occurrence(t0.getFullYear() + 1);
  return Math.round((next.getTime() - t0.getTime()) / 86400000);
}

/**
 * What to show for a member, in one call.
 *
 * `stored` is a fact the family put there and is what gets celebrated — the
 * daily notification cron reads exactly this field off the member document.
 * `suggested` is this table's guess and is never celebrated, only offered.
 * Keeping the two apart in the return type is deliberate: every surface that
 * displays a name day has to decide which it is looking at, and cannot
 * accidentally treat a lookup as something the family confirmed.
 */
export function resolveNameDay(
  member: { name?: string; nickname?: string; nameDay?: string; nameDayFeast?: string },
): { date: string; feast?: string; source: 'stored' } | { suggestion: NameDaySuggestion; source: 'suggested' } | null {
  if (member.nameDay && isValidNameDay(member.nameDay)) {
    return { date: member.nameDay, feast: member.nameDayFeast, source: 'stored' };
  }
  const suggestion = suggestNameDay(member.name, member.nickname);
  return suggestion ? { suggestion, source: 'suggested' } : null;
}

/** How many names the calendar knows — used by the test to catch a truncated table. */
export const NAME_DAY_CATALOG_SIZE = Object.keys(CALENDAR).length + Object.keys(ALIASES).length;
