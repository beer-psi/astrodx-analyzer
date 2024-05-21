/// <reference path="./decryptor/reflektone_decrypt.d.ts" />

(function (scope) {
  //#region Rating & rank calculation
  const RATING_COEFFICIENTS = new Map([
    [100.5, 22.4],
    [100.4999, 22.2],
    [100, 21.6],
    [99.9999, 21.4],
    [99.5, 21.1],
    [99, 20.8],
    [98.9999, 20.6],
    [98, 20.3],
    [97, 20],
    [96.9999, 17.6],
    [94, 16.8],
    [90, 15.2],
    [80, 13.6],
    [79.9999, 12.8],
    [75, 12],
    [70, 11.2],
    [60, 9.6],
    [50, 8],
    [40, 6.4],
    [30, 4.8],
    [20, 3.2],
    [10, 1.6],
    [0, 0],
  ]);

  /**
   * Calculate maimai DX Splash+ (and newer) rate for a score.
   *
   * @param {number} score - The score to calculate the rate for.
   * @param {number} internalChartLevel - The internal decimal level of the chart the score was achieved on.
   */
  function calculateRating(score, internalChartLevel) {
    // Scores above 100.5% are capped at 100.5% by the algorithm.
    score = Math.min(score, 100.5);

    for (const [scoreBoundary, coefficient] of RATING_COEFFICIENTS) {
      if (score >= scoreBoundary) {
        return Math.floor(internalChartLevel * coefficient * (score / 100));
      }
    }

    // should be impossible as score cannot be negative and the lowest boundary is >= 0.
    /* istanbul ignore next */
    throw new Error(`Unresolvable score of ${score}.`);
  }

  const RANK_BORDERS = new Map([
    [100.5, "SSS+"],
    [100, "SSS"],
    [99.5, "SS+"],
    [99, "SS"],
    [98, "S+"],
    [97, "S"],
    [94, "AAA"],
    [90, "AA"],
    [80, "A"],
    [75, "BBB"],
    [70, "BB"],
    [60, "B"],
    [50, "C"],
  ]);

  function calculateRank(score) {
    for (const [scoreBoundary, rank] of RANK_BORDERS) {
      if (score >= scoreBoundary) {
        return rank;
      }
    }
    return "D";
  }
  //#endregion

  //#region Magic
  const DIFFICULTIES = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER"];
  
  const DX_REGEX = /\bdx\s*:\s*([0-9]+)/;
  const LV_REGEX = /\blv\s*:\s*(\[.+?\])/;
  const VERSION_REGEX = /\bv\s*:\s*(-?[0-9]+)/;
  const SONGNAME_REGEX = /\bn\s*:\s*["'`](.+?)["'`]\s*[,\}]/;
  const SONGNICKNAME_REGEX = /\bnn\s*:\s*["'`](.+?)["'`]\s*[,\}]/;
  const ICO_REGEX = /\bico\s*:\s*["`]([0-9a-z]+)["`]/;

  
  const magicSauce = {
    universeplus:
      "https://gist.githubusercontent.com/myjian/ee569d74f422d4e255065d8b02ea294a/raw/932fb03a38121210080d6f537913a084247e531c/maidx_in_lv_universeplus.js",
    festival:
      "https://gist.githubusercontent.com/myjian/0855c8947b547d7b9b888158512dde69/raw/1eeb074d39367748af40fb1a9dd4a16b42f99b6b/maidx_in_lv_festival.js",
    festivalplus:
      "https://gist.githubusercontent.com/myjian/ad2685872fd7f5cd7a47ecb340514e6b/raw/9961748d3c481ef495cfe3d080392ab86295ce9c/maidx_in_lv_festivalplus.js",
    buddies:
      "https://admirable0531.github.io/buddiesMagic/buddiesMagic.js",
    buddiesplus:
      "https://sgimera.github.io/mai_RatingAnalyzer/scripts_maimai/maidx_in_lv_buddiesplus.js",
  };

  function normalizeSongName(name) {
    if (name === 'D✪N’T  ST✪P  R✪CKIN’') {
      return 'D✪N’T ST✪P R✪CKIN’';
    }
    return name.replace(/" \+ '/g, '').replace(/' \+ "/g, '');
  }

  function parseLine(line) {
    const dxMatch = line.match(DX_REGEX);
    const lvMatch = line.match(LV_REGEX);
    const debutVerMatch = line.match(VERSION_REGEX);
    const songNameMatch = line.match(SONGNAME_REGEX);
    const nicknameMatch = line.match(SONGNICKNAME_REGEX);
    const icoMatch = line.match(ICO_REGEX);
    if (dxMatch && lvMatch && debutVerMatch && songNameMatch) {
      let lvList = JSON.parse(lvMatch[1]);
      if (lvList.length > DIFFICULTIES.length) {
        const newReMasterLv = lvList.pop();
        lvList[DIFFICULTIES.length - 1] = newReMasterLv;
      }
      const props = {
        dx: parseInt(dxMatch[1]),
        lv: lvList,
        v: Math.abs(parseInt(debutVerMatch[1])),
        n: normalizeSongName(songNameMatch[1]),
      };
      if (nicknameMatch) {
        props.nn = nicknameMatch[1];
      }
      if (icoMatch) {
        props.ico = icoMatch[1];
      }
      return props;
    }
  }

  /**
   * @param {keyof typeof magicSauce} version
   * @returns {Promise<SgimeraChart[]>}
   */
  async function fetchMagic(version) {
    const res = await fetch(magicSauce[version] || magicSauce["universeplus"]);
    if (res.ok) {
      const text = await res.text();
      return text
          .split("\n")
          .map(parseLine)
          .filter((props) => props);
    }
    return [];
  }

  /**
   *
   * @param {keyof typeof magicSauce} version
   * @returns {Promise<SgimeraChart[]>}
   */
  async function loadMagic(version) {
    const cachedMagicString = localStorage.getItem(`inlv${version}_1`);
    const cachedMagic = JSON.parse(cachedMagicString ?? "{}");
    if (cachedMagicString && new Date(cachedMagic.expiration) > new Date()) {
      return cachedMagic.data;
    }

    const magic = await fetchMagic(version);
    if (magic.length) {
      window.localStorage.setItem(
        `inlv${version}_1`,
        JSON.stringify(
          {
            expiration: new Date(Date.now() + 1000 * 60 * 60 * 24),
            data: magic,
          }
      ));
    }
    return magic;
  }
  //#endregion

  //#region Utilities
  /**
   * @param {string} title
   * @returns {string}
   */
  function normalizeTitle(title) {
    return (
      title
        .toLowerCase()
        // ideographic space is used in some titles
        // eslint-disable-next-line no-irregular-whitespace
        .replace(/　/gu, " ")
        // so is nbsp I think?
        // eslint-disable-next-line no-irregular-whitespace
        .replace(/ /gu, " ")
        .replace(/：/gu, ":")
        .replace(/（/gu, "(")
        .replace(/）/gu, ")")
        .replace(/！/gu, "!")
        .replace(/？/gu, "?")
        .replace(/`/gu, "'")
        .replace(/’/gu, "'")
        .replace(/”/gu, '"')
        .replace(/“/gu, '"')
        .replace(/～/gu, "~")
        .replace(/－/gu, "-")
        .replace(/＠/gu, "@")
        .replace(/＃/gu, "#")
    );
  }
  //#endregion
  const ChartType = {
    UNKNOWN: -1,
    STANDARD_ONLY: 0,
    DX_ONLY: 1,
    STANDARD_BOTH: 2,
    DX_BOTH: 3,
  };
  /**
   * @param {-1 | 0 | 1 | 2 | 3} chartType
   * @returns {string}
   */
  scope.displayedChartType = function (chartType) {
    if (chartType === ChartType.STANDARD_BOTH) {
      return " [ST]";
    } else if (chartType === ChartType.DX_BOTH) {
      return " [DX]";
    } else {
      return "";
    }
  };

  /**
   * @type {File | null}
   */
  let lastFile = null;
  /**
   *
   * @param {"jp" | "intl"} region
   * @param {keyof typeof magicSauce} version
   * @param {File} file
   * @param {Record<string, Any>} $data
   */
  scope.analyzeRating = async function (region, version, file, $data) {
    if (lastFile !== file) {
      $data.best50 = [];
      $data.tsvRows = [];
      $data.totalRating = 0;
      $data.status = "";
    }
    lastFile = file;

    const encryptedContent = await file.text();
    let content = "";

    try {
      switch (file.name) {
        case "chart-meta.fufu":
          content = wasm_bindgen.export_legacy_meta(encryptedContent);
          break;
        case "level-index.nya":
          content = wasm_bindgen.export_dev_meta(encryptedContent);
          break;
        default:
          content = wasm_bindgen.export_current_meta(encryptedContent);
          break;
      }
    } catch (e) {
      $data.status = `Failed to decrypt file. Are you on iOS?<br />
      Detailed error: <code>${e.message}</code>`;
      return;
    }

    if (content.length === 0) {
      $data.status = "No charts found.";
      return;
    }

    $data.status = "Loading internal level data...";
    const magicCharts = await loadMagic(version);

    $data.status = "Processing scores...";
    // For CSV export
    const annotatedRows = [];
    /**
     * @type {Chart[]}
     */
    const allCharts = content
      .trim()
      .split("\n")
      .map((line) => {
        const cells = line.split("\t");

        const score = {
          title: cells[1],
          difficulty: cells[5],
          level: Number(cells[6].replace("+", ".7")),
          isEstimatedLevel: true,
          achievement: Number(cells[17].replace("%", "")),
          rank: calculateRank(Number(cells[17].replace("%", ""))),
          // Assuming chart type is only provided when differentiation is required.
          chartType:
            cells[4] === "DX"
              ? ChartType.DX_BOTH
              : cells[4] === "STANDARD"
              ? ChartType.STANDARD_BOTH
              : ChartType.UNKNOWN,
        };
        cells.push(score.rank);

        // Exit early if chart is UTAGE
        if (score.difficulty === "宴") {
          score.level = 0;
          score.isEstimatedLevel = false;
          score.rating = 0;

          cells.push(score.rating);
          annotatedRows.push(cells);

          return score;
        }

        const title = normalizeTitle(
          score.title
        );

        let charts = magicCharts.filter(
          (chart) =>
            (normalizeTitle(chart.n) === title ||
              (chart.nn && normalizeTitle(chart.nn) === title)) &&
            (score.chartType === ChartType.UNKNOWN ||
              score.chartType === chart.dx)
        );
        if (charts.length > 1 && score.chartType === ChartType.UNKNOWN) {
          charts = charts.map((chart) => {
            // Bumping the chart type to their *_BOTH variants
            chart.dx += 2;
            return chart;
          });
          charts.sort((a, b) => a.v - b.v);
        }
        const chart = charts[0];

        // Exit early if chart is unknown
        if (!chart) {
          score.rating = calculateRating(score.achievement, score.level);

          cells.push(score.rating);
          annotatedRows.push(cells);

          return score;
        }

        const difficultyIndex = DIFFICULTIES.indexOf(score.difficulty);
        if (difficultyIndex < 4) { // 4 is Re:MASTER
          score.level = chart.lv[difficultyIndex];
        } else {
          score.level = chart.lv[chart.lv.length - 1];
        }

        if (score.level < 0) {
          score.level = -score.level;
          score.isEstimatedLevel = true;
        } else {
          score.isEstimatedLevel = false;
        }

        if (score.chartType === ChartType.UNKNOWN) {
          score.chartType = chart.dx;
        }
        if (score.chartType === ChartType.STANDARD_BOTH || score.chartType === ChartType.STANDARD_ONLY) {
          cells[4] = "STANDARD";
        } else if (score.chartType === ChartType.DX_BOTH || score.chartType === ChartType.DX_ONLY) {
          cells[4] = "DX";
        }

        score.rating = calculateRating(
          score.achievement,
          score.level
        );
        cells.push(score.rating);
        annotatedRows.push(cells);
        return score;
      });

    $data.status = "Sorting scores...";
    allCharts.sort(
      (a, b) =>
        b.rating - a.rating ||
        b.level - a.level ||
        b.achievement - a.achievement
    );

    $data.tsvRows = annotatedRows;
    $data.best50 = allCharts.slice(0, 50);
    $data.totalRating = $data.best50.reduce(
      (acc, chart) => acc + chart.rating,
      0
    );
    $data.status = "";
  };

  scope.exportToTsv = function (rows) {
    const header = ["category", "title", "artist", "charter", "type", "difficulty", "level", "clear", "maxcombo", "tries", "cleared_plays", "complete_plays", "total_notes", "critical", "perfect", "great", "good", "achievement", "rank", "rating"];
    const tsvRows = rows.map((row) => row.join("\t"));
    const tsv = [header.join("\t"), ...tsvRows].join("\n");

    const blob = new Blob([tsv], { type: "text/tab-separated-values" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "scores.tsv";
    a.click();
  };
})(globalThis);
