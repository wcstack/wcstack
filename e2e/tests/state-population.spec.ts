import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";
import { allStates } from "../../packages/state/examples/state-population/allStates.js";

// state: 入れ子のリスト描画と多段の算出プロパティ。import map で読み込んだ 50 州のデータを
// 地域ごとに for: regions → for: regions.*.states の 2 段で描き、地域の人口
// ($getAll と this.$1 で外側の行に絞った集計)、全体の人口、州の地域内比率・全体比率、
// 地域の全体比率をすべてワイルドカード getter で導く。locale / percent(2) フィルタと、
// ge / lt の真偽による class.over / class.under も使う。
// デモに操作 UI は無いので、全 54 行 + 合計行の全セルとクラスを、データファイルから
// 独立に組み立てた期待値と突き合わせて固定する。加えて、公開 API (createState) から
// regions を書き換え、外側の行の削除・並べ替えに対して行ごとの getter のキャッシュと
// 全体の人口に依存する比率がすべて計算し直されることを確かめる。
const PAGE = "/packages/state/examples/state-population/";

type StateInfo = { name: string; capital: string; region: string; population: number };
const STATES = allStates as StateInfo[];

// <html lang="en"> の既定ロケールでの数値表示と、小数 2 桁のパーセント表示
const num = (n: number) => n.toLocaleString("en");
const pct = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;

type RowView = { summary: boolean; cells: string[]; over?: boolean; under?: boolean };

const ALL_REGIONS = [...new Set(STATES.map((s) => s.region))].sort();

// 描く地域の並び (既定はデモと同じアルファベット順) から tbody の期待値を組み立てる
function expectedBody(regions: string[] = ALL_REGIONS): RowView[] {
  const total = STATES.filter((s) => regions.includes(s.region)).reduce((s, x) => s + x.population, 0);
  const rows: RowView[] = [];
  for (const region of regions) {
    const members = STATES.filter((s) => s.region === region);
    const regionPop = members.reduce((s, x) => s + x.population, 0);
    for (const s of members) {
      rows.push({
        summary: false,
        cells: [s.name, s.capital, num(s.population), pct(s.population / regionPop), pct(s.population / total)],
        over: s.population >= 5_000_000,
        under: s.population < 1_000_000,
      });
    }
    rows.push({ summary: true, cells: [region, num(regionPop), "", pct(regionPop / total)] });
  }
  return rows;
}

async function readBody(page: Page): Promise<RowView[]> {
  return page.locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => {
      const tds = Array.from(tr.querySelectorAll("td"));
      const summary = tr.classList.contains("summary");
      const view: RowView = { summary, cells: tds.map((td) => td.textContent!.trim()) };
      if (!summary) {
        view.over = tds[2].classList.contains("over");
        view.under = tds[2].classList.contains("under");
      }
      return view;
    }),
  );
}

test.describe("packages/state/examples/state-population", () => {
  test("地域ごとの州の行と地域の小計行が、人口・比率・クラスまで正しく並ぶ", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    const expected = expectedBody();
    // 50 州 + 4 地域
    expect(expected.length).toBe(54);
    await expect(page.locator("tbody tr")).toHaveCount(expected.length);
    await expect.poll(() => readBody(page)).toEqual(expected);

    expect(errors).toEqual([]);
  });

  test("地域の並びはアルファベット順で、各小計行の直前にその地域の州だけが並ぶ", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    await expect(page.locator("tbody tr.summary td:first-child")).toHaveText(
      ["Midwest", "Northeast", "South", "West"],
    );
    // 小計行で区切った各ブロックの州が、その地域に属する州と一致する
    const body = await readBody(page);
    let block: string[] = [];
    for (const row of body) {
      if (row.summary) {
        const region = row.cells[0];
        expect(block, region).toEqual(STATES.filter((s) => s.region === region).map((s) => s.name));
        block = [];
      } else {
        block.push(row.cells[0]);
      }
    }
    expect(block).toEqual([]);

    expect(errors).toEqual([]);
  });

  test("合計行は全州の人口の和で、地域の全体比率の和は 100% になる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    const total = STATES.reduce((s, x) => s + x.population, 0);
    await expect(page.locator("tfoot tr.summary td")).toHaveText(["Total", num(total), "", ""]);

    // 地域の全体比率 (表示は 2 桁に丸めたもの) の和はほぼ 100%
    await expect(page.locator("tbody tr.summary")).toHaveCount(4);
    const shares = await page.locator("tbody tr.summary td:last-child").allTextContents();
    const sum = shares.reduce((s, t) => s + Number(t.trim().replace("%", "")), 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.03);

    // 文字のままの mustache が残っていない
    await expect(page.locator("body")).not.toContainText("{{");

    expect(errors).toEqual([]);
  });

  test("regions を書き換えると、外側の行の削除・並べ替えに合わせて小計・合計・比率がすべて計算し直される", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);
    await expect.poll(() => readBody(page)).toEqual(expectedBody());

    const setRegions = (regions: string[]) =>
      page.evaluate((next) => {
        (document.querySelector("wcs-state") as any).createState("writable", (state: any) => {
          state.regions = next;
        });
      }, regions);
    const totalCell = page.locator("tfoot tr.summary td").nth(1);
    const totalOf = (regions: string[]) =>
      num(STATES.filter((s) => regions.includes(s.region)).reduce((s, x) => s + x.population, 0));

    // South を外して逆順に: 全体の人口が減り、残る地域・州の全体比率がすべて変わる
    const without = ["West", "Northeast", "Midwest"];
    await setRegions(without);
    await expect.poll(() => readBody(page)).toEqual(expectedBody(without));
    await expect(totalCell).toHaveText(totalOf(without));

    // 元の 4 地域に戻す
    await setRegions(ALL_REGIONS);
    await expect.poll(() => readBody(page)).toEqual(expectedBody());
    await expect(totalCell).toHaveText(totalOf(ALL_REGIONS));

    expect(errors).toEqual([]);
  });
});
