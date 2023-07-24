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
  const magicSauce = {
    universeplus:
      "https://gist.githubusercontent.com/myjian/ee569d74f422d4e255065d8b02ea294a/raw/932fb03a38121210080d6f537913a084247e531c/maidx_in_lv_universeplus.js",
    festival:
      "https://sgimera.github.io/mai_RatingAnalyzer/scripts_maimai/maidx_in_lv_festival.js",
    festivalplus:
      "https://sgimera.github.io/mai_RatingAnalyzer/scripts_maimai/maidx_in_lv_festivalplus.js",
  };

  /**
   *
   * @param {keyof typeof magicSauce} version
   * @returns {Promise<[SgimeraChart[], Map<string, string>]>}
   */
  async function fetchMagic(version) {
    const sauce = magicSauce[version] || magicSauce["universeplus"];
    const res = await fetch(sauce);
    const patchesRes = await fetch("data/patches.json");
    if (res.ok && patchesRes.ok) {
      let script = await res.text();
      script = script
        .replace(/^javascript:/, "")
        .replace(/^(var|let|const)\s+/gm, "this.");

      const scope = { Map };
      new Function(`with (this) { ${script} }`).call(scope);

      /**
       * @type {SgimeraChart[]}
       */
      const charts = scope.in_lv || scope.in_lv_old;
      const patches = await patchesRes.json();
      for (const [name, patch] of Object.entries(patches)) {
        const chartIndex = charts.findIndex((chart) => chart.n === name);
        if (chartIndex !== -1) {
          charts[chartIndex] = { ...charts[chartIndex], ...patch };
        } else {
          charts.push(patch);
        }
      }

      return [charts, scope.NameAlias || new Map()];
    }

    return [[], new Map()];
  }

  /**
   *
   * @param {keyof typeof magicSauce} version
   * @returns {Promise<[SgimeraChart[], Map<string, string>]>}
   */
  async function loadMagic(version) {
    const cachedMagicString = localStorage.getItem(`inlv${version}`);
    const cachedMagic = JSON.parse(cachedMagicString ?? "{}");
    if (cachedMagicString && new Date(cachedMagic.expiration) > new Date()) {
      const data = cachedMagic.data;
      data[1] = new Map(Object.entries(data[1]));
      return data;
    }

    const magic = await fetchMagic(version);
    if (magic[0].length) {
      window.localStorage.setItem(
        `inlv${version}`,
        JSON.stringify(
          {
            expiration: new Date(Date.now() + 1000 * 60 * 60 * 24),
            data: magic,
          },
          (_, value) =>
            value instanceof Map ? Object.fromEntries(value) : value
        )
      );
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

  const DIFFICULTIES = ["BASIC", "ADVANCED", "EXPERT", "MASTER", "Re:MASTER"];
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
      $data.charts = [];
      $data.totalRating = 0;
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
      document.getElementById("status").innerText =
        "Failed to decrypt file. Are you on iOS?";
    }

    const [magicCharts, aliases] = await loadMagic(version);

    /**
     * @type {Chart[]}
     */
    const allCharts = content
      .trim()
      .split("\n")
      .map((line) => {
        const cells = line.split("\t");
        
        const score = {
          title: cells[0],
          difficulty: cells[2],
          level: Number(cells[3].replace("+", ".7")),
          isEstimatedLevel: true,
          achievement: Number(cells[5].replace("%", "")),
          rank: calculateRank(Number(cells[5].replace("%", ""))),
          // Assuming chart type is only provided when differentiation is required.
          chartType:
            cells[4] === "DX"
              ? ChartType.DX_BOTH
              : cells[4] === "STANDARD"
              ? ChartType.STANDARD_BOTH
              : ChartType.UNKNOWN,
        };

        const title = normalizeTitle(
          aliases.get(score.title) || score.title
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

        if (score.difficulty === "宴" || !chart) {
          score.level = 0;
          score.isEstimatedLevel = false;
          score.rating = 0;
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

        if (score.chartType === -1) {
          score.chartType = chart.dx;
        }

        score.rating = calculateRating(
          score.achievement,
          score.level
        );
        return score;
      })
      .filter((chart) => chart);

    allCharts.sort(
      (a, b) =>
        b.rating - a.rating ||
        b.level - a.level ||
        b.achievement - a.achievement
    );

    $data.best50 = allCharts.slice(0, 50);
    $data.totalRating = $data.best50.reduce(
      (acc, chart) => acc + chart.rating,
      0
    );

    $data.charts = allCharts;
  };

  scope.exportToCsv = function (charts) {
    console.log(charts);
  };
})(globalThis);
