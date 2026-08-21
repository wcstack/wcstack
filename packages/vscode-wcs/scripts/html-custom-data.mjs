/**
 * html-custom-data.mjs — builtinTags カタログ → VS Code HTML custom data への純射影。
 *
 * emit-builtin-tags.mjs(生成時)と __tests__/htmlCustomData.test.ts(ドリフト検査)の
 * 両方から import される。入力はカタログ(tag 名 → BuiltinTagContract 相当の plain
 * object)だけで、fs / DOM に依存しない。
 *
 * 出力は vscode-html-languageservice の custom data 形式
 * (https://github.com/microsoft/vscode-custom-data)。VS Code は拡張の
 * contributes.html.customData から、他エディタ(vscode-html-languageserver 系)は
 * `html.customData` 設定にこのファイルのパスを書くことで同じ補完/hover を得る。
 * static-wiring-dx-design.md §6-3。
 */

const REPO_TREE = "https://github.com/wcstack/wcstack/tree/main/packages";

/** markdown の MarkupContent(バッククォートを hover でコード表示させる。素の string は plaintext 扱い)。 */
function markdown(value) {
  return { kind: "markdown", value };
}

/** 1 タグ分の markdown 説明を組み立てる。契約(wc-bindable 面)を hover に開示する。 */
function tagDescription(contract) {
  const lines = [`\`@wcstack/${contract.package}\` custom element (wc-bindable).`];
  if (contract.properties.length > 0) {
    lines.push("", `**Bindable properties**: ${contract.properties.map((p) => `\`${p}\``).join(", ")}`);
  }
  const inputNames = Object.keys(contract.inputs);
  if (inputNames.length > 0) {
    lines.push("", `**Inputs**: ${inputNames.map((i) => `\`${i}\``).join(", ")}`);
  }
  if (contract.commands.length > 0) {
    lines.push("", `**Commands**: ${contract.commands.map((c) => `\`command.${c}\``).join(", ")}`);
  }
  if (contract.properties.length === 0 && inputNames.length === 0 && contract.commands.length === 0) {
    lines.push("", "Helper tag (no bindable surface).");
  }
  return markdown(lines.join("\n"));
}

/**
 * カタログから custom data オブジェクトを構築する(決定的: タグ名・属性名で整列)。
 * 属性面は「input のミラー属性 ∪ Shell の observedAttributes」— fetch のように
 * wcBindable へ attribute ヒントを持たせない設計(setter 自身が reflect)のタグでも
 * observedAttributes 側に HTML 属性面が現れる。
 * @param {Readonly<Record<string, {package: string, observedAttributes?: readonly string[], inputs: Readonly<Record<string, string | null>>, properties: readonly string[], commands: readonly string[]}>>} tags
 */
export function buildHtmlCustomData(tags) {
  const tagEntries = Object.keys(tags).sort().map((tagName) => {
    const contract = tags[tagName];
    // ミラー属性を持つ input だけが HTML 属性として現れる(null は property 専用)。
    const byName = new Map();
    for (const [input, attribute] of Object.entries(contract.inputs)) {
      if (attribute !== null) {
        byName.set(attribute, markdown(`Attribute mirror of the \`${input}\` input.`));
      }
    }
    const inputNameSet = new Set(Object.keys(contract.inputs));
    for (const attribute of contract.observedAttributes ?? []) {
      if (byName.has(attribute)) continue;
      byName.set(
        attribute,
        inputNameSet.has(attribute)
          ? markdown(`Configures the \`${attribute}\` input.`)
          : markdown("Observed attribute."),
      );
    }
    const attributes = [...byName.entries()]
      .map(([name, description]) => ({ name, description }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return {
      name: tagName,
      description: tagDescription(contract),
      attributes,
      references: [
        { name: "Package README", url: `${REPO_TREE}/${contract.package}#readme` },
      ],
    };
  });

  return {
    version: 1.1,
    tags: tagEntries,
    globalAttributes: [
      {
        name: "data-wcs",
        description: {
          kind: "markdown",
          value: [
            "wcstack binding attribute. Each expression is",
            "`property#modifier: path@state | filter(args)` and `;` separates multiple bindings.",
            "Structural directives (`for:` / `if:` / `elseif:` / `else`) go on `<template>`.",
          ].join("\n"),
        },
        references: [
          { name: "Binding syntax", url: `${REPO_TREE}/state#readme` },
        ],
      },
    ],
  };
}
