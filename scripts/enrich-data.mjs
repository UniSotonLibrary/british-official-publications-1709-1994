/**
 * Stage 1: Analyse subjects, build ~20 research themes, enrich publications CSV.
 * Run: node scripts/enrich-data.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");

const PUBLICATIONS_IN = path.join(
  ROOT,
  "british_official_publications_descriptive_metadata.csv"
);
const SUBJECTS_IN = path.join(ROOT, "top_subject_frequencies.csv");
const BATCH_IN = path.join(ROOT, "top_subject_frequencies_themes_batch.csv");

const MAPPING_OUT = path.join(DATA, "theme_mapping.csv");
const ENRICHED_OUT = path.join(
  DATA,
  "british_official_publications_enriched.csv"
);

const THEMES = [
  "Land & Property",
  "Agriculture & Rural Affairs",
  "Health & Public Health",
  "Education",
  "Justice, Crime & Prisons",
  "Government & Administration",
  "Parliament & Legislation",
  "Economy, Finance & Taxation",
  "Trade, Industry & Employment",
  "Transport & Infrastructure",
  "Housing & Urban Development",
  "Social Welfare & Poverty",
  "Defence & Military",
  "Religion & Church",
  "Environment & Natural Resources",
  "Science, Technology & Communications",
  "Population & Demography",
  "International Affairs & Empire",
  "Culture & Heritage",
  "Other",
];

/** Parse RFC4180-ish CSV into array of row objects. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }

    if (ch === "\r") {
      i += 1;
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  return rows
    .filter((r) => r.some((cell) => cell.trim() !== ""))
    .map((cells) => {
      const obj = {};
      header.forEach((key, idx) => {
        obj[key] = cells[idx] ?? "";
      });
      return obj;
    });
}

function escapeCsv(value) {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(filePath, header, rows) {
  const lines = [header.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(header.map((col) => escapeCsv(row[col])).join(","));
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function normaliseSubject(subject) {
  return (subject || "").trim();
}

function classifyIndexTerm(term) {
  const t = (term || "").toLowerCase();
  if (!t.startsWith("irish papers -")) return null;

  if (/health|medical|hospital|nurse/.test(t)) return "Health & Public Health";
  if (/education|school|universit/.test(t)) return "Education";
  if (/land|landlord|tenant|congested/.test(t)) return "Land & Property";
  if (/agricultur|fisher|famine|farming/.test(t)) return "Agriculture & Rural Affairs";
  if (/legal|police|law|crime|riot|rising|civil order/.test(t))
    return "Justice, Crime & Prisons";
  if (/trade|industr|commerce|manufactur/.test(t))
    return "Trade, Industry & Employment";
  if (/transport|rail|road|harbour|shipping|coal|fuel|power|water/.test(t))
    return "Transport & Infrastructure";
  if (/government|parliament|election/.test(t)) return "Government & Administration";
  if (/finance|tax|revenue|treasury/.test(t)) return "Economy, Finance & Taxation";
  if (/poor law|social insurance|welfare|charit/.test(t))
    return "Social Welfare & Poverty";
  if (/church|religion|tithes/.test(t)) return "Religion & Church";
  if (/population|emigration|immigration|census/.test(t))
    return "Population & Demography";
  if (/defence|military|army/.test(t)) return "Defence & Military";
  if (/culture|museum|library|heritage|learned/.test(t)) return "Culture & Heritage";
  if (/public works|drainage|local government/.test(t))
    return "Government & Administration";
  return null;
}

const LEGACY_THEME_MAP = {
  "Agriculture & Fisheries": "Agriculture & Rural Affairs",
  "Justice & Law": "Justice, Crime & Prisons",
  "Economy & Finance": "Economy, Finance & Taxation",
  "Trade & Industry": "Trade, Industry & Employment",
  "Science & Technology": "Science, Technology & Communications",
  "Population & Census": "Population & Demography",
};

function normaliseTheme(theme) {
  const mapped = LEGACY_THEME_MAP[theme] || theme;
  return THEMES.includes(mapped) ? mapped : "Other";
}

function isLandSubject(lower) {
  return (
    /land tenure|landlord and tenant|land reform|land use|land titles|land surveys|real property|landowners|crown lands|public lands|reclamation of land|school lands|home rule|congested districts/.test(
      lower
    ) ||
    /\beviction\b|\brent\b|\bencumbrances\b|\bseparate property\b|\bcommunity property\b|\btenant right\b|\bmanor courts\b|\bland reform\b/.test(
      lower
    )
  );
}

function classifySubject(subject) {
  const s = normaliseSubject(subject);
  if (!s || /^#+$/.test(s)) return "Other";
  const lower = s.toLowerCase();

  const rules = [
    {
      theme: "Parliament & Legislation",
      test: () =>
        /parliament|parliamentary|legislator|election district|privileges and immunities|publication of proceedings/.test(
          lower
        ) ||
        s === "Great Britain.Parliament - Elections." ||
        s === "Parliamentary.",
    },
    {
      theme: "Defence & Military",
      test: () =>
        /armed forces|military|world war|recruiting,enlistment|military supplies|military policy|military special/.test(
          lower
        ),
    },
    {
      theme: "International Affairs & Empire",
      test: () =>
        /foreign relations|foreign economic relations|colonies|colonization|international economic|economic assistance, british|developing countries/.test(
          lower
        ) ||
        s === "Great Britain - Colonies." ||
        s === "Colonies etc. (British)",
    },
    {
      theme: "Health & Public Health",
      test: () =>
        /public health|medical care|medical statistics|medical personnel|medical social work|hospital|physician|nurse|mental health|dental|health education|state medicine|primary health care|health services for the aged|national health service|mentally handicapped|deafness|geriatrics|breast feeding|infant food|health\b/.test(
          lower
        ),
    },
    {
      theme: "Education",
      test: () =>
        /education|school|universit|college|teacher|scholar|curricula|examinations|students|academic|vocational education|compulsory|textbook|learned institutions and societies|intermediate education board|commissioners of national education|commissioners of education|royal university|national university|intermediate education board|magee university|royal belfast academical|foundling hospital \(dublin|education of women|private schools|post-compulsory education|government aid to education|handicapped children - education|deaf - education|art - study and teaching|handicraft - study and teaching|irish academy of music|government aid to music education|science - study and teaching/.test(
          lower
        ) &&
        !/military education/.test(lower),
    },
    {
      theme: "Justice, Crime & Prisons",
      test: () =>
        /justice,administration|criminal|prison|police|court|law reform|legal aid|procedure \(law\)|juries|judicial statistics|criminal statistics|punishment|crime|political crimes|subversive activities|sedition|conspiracy|imprisonment|debt, imprisonment|libel and slander|sex crimes|liquor laws|factory laws|food law and legislation|industrial laws and legislation|marriage law|emigration and immigration law|corporation law|administrative courts|corn laws|heating - law and legislation|metal recycling - law and legislation|public libraries - law and legislation|trademarks - law and legislation|weights and measures - law and legislation|clubs - law and legislation|fairs - law and legislation|markets - law and legislation|school buildings - law and legislation|examinations - law and legislation|dogs - law and legislation|excise tax - law and legislation|customs administration - law and legislation|corporations - accounting - law and legislation|law\b|law,|law -|legal administration|drunkenness \(criminal law\)|soccer hooliganism|correctional institutions|criminal procedure|criminal courts|venue\b|law - ireland/.test(
          lower
        ) ||
        s === "Crime, police, gaols and punishment - England.",
    },
    {
      theme: "Religion & Church",
      test: () =>
        /church and state|church property|church schools|church buildings|catholic|protestant|presbyterian|clergy|tithes|orangemen|laity - catholic|religious education|church and education|saint patrick's day|royal catholic college|maynooth|catholic union|hibernian society|sunday\b/.test(
          lower
        ),
    },
    {
      theme: "Agriculture & Rural Affairs",
      test: () =>
        /agricultur|fisher|forests and forestry|forest policy|famine,1845-52|farming|livestock|cattle trade|game and game-birds|game laws|botanical gardens|malt industry|grain\b|food supply|food contamination|food adulteration|food prices|bread\b|inclosures|reclamation of land|woods, forests, land revenues|agricultural prices|agricultural colleges|agricultural education|rural population|rural transportation/.test(
          lower
        ) &&
        !/food law and legislation/.test(lower),
    },
    {
      theme: "Transport & Infrastructure",
      test: () =>
        /transport|railroad|railways|roads\b|shipping|harbors|harbour|canals|inland navigation|postal service|telegraph|broadcasting|aeronautics|automotive|automobile|motorway|electric lighting|communication -|telecommunications|channel tunnel|traffic safety|pedestrians|shore protection|truck system|rural transportation|transportation and state|transportation -/.test(
          lower
        ),
    },
    {
      theme: "Environment & Natural Resources",
      test: () =>
        /environmental|pollution|natural resources|water-supply|coal mines and mining|natural gas|nuclear energy|geological surveys|museum of practical geology|drainage - great britain|smoke prevention|pollution prevention|environmental protection|power resources|energy policy|coal - great britain|coal\b - great britain|waste lands|shore protection/.test(
          lower
        ),
    },
    {
      theme: "Science, Technology & Communications",
      test: () =>
        /science|technology|research|inventions|patents|social surveys|social sciences - research|engineering - research|telecommunications policy|science and state|technology and state|science - societies|science museums|communication - great britain|communication - ireland/.test(
          lower
        ) &&
        !/social security - statistics/.test(lower),
    },
    {
      theme: "Economy, Finance & Taxation",
      test: () =>
        /finance,public|financial institutions|taxation|bankruptcy|debt\b|banks and banking|local finance|local taxation|appropriations and expenditures|economic conditions|economic policy|money\b|income tax|excise tax|internal revenue|customs administration|tax assessment|tax collection|tax refunds|commercial credit|commercial loans|annuities|pension trusts - accounting|museum finance|economic assistance|banking, coinage|finance, civil list|finance\b|currency question|debts, public|european economic community|cost and standard of living|public accounts|consolidation and merger|restraint of trade|monopolies|store hours|lotteries|gambling|malt industry - ireland|savings and loan|friendly societies - ireland|money - ireland|partnership - ireland|bills of sale|smuggling|customhouses|gas companies|gas manufacture|electric utilities|electric power|credit\b|exports|imports|national income - statistics|finance - ireland|public finance/.test(
          lower
        ) &&
        !/education - finance|universities and colleges - finance|schools - ireland - accounting|museum finance - ireland|intermediate education board for ireland - accounting|royal university of ireland - accounting|church schools - ireland - finance|government aid to education/.test(
          lower
        ),
    },
    {
      theme: "Trade, Industry & Employment",
      test: () =>
        /industr|labor\b|labour|employment|wages|unemployment|trade-unions|trade regulation|commerce|manufacturing|industrial relations|industrial policy|industrial hygiene|industrial safety|industrial productivity|industrial promotion|industrial statistics|industrial accidents|industrialization|coal trade|firearms industry|construction industry|automobile industry|handicapped - employment|women - employment|youth - employment|manpower|labor supply|labor mobility|labour mobility|labour - cost|retraining, occupational|employees|employers' liability|truck system|shift systems|vacations,employee|construction workers|directors of corporations|professions|slave-trade|handicraft|licenses - ireland|license system|industries -|trade schools|restaurant|hotels, taverns|store hours|monopolies - great britain|commercial law|great britain - commerce|ireland - commerce|sugar trade|cattle trade|malt industry|alcoholic beverage industry|food supply - ireland|markets - ireland|fairs - ireland|industrial laws and legislation - ireland|trade\b/.test(
          lower
        ),
    },
    {
      theme: "Social Welfare & Poverty",
      test: () =>
        /poor laws|public welfare|social security|charities|child welfare|pensions\b|old age|workhouse|orphans|foundlings|social work|income maintenance|income maintainance|public welfare - great britain|public welfare - ireland|public welfare - scotland|public welfare - holland|public welfare - belgium|youth - services|homeless|homelessness|lodging-houses|visiting housekeepers|day care centers|child labor|poor\b|single people|refugees|consumer protection|child welfare - scotland|child welfare - ireland|handicapped - great britain|handicapped\b|wheelchairs|youth workers|social welfare|friendly societies - great britain|pension trusts - ireland|annuities - ireland|public welfare - administration|public welfare - officials/.test(
          lower
        ),
    },
    {
      theme: "Housing & Urban Development",
      test: () =>
        /housing|city planning|urban renewal|regional planning|rental housing|homelessness|homeless persons|aged - dwellings|leisure - .* planning|family planning|cities and towns|town planning|urban\b/.test(
          lower
        ) &&
        !/teachers - housing|clergy - housing|elementary school teachers - housing|college buildings/.test(
          lower
        ),
    },
    {
      theme: "Land & Property",
      test: () => isLandSubject(lower),
    },
    {
      theme: "Government & Administration",
      test: () =>
        /local government|government and administration|civil service|executive departments|public works|public records|administration|monarchy|arts - great britain - government policy|emigration and immigration - government policy|public welfare - great britain - administration|public welfare - great britain - officials|politics and government|public policy \(law\)|home department|board of public works|local government commission|machinery of government|ireland - politics and government|northern ireland - politics|london \(england\) - politics|constitutional law|public opinion|executive departments|administrative courts - great britain|public records - great britain|public records - ireland|public policy \(law\) - great britain|public policy \(law\) - ireland|public policy \(law\) - scotland|public works - ireland|board of trade|returning officers|provisional orders|local government - ireland|local government - great britain|local government - statistics|local government\b|public works\b|public records\b|public policy \(law\)|politics and government|constitutional law|monarchy\b|executive departments|administration\b|government aid|government\b|state\b - ireland|home rule|northern ireland - politics|london \(england\) - politics|public opinion|board of public works|local government commission|machinery of government|returning officers|provisional orders|public works - ireland|local government - ireland|local government - great britain|local government - statistics|public records - ireland|public records - great britain|public policy \(law\) - ireland|public policy \(law\) - great britain|public policy \(law\) - scotland|constitutional law|monarchy - great britain|executive departments|administrative courts - great britain|emigration and immigration - government policy|arts - great britain - government policy|public welfare - great britain - administration|public welfare - great britain - officials|great britain - politics and government|ireland - politics and government|northern ireland - politics and government|london \(england\) - politics and government|public works - ireland|local government - ireland|local government - great britain|local government - statistics|public records - ireland|public records - great britain|public policy \(law\) - ireland|public policy \(law\) - great britain|public policy \(law\) - scotland|constitutional law|monarchy - great britain|executive departments|administrative courts - great britain|emigration and immigration - government policy|arts - great britain - government policy|public welfare - great britain - administration|public welfare - great britain - officials|great britain - politics and government|ireland - politics and government|northern ireland - politics and government|london \(england\) - politics and government/.test(
          lower
        ) ||
        /local government|public works|public records|politics and government|constitutional law|monarchy|executive departments|civil service|public policy \(law\)|board of public works|home rule|northern ireland - politics|public opinion|returning officers|provisional orders|machinery of government|local government commission|great britain - politics and government|ireland - politics and government|london \(england\) - politics and government|northern ireland - politics and government|public works - ireland|local government - ireland|local government - great britain|public records - ireland|public records - great britain|public policy \(law\) - ireland|public policy \(law\) - great britain|public policy \(law\) - scotland|administrative courts - great britain|emigration and immigration - government policy|arts - great britain - government policy|public welfare - great britain - administration|public welfare - great britain - officials/.test(
          lower
        ),
    },
    {
      theme: "Population & Demography",
      test: () =>
        /population|census|registers of birth|emigration and immigration|fertility, human|migration,internal|population forecasting|demograph|registers of births|death - causes|body height|body weight|family size|marriage - ireland|marriage\b - ireland|marriage law|registers of birth,etc|emigration and immigration\b|emigration\b|immigration\b|migration\b|fertility\b|population\b|census\b|registers of birth|death - causes|body height|body weight|family size|marriage - ireland|marriage\b|emigration and immigration|population forecasting|demograph|registers of births|migration,internal|fertility, human|ireland - population|great britain - population|scotland - population|registers of birth,etc - ireland|registers of birth,etc - great britain|registers of birth,etc - scotland|ireland - emigration and immigration|great britain - emigration and immigration|emigration and immigration law|emigration and immigration - government policy|migration,internal|population forecasting|fertility, human|death - causes|body height|body weight|family size|marriage - ireland|marriage\b|emigration\b|immigration\b|migration\b|fertility\b|population\b|census\b/.test(
          lower
        ),
    },
    {
      theme: "Culture & Heritage",
      test: () =>
        /museum|libraries|library|arts\b|heritage|antiquities|cultural property|learned institutions|music|exhibitions|national gallery|royal irish academy|royal hibernian academy|royal dublin society|historic preservation|historic sites|monuments - ireland|cultural property|art museums|science museums|public libraries|irish language - study|history - study and teaching|decoration and ornament|stonehenge|archives\b|cultural property - ireland|cultural property - great britain|ireland - antiquities|national gallery of ireland|national museum of ireland|art museums - ireland|art museums - great britain|museums - ireland|museums - great britain|libraries - ireland|libraries - great britain|public libraries - ireland|public libraries - great britain|learned institutions and societies - ireland|royal dublin society|royal irish academy|royal hibernian academy of arts|irish academy of music|exhibitions - ireland|historic preservation|historic sites|monuments - ireland|decoration and ornament|stonehenge|archives\b|history - study and teaching - ireland|irish language - study and teaching - ireland|government aid to music education - ireland|science - societies,etc - ireland|science - societies,etc - great britain|art - study and teaching|handicraft - study and teaching|cultural property|arts - great britain|press - great britain|proposal writing for grants|museum finance|museum buildings|museum of practical geology|national gallery|hibernian society|irish society of london|learned institutions|music\b|exhibitions\b|heritage\b|antiquities\b|archives\b|historic\b|monuments\b|decoration and ornament|stonehenge|irish language\b|history - study and teaching|government aid to music education|science - societies|art - study and teaching|handicraft - study and teaching|cultural property|arts - great britain|press - great britain|proposal writing for grants|museum finance|museum buildings|national gallery|hibernian society|irish society of london|learned institutions|music\b|exhibitions\b|heritage\b|antiquities\b|archives\b|historic\b|monuments\b|decoration and ornament|stonehenge|irish language\b|history - study and teaching|government aid to music education|science - societies|art - study and teaching|handicraft - study and teaching/.test(
          lower
        ) &&
        !/museum finance - ireland|museum buildings - ireland - costs|museum finance - great britain|intermediate education board for ireland - accounting|royal university of ireland - accounting|trinity college \(dublin,ireland\) - accounting|royal catholic college of st.patrick \(maynooth,ireland\) - accounting|university college,cork - accounting|university college,galway - accounting|queen's university of belfast - accounting|commissioners of national education in ireland - charters|schools - ireland - accounting|museum finance - ireland|irish society of london - accounting/.test(
          lower
        ),
    },
  ];

  for (const rule of rules) {
    if (rule.test()) return rule.theme;
  }

  return "Other";
}

function extractYear(row) {
  const sources = [
    row["Imprint - date of publication"],
    row["Series Added Entry - Uniform Title - volume/sequential designation"],
    row["Series Statement - volume.1"],
    row["Series Statement - volume"],
    row["Title Statement - title"],
    row["General Note"],
    row["Location Note"],
  ];

  for (const source of sources) {
    const text = source || "";
    const bracketYear = text.match(/\[(\d{4})\]/);
    if (bracketYear) return Number(bracketYear[1]);

    const rangeYear = text.match(/\b(1[789]\d|19\d\d|20\d\d)\s*[-–]/);
    if (rangeYear) return Number(rangeYear[1]);

    const plainYear = text.match(/\b(1[789]\d|19\d\d|20\d\d)\b/);
    if (plainYear) return Number(plainYear[1]);
  }

  return "";
}

function extractDecade(year) {
  if (!year || Number.isNaN(Number(year))) return "";
  const y = Number(year);
  return `${Math.floor(y / 10) * 10}s`;
}

function getRegion(row) {
  const note = row["Selection Note"] || "";
  if (/EPPI|Enhanced Parliamentary Papers on Ireland/i.test(note)) {
    return "Ireland-related";
  }
  return "Other British administration";
}

function getOrganisation(row) {
  const parts = [
    row["Main Entry - corporate name"],
    row["Main Entry - subordinate unit"],
    row["Main Entry - subordinate unit.1"],
    row["Main Entry - subordinate unit.2"],
  ]
    .map((p) => (p || "").trim())
    .filter(Boolean);
  return parts.join(" · ") || "";
}

function getPublisher(row) {
  return (row["Imprint - name of publisher"] || "").trim();
}

function collectSubjects(row, subjectColumns, indexColumns) {
  const subjects = [];
  for (const col of subjectColumns) {
    const value = normaliseSubject(row[col]);
    if (value) subjects.push(value);
  }

  const indexThemes = [];
  for (const col of indexColumns) {
    const theme = classifyIndexTerm(row[col]);
    if (theme) indexThemes.push(theme);
  }

  return { subjects, indexThemes };
}

function choosePrimarySubject(subjects, subjectCounts) {
  if (!subjects.length) return "";
  let best = subjects[0];
  let bestCount = subjectCounts.get(best) || 0;
  for (const subject of subjects.slice(1)) {
    const count = subjectCounts.get(subject) || 0;
    if (count > bestCount) {
      best = subject;
      bestCount = count;
    }
  }
  return best;
}

function isDefencePublication(row, rankedSubjects, subjectThemeMap, indexThemes) {
  const corp = `${row["Main Entry - corporate name"] || ""} ${row["Main Entry - subordinate unit"] || ""}`.toLowerCase();
  if (/ministry of defence/.test(corp)) return true;

  const title = (row["Title Statement - title"] || "").toLowerCase();
  if (
    /defence committee|defence policy|defence services|reserve forces|royal dockyards|national service on the education|effects of national service|falklands crisis|men of military age|volunteer force|land forces of great britain|munitions tribunal|irish command|royal hibernian military|hibernian military|special army order|appointment of major-general|active operations in ireland|imperial defence|recruiting in ireland|forces medical and dental|cessation of active operations|military and police force|military force to assist|coal supplied for civil and military|orange societies prohibited in the army|recent events in the irish command|private manufacture of and trading in arms/.test(
      title
    )
  ) {
    return true;
  }

  if (indexThemes.includes("Defence & Military")) return true;

  return rankedSubjects.some(
    (subject) =>
      (subjectThemeMap.get(subject) || classifySubject(subject)) ===
      "Defence & Military"
  );
}

function choosePublicationTheme(row, rankedSubjects, indexThemes, subjectThemeMap) {
  if (isDefencePublication(row, rankedSubjects, subjectThemeMap, indexThemes)) {
    return "Defence & Military";
  }

  if (rankedSubjects.length) {
    return (
      subjectThemeMap.get(rankedSubjects[0]) ||
      classifySubject(rankedSubjects[0]) ||
      "Other"
    );
  }

  if (indexThemes.length) return indexThemes[0];
  return "Other";
}

function main() {
  fs.mkdirSync(DATA, { recursive: true });

  const subjectRows = parseCsv(fs.readFileSync(SUBJECTS_IN, "utf8"));
  const batchRows = parseCsv(fs.readFileSync(BATCH_IN, "utf8"));
  const publications = parseCsv(fs.readFileSync(PUBLICATIONS_IN, "utf8"));

  const subjectCounts = new Map(
    subjectRows.map((r) => [normaliseSubject(r.Subject), Number(r.Count) || 0])
  );

  const batchMap = new Map(
    batchRows.map((r) => [normaliseSubject(r.Subject), r.Theme?.trim() || ""])
  );

  const subjectThemeMap = new Map();
  const mappingRows = [];

  for (const row of subjectRows) {
    const subject = normaliseSubject(row.Subject);
    const batchTheme = normaliseTheme(batchMap.get(subject) || "");
    let theme;
    const lower = subject.toLowerCase();
    if (
      batchTheme === "Land & Property" &&
      /military|armed forces|world war|defence|defense/.test(lower)
    ) {
      theme = classifySubject(subject);
    } else if (batchTheme && batchTheme !== "Land & Property" && batchTheme !== "Other") {
      theme = batchTheme;
    } else {
      theme = classifySubject(subject);
    }
    theme = normaliseTheme(theme);

    subjectThemeMap.set(subject, theme);
    mappingRows.push({
      Subject: subject,
      Count: row.Count,
      Theme: theme,
    });
  }

  mappingRows.sort((a, b) => Number(b.Count) - Number(a.Count));
  writeCsv(MAPPING_OUT, ["Subject", "Count", "Theme"], mappingRows);

  const pubHeader = Object.keys(publications[0]);
  const subjectColumns = pubHeader.filter((c) => c.startsWith("Subject Added Entry"));
  const indexColumns = pubHeader.filter((c) => c.startsWith("Index Term - Uncontrolled"));

  const enrichedHeader = [
    ...pubHeader,
    "PublicationYear",
    "Decade",
    "Theme",
    "PrimarySubject",
    "Region",
  ];

  const enrichedRows = [];
  const themeStats = Object.fromEntries(THEMES.map((t) => [t, 0]));
  const regionStats = { "Ireland-related": 0, "Other British administration": 0 };
  let missingYear = 0;
  let missingSubject = 0;

  for (const row of publications) {
    const { subjects, indexThemes } = collectSubjects(
      row,
      subjectColumns,
      indexColumns
    );

    // Rank subjects by global frequency for primary subject selection
    const rankedSubjects = [...new Set(subjects)].sort(
      (a, b) => (subjectCounts.get(b) || 0) - (subjectCounts.get(a) || 0)
    );

    const primarySubject = choosePrimarySubject(rankedSubjects, subjectCounts);
    const theme = choosePublicationTheme(
      row,
      rankedSubjects,
      indexThemes,
      subjectThemeMap
    );

    const year = extractYear(row);
    if (!year) missingYear += 1;
    if (!primarySubject && !subjects.length) missingSubject += 1;

    const region = getRegion(row);
    themeStats[theme] = (themeStats[theme] || 0) + 1;
    regionStats[region] += 1;

    enrichedRows.push({
      ...row,
      PublicationYear: year,
      Decade: extractDecade(year),
      Theme: theme,
      PrimarySubject: primarySubject,
      Region: region,
    });
  }

  writeCsv(ENRICHED_OUT, enrichedHeader, enrichedRows);

  const report = {
    publications: publications.length,
    uniqueSubjects: subjectRows.length,
    themesUsed: Object.entries(themeStats)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]),
    regionStats,
    missingYear,
    missingSubject,
    mappingOut: MAPPING_OUT,
    enrichedOut: ENRICHED_OUT,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
